"""Authenticated HTTP API for the Print Orbit panel."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView, require_admin
from homeassistant.core import HomeAssistant

from .const import API_BASE, DOMAIN, MAX_FILES_PER_BATCH
from .manager import PrintOrbitManager, safe_filename

# Keep each browser -> Home Assistant request comfortably below HA Core's
# current 16 MiB request-body ceiling.
MAX_STAGE_CHUNK = 8 * 1024 * 1024
MAX_STAGED_FILE = 8 * 1024 * 1024 * 1024
UPLOAD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


def _manager(hass: HomeAssistant) -> PrintOrbitManager:
    return hass.data[DOMAIN]["manager"]


def _error(message: str, status: int = 400) -> web.Response:
    return web.json_response({"detail": message}, status=status)


def _append_bytes(path: Path, data: bytes) -> int:
    with path.open("ab") as output:
        output.write(data)
    return path.stat().st_size


def _file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def _replace_file(source: Path, target: Path) -> None:
    source.replace(target)


def _unlink_if_exists(path: Path) -> None:
    path.unlink(missing_ok=True)


def _file_info(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {"name": path.name, "size": stat.st_size, "modified": int(stat.st_mtime)}


class PrintersView(HomeAssistantView):
    url = f"{API_BASE}/printers"
    name = f"api:{DOMAIN}:printers"
    requires_auth = True

    @require_admin
    async def get(self, request: web.Request) -> web.Response:
        return web.json_response(_manager(request.app[KEY_HASS]).public_printers())

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            printer = await _manager(request.app[KEY_HASS]).async_add_printer(body)
            return web.json_response(printer)
        except FileExistsError as exc:
            return _error(str(exc), 409)
        except (ValueError, TypeError) as exc:
            return _error(str(exc), 422)


class PrinterView(HomeAssistantView):
    url = f"{API_BASE}/printers/{{printer_id}}"
    name = f"api:{DOMAIN}:printer"
    requires_auth = True

    @require_admin
    async def delete(self, request: web.Request, printer_id: str) -> web.Response:
        removed = await _manager(request.app[KEY_HASS]).async_remove_printer(printer_id)
        if not removed:
            return _error("Printer not found", 404)
        return web.json_response({"ok": True})


class FilesView(HomeAssistantView):
    url = f"{API_BASE}/files"
    name = f"api:{DOMAIN}:files"
    requires_auth = True

    @require_admin
    async def get(self, request: web.Request) -> web.Response:
        files = await _manager(request.app[KEY_HASS]).async_list_files()
        return web.json_response(files)


class StageChunkView(HomeAssistantView):
    """Receive one small chunk of a large browser upload."""

    url = f"{API_BASE}/files/chunk"
    name = f"api:{DOMAIN}:files_chunk"
    requires_auth = True

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        hass: HomeAssistant = request.app[KEY_HASS]
        manager = _manager(hass)

        upload_id = request.query.get("upload_id", "")
        raw_filename = request.query.get("filename", "")
        try:
            offset = int(request.query.get("offset", "-1"))
            total = int(request.query.get("total", "-1"))
        except ValueError:
            return _error("offset and total must be integers")

        if not UPLOAD_ID_RE.fullmatch(upload_id):
            return _error("Invalid upload id")
        try:
            filename = safe_filename(raw_filename)
        except ValueError as exc:
            return _error(str(exc))
        if offset < 0 or total <= 0 or total > MAX_STAGED_FILE or offset >= total:
            return _error("Invalid upload range")
        if request.content_length is not None and request.content_length > MAX_STAGE_CHUNK:
            return _error("Upload chunk is too large", 413)

        chunk = await request.read()
        if not chunk:
            return _error("Upload chunk is empty")
        if len(chunk) > MAX_STAGE_CHUNK:
            return _error("Upload chunk is too large", 413)
        if offset + len(chunk) > total:
            return _error("Upload chunk exceeds declared file size")

        temp = manager.files_dir / f".upload-{upload_id}-{filename}.part"
        target = manager.files_dir / filename

        current = await hass.async_add_executor_job(_file_size, temp)
        if offset == 0:
            await hass.async_add_executor_job(_unlink_if_exists, temp)
            current = 0
        if current != offset:
            return _error(
                f"Upload offset mismatch: server has {current} bytes, client sent offset {offset}",
                409,
            )

        size = await hass.async_add_executor_job(_append_bytes, temp, chunk)
        if size < total:
            return web.json_response({"complete": False, "received": size, "total": total})
        if size != total:
            await hass.async_add_executor_job(_unlink_if_exists, temp)
            return _error("Staged file size does not match declared size", 400)

        await hass.async_add_executor_job(_replace_file, temp, target)
        info = await hass.async_add_executor_job(_file_info, target)
        return web.json_response({"complete": True, "received": total, "file": info})


class DeleteFilesView(HomeAssistantView):
    url = f"{API_BASE}/files/delete"
    name = f"api:{DOMAIN}:files_delete"
    requires_auth = True

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            files = body.get("files")
            if not isinstance(files, list):
                raise ValueError("files must be a list")
            deleted = await _manager(request.app[KEY_HASS]).async_delete_files(files)
            return web.json_response({"deleted": deleted})
        except (ValueError, TypeError) as exc:
            return _error(str(exc), 400)


class DeleteRemoteFilesView(HomeAssistantView):
    url = f"{API_BASE}/files/remote-delete"
    name = f"api:{DOMAIN}:files_remote_delete"
    requires_auth = True

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            files = body.get("files")
            printers = body.get("printers")
            if not isinstance(files, list) or not isinstance(printers, list):
                raise ValueError("files and printers must both be lists")
            result = await _manager(request.app[KEY_HASS]).async_delete_remote_files(
                files, printers
            )
            return web.json_response(result)
        except (ValueError, TypeError) as exc:
            return _error(str(exc), 400)


class CopyView(HomeAssistantView):
    url = f"{API_BASE}/copy"
    name = f"api:{DOMAIN}:copy"
    requires_auth = True

    @require_admin
    async def post(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            files = body.get("files")
            printers = body.get("printers")
            if not isinstance(files, list) or not isinstance(printers, list):
                raise ValueError("files and printers must both be lists")
            job_id = await _manager(request.app[KEY_HASS]).async_start_copy(files, printers)
            return web.json_response({"job_id": job_id})
        except (ValueError, TypeError) as exc:
            return _error(str(exc), 400)


class JobView(HomeAssistantView):
    url = f"{API_BASE}/jobs/{{job_id}}"
    name = f"api:{DOMAIN}:job"
    requires_auth = True

    @require_admin
    async def get(self, request: web.Request, job_id: str) -> web.Response:
        job = _manager(request.app[KEY_HASS]).get_job(job_id)
        if job is None:
            return _error("Job not found", 404)
        return web.json_response(job)


def register_views(hass: HomeAssistant) -> None:
    """Register integration HTTP views once."""
    hass.http.register_view(PrintersView())
    hass.http.register_view(PrinterView())
    hass.http.register_view(FilesView())
    hass.http.register_view(StageChunkView())
    hass.http.register_view(DeleteFilesView())
    hass.http.register_view(DeleteRemoteFilesView())
    hass.http.register_view(CopyView())
    hass.http.register_view(JobView())
