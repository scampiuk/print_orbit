"""Constants for Print Orbit."""

DOMAIN = "print_orbit"
LEGACY_DOMAIN = "centauri_file_sync"
NAME = "Print Orbit"
VERSION = "0.5.0"
PANEL_TITLE = NAME
PANEL_ICON = "mdi:orbit"
PANEL_URL = DOMAIN
STATIC_URL = f"/{DOMAIN}_static"
API_BASE = f"/api/{DOMAIN}"
STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.printers"
LEGACY_STORAGE_KEY = f"{LEGACY_DOMAIN}.printers"
MAX_FILES_PER_BATCH = 100
MAX_PRINTERS_PER_JOB = 32
ALLOWED_SUFFIXES = {".gcode"}
