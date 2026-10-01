# Print Orbit for Home Assistant

Manage, monitor and schedule your 3D printers from Home Assistant.

Print Orbit is a printer-agnostic workspace with adapter-based device support. Version 0.4 focuses on staging and distributing already-sliced `.gcode` files to Elegoo Centauri printers; monitoring, scheduling, remote file management and more printer adapters are roadmap items.

## Current features

- Add multiple Elegoo Centauri Carbon printers by IP address.
- Stage many `.gcode` files in Home Assistant, including files larger than Home Assistant Core's 16 MiB per-request limit through chunked browser uploads.
- Select any combination of files and printers.
- Send to different printers in parallel while sending files sequentially to each individual printer.
- See per-file and per-printer progress, warnings and errors.
- Delete selected remote G-code files from multiple CC1 printers in one confirmed action.
- Use the original Centauri Carbon (CC1) adapter; CC2 support is available with an access code but is not yet the primary test target.
- Upload over HTTP without consuming a CC1 SDCP/WebSocket connection slot.
- Use a responsive sidebar panel that follows the active Home Assistant theme.

Print Orbit does not currently start prints. Remote deletion is available for CC1 printers; CC2 deletion is reported as unsupported until its MQTT control adapter is added.

## Roadmap

- Browse remote files and extend deletion support to CC2 and additional printer adapters.
- View printer cameras in a status grid.
- Plan and schedule multi-stage or complex print jobs.
- Add adapters for printer families beyond Elegoo Centauri.

Roadmap items describe direction, not functionality in the current release.

## Interface conventions

The panel follows Home Assistant's frontend component and theme conventions. UI contributors should read [docs/UI_GUIDELINES.md](docs/UI_GUIDELINES.md) before changing the panel; automated coding agents must also follow [AGENTS.md](AGENTS.md).

## Releases

Published versions use GitHub Releases so HACS can offer normal updates. Maintainers should follow [RELEASING.md](RELEASING.md); the release workflow verifies version consistency and runs the frontend, HACS and hassfest checks before publishing.

## HACS installation

This repository is structured as a HACS **Integration** repository.

Until it is submitted to the default HACS catalogue, install it as a custom repository:

1. In Home Assistant, open **HACS**.
2. Open the three-dot menu and choose **Custom repositories**.
3. Add `https://github.com/scampiuk/print_orbit`.
4. Choose category **Integration**.
5. Install **Print Orbit**.
6. Restart Home Assistant.
7. Go to **Settings → Devices & services → Add integration**.
8. Search for **Print Orbit** and add it.
9. Open **Print Orbit** from the Home Assistant sidebar.

## Manual installation

Copy `custom_components/print_orbit` to:

```text
/config/custom_components/print_orbit
```

Restart Home Assistant, then add **Print Orbit** from **Settings → Devices & services**.

## Migrating from Centauri File Sync 0.3

Version 0.4 changes the Home Assistant domain from `centauri_file_sync` to `print_orbit`, so Home Assistant treats it as a new integration.

1. Remove the **Centauri File Sync** config entry from **Settings → Devices & services**.
2. In HACS, remove the existing Centauri File Sync repository entry. HACS retains the old integration domain in its local repository record, so an in-place update can otherwise target `/config/custom_components/centauri_file_sync`.
3. Remove `/config/custom_components/centauri_file_sync` if it remains, then add `https://github.com/scampiuk/print_orbit` again as an **Integration** custom repository and install version 0.4.0. Confirm the target path is `/config/custom_components/print_orbit`.
4. Restart Home Assistant.
5. Add **Print Orbit** from **Settings → Devices & services**.

On first setup, Print Orbit moves saved printer configuration and staged G-code from the old storage location. Existing files in the new location take precedence. The legacy printer store and any emptied legacy staging directories are removed after migration.

## Where staged files live

Staged G-code files are stored locally under:

```text
/config/print_orbit/files/
```

Printer configuration is stored using Home Assistant's normal integration storage.

## Duplicate filenames

Version 0.4 does not open a printer control connection to list remote files before uploading. If a filename already exists, the printer may keep both files by renaming the new upload. The completion screen explicitly warns when this has not been checked. Remote file management is planned separately from the HTTP-only uploader.

## Safety scope

Version 0.4 exposes no print-start action. File distribution and explicitly confirmed CC1 remote deletion are the printer-changing operations.
