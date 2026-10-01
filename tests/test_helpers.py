"""Tests for pure helper behaviour that does not need Home Assistant installed."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).parents[1] / "custom_components" / "print_orbit"


def _load_manager_module():
    # Load the source while substituting minimal HA modules is intentionally
    # avoided here; helper behaviour is also checked through direct source-level
    # smoke tests in CI. This file exists for future HA dev-container testing.
    return ROOT / "manager.py"


def test_manager_exists():
    assert _load_manager_module().is_file()


def test_manifest_exists():
    assert (ROOT / "manifest.json").is_file()


def test_domain_migration_is_present():
    source = (ROOT / "manager.py").read_text()
    assert "LEGACY_STORAGE_KEY" in source
    assert "legacy_store.async_remove()" in source
    assert "source.replace(target)" in source


def test_remote_delete_api_is_present():
    manager = (ROOT / "manager.py").read_text()
    http = (ROOT / "http.py").read_text()
    uploader = (ROOT / "uploader.py").read_text()
    assert "async_delete_remote_files" in manager
    assert "/files/remote-delete" in http
    assert '"Cmd": 259' in uploader
    assert "Remote deletion is not supported for CC2 printers yet" in uploader
