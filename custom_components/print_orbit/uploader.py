"""File transfer and remote file deletion for Elegoo Centauri printers.

Uploads use the printers' HTTP file-transfer surfaces. Remote deletion uses the
CC1 SDCP control channel; it is deliberately separate from uploads and never
starts, pauses or stops a print.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Literal

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

PrinterModel = Literal["cc1", "cc2"]
ProgressCallback = Callable[[int, int], None]
CHUNK_SIZE = 1024 * 1024
REMOTE_COMMAND_TIMEOUT = 10


class RemoteDeleteUnsupportedError(RuntimeError):
    """The printer model does not yet expose remote deletion here."""


def _file_md5(path: Path) -> str:
    digest = hashlib.md5()  # noqa: S324 - required by the printer's wire protocol.
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def _read_chunk(path: Path, offset: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(CHUNK_SIZE)


async def upload_file_to_printer(
    *,
    hass: HomeAssistant,
    host: str,
    model: PrinterModel,
    local_path: Path,
    remote_name: str,
    progress: ProgressCallback | None = None,
    access_code: str | None = None,
) -> str:
    """Upload one G-code file without using the printer control channel."""
    total = await hass.async_add_executor_job(lambda: local_path.stat().st_size)
    if total <= 0:
        raise ValueError("Cannot upload an empty file")
    checksum = await hass.async_add_executor_job(_file_md5, local_path)
    session = async_get_clientsession(hass)
    timeout = aiohttp.ClientTimeout(total=60)

    if model == "cc2":
        if not access_code:
            raise ValueError("CC2 requires an access code")
        await _upload_cc2(
            hass=hass,
            session=session,
            timeout=timeout,
            host=host,
            local_path=local_path,
            remote_name=remote_name,
            checksum=checksum,
            total=total,
            access_code=access_code,
            progress=progress,
        )
    else:
        await _upload_cc1(
            hass=hass,
            session=session,
            timeout=timeout,
            host=host,
            local_path=local_path,
            remote_name=remote_name,
            checksum=checksum,
            total=total,
            progress=progress,
        )

    return remote_name


def _mainboard_id(payload: object) -> str | None:
    """Find a MainboardID in an SDCP attributes/status payload."""
    if isinstance(payload, dict):
        value = payload.get("MainboardID")
        if isinstance(value, str) and value:
            return value
        for nested in payload.values():
            found = _mainboard_id(nested)
            if found:
                return found
    elif isinstance(payload, list):
        for nested in payload:
            found = _mainboard_id(nested)
            if found:
                return found
    return None


async def delete_files_from_printer(
    *,
    hass: HomeAssistant,
    host: str,
    model: PrinterModel,
    filenames: list[str],
    access_code: str | None = None,
) -> int:
    """Delete a batch of staged-name files from one printer.

    CC1 implements Cmd 259 over SDCP. CC2's MQTT control adapter is not yet
    part of this integration, so it is reported explicitly to the caller.
    """
    if model == "cc2":
        raise RemoteDeleteUnsupportedError(
            "Remote deletion is not supported for CC2 printers yet"
        )
    del access_code  # Reserved for the future CC2 control adapter.
    if not filenames:
        return 0

    mainboard_id: str | None = None
    session = async_get_clientsession(hass)
    timeout = aiohttp.ClientTimeout(total=REMOTE_COMMAND_TIMEOUT)
    async with session.ws_connect(
        f"ws://{host}:3030/websocket", timeout=timeout
    ) as websocket:
        deadline = time.monotonic() + REMOTE_COMMAND_TIMEOUT
        while mainboard_id is None and time.monotonic() < deadline:
            remaining = max(0.1, deadline - time.monotonic())
            try:
                message = await websocket.receive(timeout=remaining)
            except asyncio.TimeoutError:
                break
            if message.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                mainboard_id = _mainboard_id(json.loads(message.data))
            except (TypeError, ValueError):
                continue

        if not mainboard_id:
            raise RuntimeError(
                "Printer did not provide its mainboard ID; remote deletion was not attempted"
            )

        request_id = uuid.uuid4().hex
        await websocket.send_json(
            {
                "Id": mainboard_id,
                "Topic": f"sdcp/request/{mainboard_id}",
                "Data": {
                    "Cmd": 259,
                    "Data": {"FileList": [f"/local/{name}" for name in filenames]},
                    "RequestID": request_id,
                    "MainboardID": mainboard_id,
                    "TimeStamp": int(time.time() * 1000),
                    "From": 1,
                },
            }
        )

        deadline = time.monotonic() + REMOTE_COMMAND_TIMEOUT
        while time.monotonic() < deadline:
            remaining = max(0.1, deadline - time.monotonic())
            try:
                message = await websocket.receive(timeout=remaining)
            except asyncio.TimeoutError:
                break
            if message.type != aiohttp.WSMsgType.TEXT:
                continue
            try:
                payload = json.loads(message.data)
            except (TypeError, ValueError):
                continue
            data = payload.get("Data", {}) if isinstance(payload, dict) else {}
            if not isinstance(data, dict) or data.get("RequestID") != request_id:
                continue
            response_data = data.get("Data", {})
            ack = response_data.get("Ack") if isinstance(response_data, dict) else None
            if str(ack) != "0":
                raise RuntimeError(f"Printer rejected remote deletion: {response_data}")
            return len(filenames)

    raise RuntimeError("Printer did not acknowledge remote deletion")


async def _upload_cc1(
    *,
    hass: HomeAssistant,
    session: aiohttp.ClientSession,
    timeout: aiohttp.ClientTimeout,
    host: str,
    local_path: Path,
    remote_name: str,
    checksum: str,
    total: int,
    progress: ProgressCallback | None,
) -> None:
    upload_id = uuid.uuid4().hex
    url = f"http://{host}/uploadFile/upload"
    offset = 0

    while offset < total:
        chunk = await hass.async_add_executor_job(_read_chunk, local_path, offset)
        if not chunk:
            raise RuntimeError("Unexpected end of file while uploading")

        # The CC1 firmware stores RFC 7578 filename escaping literally. With
        # aiohttp's default quoting, spaces become "%20" on the printer.
        form = aiohttp.FormData(quote_fields=False)
        form.add_field("Check", "1")
        form.add_field("S-File-MD5", checksum)
        form.add_field("Offset", str(offset))
        form.add_field("Uuid", upload_id)
        form.add_field("TotalSize", str(total))
        form.add_field(
            "File",
            chunk,
            filename=remote_name,
            content_type="application/octet-stream",
        )

        async with session.post(url, data=form, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                text = (await response.text())[:300]
                raise RuntimeError(f"Printer returned HTTP {response.status}: {text}")
            try:
                payload = await response.json(content_type=None)
            except (ValueError, aiohttp.ContentTypeError) as exc:
                raise RuntimeError("Printer returned an invalid upload response") from exc
            if str(payload.get("code")) != "000000":
                raise RuntimeError(f"Printer rejected upload chunk: {payload}")

        offset += len(chunk)
        if progress:
            progress(min(offset, total), total)


async def _upload_cc2(
    *,
    hass: HomeAssistant,
    session: aiohttp.ClientSession,
    timeout: aiohttp.ClientTimeout,
    host: str,
    local_path: Path,
    remote_name: str,
    checksum: str,
    total: int,
    access_code: str,
    progress: ProgressCallback | None,
) -> None:
    url = f"http://{host}/upload"
    offset = 0

    while offset < total:
        chunk = await hass.async_add_executor_job(_read_chunk, local_path, offset)
        if not chunk:
            raise RuntimeError("Unexpected end of file while uploading")
        end = offset + len(chunk) - 1
        headers = {
            "Content-Type": "application/octet-stream",
            "Content-Range": f"bytes {offset}-{end}/{total}",
            "X-File-Name": remote_name,
            "X-File-MD5": checksum,
            "X-Token": access_code,
        }
        async with session.put(url, data=chunk, headers=headers, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                text = (await response.text())[:300]
                raise RuntimeError(f"Printer returned HTTP {response.status}: {text}")
            body = await response.read()
            if body:
                try:
                    payload = await response.json(content_type=None)
                except (ValueError, aiohttp.ContentTypeError):
                    payload = None
                if isinstance(payload, dict) and payload.get("error_code", 0) not in (0, "0", None):
                    raise RuntimeError(f"Printer rejected upload chunk: {payload}")

        offset += len(chunk)
        if progress:
            progress(min(offset, total), total)
