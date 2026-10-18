# Dock and runtime stability audit — 2026-10-14

Scope: Bloom 3.10.0 on Windows. Reviewed the four webview entry points, their event/listener lifecycles, dock and overlay interaction paths, Win32 foreground/window hooks, native tray menu handling, settings/pinned-app persistence, and taskbar shutdown paths. This is a source audit plus build/unit validation and a user smoke test of the dev build. The menu symptom was intermittent before this change, so longer use is still valuable.

## Findings and changes

| Priority | Finding | Change | Validation |
| --- | --- | --- | --- |
| High | Bloom's HUD or a native popup can become foreground during a slider drag/right-click. The smart-dock worker then walks a changing Z-order and alternates its overlap/fullscreen result, which can flash the dock. | Keep the last valid external foreground window while Bloom or a native popup owns focus; skip popup menu windows in overlap selection. | Rust check/clippy and Windows unit suite pass; user reports no flashing in the dev-build drag test. |
| High | WinEvent child-control notifications and the native OSD can schedule repeated `windows-changed` rescans while the user drags volume/brightness. The dock also replaced identical running-app state, causing unnecessary layout work. | Filter non-window WinEvents and OSD/menu windows, preserve destroyed-window rescans, only hide the OSD if visible, and avoid identical React state updates. | Frontend build and Rust gates pass; user reports no flashing in the dev-build drag test. |
| High | Four webviews could race on `settings.json` read/modify/write. A malformed file was silently treated as empty and overwritten by the next save. Direct writes could leave a truncated file after interruption. | Serialize settings writes and watcher cache updates; parse BOM safely, reject malformed files, and atomically replace settings and pinned-app files. | New tests cover concurrent saves, BOM reads, and preservation of a damaged file. |
| High | Quit/restart paths used `unwrap()` to get AppBar HWNDs before taskbar restoration. A failed lookup could interrupt cleanup. | Use the shared fallible AppBar release routine in menu and command exit paths; continue restoring the taskbar even if a handle is unavailable. | Rust check/clippy and unit suite pass. |
| Medium | UI Automation returns when an app's native tray menu opens, so Bloom could immediately release its dock interaction hold while the menu was still visible. | Identify the new native popup, hold the dock until it closes, and keep the frontend interaction state active during the command. | User reports neither custom nor native menu collapses the dock in the dev-build smoke test; recurrence remains possible. |
| Medium | Overlay sliders attached document mouse listeners that could survive a component unmount or focus loss mid-drag. | Centralize drag listeners with cleanup on mouse-up, window blur, and unmount. | Frontend build passes; user reports drag smoke test passes. |

## Remaining verification and limits

- Repeat brightness and volume drags over longer sessions with both the side HUD and notch controls. The initial dev-build smoke test did not reproduce flashing.
- Repeat Bloom's custom right-click menu on a pinned app and native tray menus on background apps over longer sessions. The initial dev-build smoke test did not reproduce collapse, but the original failure was intermittent.
- Test Quit and Restart from both the tray icon and settings, verifying the native taskbar is visible afterward. These paths cannot be fully exercised by unit tests without disrupting the running desktop.
- `cargo clippy --locked --all-targets` passes with 11 existing style warnings. This repository does not have a frontend test/lint script; `bun run build` provides strict TypeScript and Vite validation.
