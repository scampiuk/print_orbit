"""State and upload manager for Print Orbit."""
from __future__ import annotations

import asyncio
import ipaddress
import re
import secrets
import time
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import (
    ALLOWED_SUFFIXES,
    DOMAIN,
    LEGACY_DOMAIN,
    LEGACY_STORAGE_KEY,
    MAX_FILES_PER_BATCH,
    MAX_PRINTERS_PER_JOB,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .uploader import (
    RemoteDeleteUnsupportedError,
    delete_files_from_printer,
    upload_file_to_printer,
)


def safe_filename(name: str) -> str:
    """Return a conservative G-code filename or raise ValueError."""
    leaf = Path(name.replace("\\", "/")).name.strip()
    leaf = re.sub(r"[^A-Za-z0-9._()\- +]", "_", leaf)
    leaf = leaf.lstrip(".")
    if not leaf:
        raise ValueError("invalid filename")
    if Path(leaf).suffix.lower() not in ALLOWED_SUFFIXES:
        raise ValueError("only .gcode files are accepted")
    suffix = Path(leaf).suffix
    stem = leaf[: -len(suffix)]
    return f"{stem[: 220 - len(suffix)]}{suffix}"


def normalise_printer(data: dict[str, Any], *, include_id: bool) -> dict[str, Any]:
    """Validate and normalise printer input."""
    name = str(data.get("name", "")).strip()
    host = str(data.get("host", "")).strip()
    model = str(data.get("model", "cc1")).strip().lower()
    access_code_raw = data.get("access_code")
    access_code = str(access_code_raw).strip() if access_code_raw is not None else None
    access_code = access_code or None

    if not name or len(name) > 80:
        raise ValueError("Printer name must be between 1 and 80 characters")
    try:
        ipaddress.IPv4Address(host)
    except ValueError as exc:
        raise ValueError("Printer host must be an IPv4 address") from exc
    if model not in {"cc1", "cc2"}:
        raise ValueError("Printer model must be cc1 or cc2")
    if model == "cc2" and not access_code:
        raise ValueError("CC2 requires an access code")
    if access_code and len(access_code) > 128:
        raise ValueError("Access code is too long")

    result: dict[str, Any] = {
        "name": name,
        "host": host,
        "model": model,
        "access_code": access_code,
    }
    if include_id:
        result["id"] = str(data.get("id") or secrets.token_hex(6))[:64]
    return result


class PrintOrbitManager:
    """Manage configured printers, staged files, and copy jobs."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.files_dir = Path(hass.config.path(DOMAIN, "files"))
        self.legacy_files_dir = Path(hass.config.path(LEGACY_DOMAIN, "files"))
        self.store: Store[list[dict[str, Any]]] = Store(
            hass, STORAGE_VERSION, STORAGE_KEY
        )
        self.printers: list[dict[str, Any]] = []
        self.jobs: dict[str, dict[str, Any]] = {}
        self._printer_lock = asyncio.Lock()
        self._jobs_lock = asyncio.Lock()

    async def async_setup(self) -> None:
        """Load persistent configuration and prepare staging directory."""
        await self.hass.async_add_executor_job(
            lambda: self.files_dir.mkdir(parents=True, exist_ok=True)
        )
        await self.hass.async_add_executor_job(self._migrate_legacy_files_sync)
        await self.hass.async_add_executor_job(self._cleanup_stale_uploads_sync)
        stored = await self.store.async_load()
        if stored is None:
            legacy_store: Store[list[dict[str, Any]]] = Store(
                self.hass, STORAGE_VERSION, LEGACY_STORAGE_KEY
            )
            stored = await legacy_store.async_load()
            if stored:
                await self.store.async_save(stored)
                await legacy_store.async_remove()
        stored = stored or []
        printers: list[dict[str, Any]] = []
        for item in stored:
            try:
                printers.append(normalise_printer(item, include_id=True))
            except ValueError:
                continue
        self.printers = printers

    def _migrate_legacy_files_sync(self) -> None:
        """Move legacy staged files into the Print Orbit domain."""
        if not self.legacy_files_dir.is_dir():
            return
        for source in self.legacy_files_dir.iterdir():
            if not source.is_file() or source.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            target = self.files_dir / source.name
            if target.exists():
                source.unlink()
            else:
                source.replace(target)
        try:
            self.legacy_files_dir.rmdir()
            self.legacy_files_dir.parent.rmdir()
        except OSError:
            pass

    def _cleanup_stale_uploads_sync(self) -> None:
        """Remove interrupted browser staging files older than one day."""
        cutoff = time.time() - 86400
        for path in self.files_dir.glob(".upload-*.part"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                continue

    def public_printers(self) -> list[dict[str, Any]]:
        """Return printers without secret access codes."""
        result = []
        for printer in self.printers:
            result.append(
                {
                    "id": printer["id"],
                    "name": printer["name"],
                    "host": printer["host"],
                    "model": printer["model"],
                    "has_access_code": bool(printer.get("access_code")),
                }
            )
        return result

    async def async_add_printer(self, data: dict[str, Any]) -> dict[str, Any]:
        """Validate and persist one printer."""
        printer = normalise_printer(data, include_id=True)
        async with self._printer_lock:
            if any(p["host"] == printer["host"] for p in self.printers):
                raise FileExistsError("A printer with that IP address already exists")
            self.printers.append(printer)
            await self.store.async_save(self.printers)
        return next(p for p in self.public_printers() if p["id"] == printer["id"])

    async def async_remove_printer(self, printer_id: str) -> bool:
        """Remove one configured printer."""
        async with self._printer_lock:
            remaining = [p for p in self.printers if p["id"] != printer_id]
            if len(remaining) == len(self.printers):
                return False
            self.printers = remaining
            await self.store.async_save(self.printers)
            return True

    def _list_files_sync(self) -> list[dict[str, Any]]:
        files: list[dict[str, Any]] = []
        for path in self.files_dir.iterdir():
            if not path.is_file() or path.suffix.lower() not in ALLOWED_SUFFIXES:
                continue
            stat = path.stat()
            files.append(
                {"name": path.name, "size": stat.st_size, "modified": int(stat.st_mtime)}
            )
        return sorted(files, key=lambda item: item["name"].lower())

    async def async_list_files(self) -> list[dict[str, Any]]:
        """List staged G-code files."""
        return await self.hass.async_add_executor_job(self._list_files_sync)

    async def async_delete_files(self, requested_files: list[str]) -> int:
        """Delete staged files only. This never deletes from printers."""
        if len(requested_files) > MAX_FILES_PER_BATCH:
            raise ValueError(f"Maximum {MAX_FILES_PER_BATCH} files per request")

        filenames: list[str] = []
        for requested in requested_files:
            try:
                filenames.append(safe_filename(requested))
            except ValueError:
                continue

        def _delete() -> int:
            deleted = 0
            for filename in filenames:
                target = self.files_dir / filename
                if target.is_file():
                    target.unlink()
                    deleted += 1
            return deleted

        return await self.hass.async_add_executor_job(_delete)

    async def async_delete_remote_files(
        self, requested_files: list[str], requested_printers: list[str]
    ) -> dict[str, Any]:
        """Delete selected staged-name files from selected printers."""
        if not requested_files or not requested_printers:
            raise ValueError("Select at least one file and one printer")
        if len(requested_files) > MAX_FILES_PER_BATCH:
            raise ValueError(f"Maximum {MAX_FILES_PER_BATCH} files per request")
        if len(requested_printers) > MAX_PRINTERS_PER_JOB:
            raise ValueError(f"Maximum {MAX_PRINTERS_PER_JOB} printers per request")

        filenames = list(dict.fromkeys(safe_filename(name) for name in requested_files))
        printers_by_id = {printer["id"]: printer for printer in self.printers}
        selected = []
        for printer_id in dict.fromkeys(requested_printers):
            printer = printers_by_id.get(printer_id)
            if printer is None:
                raise ValueError(f"Unknown printer: {printer_id}")
            selected.append(printer)

        async def delete_for_printer(printer: dict[str, Any]) -> dict[str, Any]:
            try:
                deleted = await delete_files_from_printer(
                    hass=self.hass,
                    host=printer["host"],
                    model=printer["model"],
                    filenames=filenames,
                    access_code=printer.get("access_code"),
                )
                return {
                    "printer_id": printer["id"],
                    "printer_name": printer["name"],
                    "deleted": deleted,
                    "error": None,
                }
            except RemoteDeleteUnsupportedError as exc:
                return {
                    "printer_id": printer["id"],
                    "printer_name": printer["name"],
                    "deleted": 0,
                    "error": str(exc),
                }
            except Exception as exc:  # Keep other printer results available.
                return {
                    "printer_id": printer["id"],
                    "printer_name": printer["name"],
                    "deleted": 0,
                    "error": str(exc)[:500],
                }

        results = await asyncio.gather(*(delete_for_printer(printer) for printer in selected))
        return {
            "files": filenames,
            "results": results,
            "deleted": sum(result["deleted"] for result in results),
            "failures": sum(result["error"] is not None for result in results),
        }

    async def async_start_copy(
        self, requested_files: list[str], requested_printers: list[str]
    ) -> str:
        """Create a copy job and schedule it in the background."""
        if not requested_files or not requested_printers:
            raise ValueError("Select at least one file and one printer")
        if len(requested_files) > MAX_FILES_PER_BATCH:
            raise ValueError(f"Maximum {MAX_FILES_PER_BATCH} files per job")
        if len(requested_printers) > MAX_PRINTERS_PER_JOB:
            raise ValueError(f"Maximum {MAX_PRINTERS_PER_JOB} printers per job")

        printers_by_id = {p["id"]: p for p in self.printers}
        selected_printers: list[dict[str, Any]] = []
        for printer_id in dict.fromkeys(requested_printers):
            printer = printers_by_id.get(printer_id)
            if printer is None:
                raise ValueError(f"Unknown printer: {printer_id}")
            selected_printers.append(printer)

        selected_paths: list[Path] = []
        for requested in dict.fromkeys(requested_files):
            filename = safe_filename(requested)
            path = self.files_dir / filename
            exists = await self.hass.async_add_executor_job(path.is_file)
            if not exists:
                raise ValueError(f"Staged file not found: {filename}")
            selected_paths.append(path)

        job_id = secrets.token_hex(8)
        items: list[dict[str, Any]] = []
        for printer in selected_printers:
            for path in selected_paths:
                size = await self.hass.async_add_executor_job(lambda p=path: p.stat().st_size)
                items.append(
                    {
                        "id": f"{printer['id']}:{path.name}",
                        "printer_id": printer["id"],
                        "printer_name": printer["name"],
                        "file": path.name,
                        "status": "queued",
                        "sent": 0,
                        "total": size,
                        "error": None,
                        "warning": None,
                    }
                )

        async with self._jobs_lock:
            self.jobs[job_id] = {
                "id": job_id,
                "created": int(time.time()),
                "status": "running",
                "items": items,
            }

        self.hass.async_create_background_task(
            self._run_copy_job(job_id, selected_printers, selected_paths),
            f"{DOMAIN} upload job {job_id}",
        )
        return job_id

    async def _run_copy_job(
        self,
        job_id: str,
        printers: list[dict[str, Any]],
        paths: list[Path],
    ) -> None:
        # One worker per printer: printers can upload in parallel, but each printer
        # receives its files sequentially to avoid hammering a single CC with
        # concurrent chunk uploads.
        await asyncio.gather(
            *(self._printer_worker(job_id, printer, paths) for printer in printers)
        )
        async with self._jobs_lock:
            job = self.jobs.get(job_id)
            if job is None:
                return
            statuses = {item["status"] for item in job["items"]}
            job["status"] = "failed" if "failed" in statuses else "complete"

    async def _printer_worker(
        self, job_id: str, printer: dict[str, Any], paths: list[Path]
    ) -> None:
        for path in paths:
            item_id = f"{printer['id']}:{path.name}"
            item = self._job_item(job_id, item_id)
            if item is None:
                continue
            item["status"] = "uploading"

            def progress(sent: int, total: int) -> None:
                progress_item = self._job_item(job_id, item_id)
                if progress_item is not None:
                    progress_item["sent"] = sent
                    progress_item["total"] = total

            try:
                await upload_file_to_printer(
                    hass=self.hass,
                    host=printer["host"],
                    model=printer["model"],
                    local_path=path,
                    remote_name=path.name,
                    access_code=printer.get("access_code"),
                    progress=progress,
                )
                item["sent"] = item["total"]
                item["status"] = "complete"
                item["warning"] = (
                    "Existing printer files were not checked; the printer may "
                    "rename this upload if the filename already exists."
                )
            except Exception as exc:  # Keep other file/printer uploads running.
                item["status"] = "failed"
                item["error"] = str(exc)[:500]

    def _job_item(self, job_id: str, item_id: str) -> dict[str, Any] | None:
        job = self.jobs.get(job_id)
        if job is None:
            return None
        return next((item for item in job["items"] if item["id"] == item_id), None)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        """Return an in-memory upload job."""
        return self.jobs.get(job_id)
