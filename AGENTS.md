# AGENTS.md

Windows-only Tauri v2 app: Rust backend + React 19/TypeScript frontend. Replaces the native Windows taskbar (dock) and adds a notch/island UI. Bun is the package manager. CI runs on `windows-latest`.

## Commands

Run from the repo root unless noted. Bun 1.4.0, Rust stable.

- `bun install` — deps (CI uses `bun install --frozen-lockfile`; never create a root `package-lock.json`)
- `bun run tauri dev` — full dev loop. Vite is on strict port 1420; do not start `bun run dev` separately
- `bun run build` — `tsc && vite build`; this is the frontend typecheck. `strict` + `noUnusedLocals`/`noUnusedParameters` fail the build. There is no root lint or frontend test script
- `cargo check --locked` and `cargo clippy --locked --all-targets` in `src-tauri` — CI's Rust gates. On this machine they need `.\scripts\vc-env.ps1`; see the Gotchas entry before running them
- `.\scripts\vc-env.ps1 <command>` — loads the MSVC toolchain, then runs the command. `.\scripts\vc-env.ps1 -Dir src-tauri cargo test --locked` for anything cargo, `.\scripts\vc-env.ps1 bun run tauri build` from the repo root
- `src-tauri/src/diagnostics.rs` — read-only machine snapshot behind `get_diagnostics` and Settings → About → Copy Diagnostics. It exists so a bug report carries the reporter's monitor layout, shell class state and crash marker instead of guessing. Collection must stay read-only: never call `set_taskbar_visibility`, never set `TRAY_INTERACTION_ACTIVE`, never touch Explorer. `REPORTED_SETTINGS` is an allow-list for the same reason — a full settings dump would leak `bloom-weather-city`
- `cargo test --locked` in `src-tauri` — pure-function unit tests. Fast on Windows; CI runs it alongside `check` and `clippy`
- `bun test scripts/` — frontend test (`scripts/dockApps.test.ts`), also in CI. There is still no general frontend test runner or lint script
- `bun run bump <x.y.z>` — bumps `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` together
- `bun run release <x.y.z>` — bump + commit + tag + push, must be on `main`. The release workflow fails unless all four version files match the tag. Before/after releasing, follow `RELEASE_CHECKLIST.md` (updater manifest verification, N‑1 install smoke test)
- `website/` is a separate static site: use `npm install` / `npm run dev` there. Root scripts and CI do not build it

## Architecture

- Four webview windows, each a separate Vite/HTML entry: `main` = notch (`index.html` → `src/main.tsx` → `src/App.tsx`), `dock` (`dock.html` → `src/Dock.tsx`), `overlay` (`overlay.html` → `src/Overlay.tsx`), `settings` (`settings.html` → `src/Settings.tsx`). Adding or renaming a window means editing `src-tauri/tauri.conf.json`, `vite.config.ts` inputs, the HTML file, and `src-tauri/capabilities/default.json`
- Rust entrypoint is `src-tauri/src/main.rs`; `lib.rs` is an empty stub. Every `#[tauri::command]` must be registered in the `generate_handler!` list in `main.rs`
- `commands.rs` = IPC surface; `services.rs` = long-lived Win32 hooks/workers (keyboard hook, thumbnail capture, audio visualizer, AppBar registration); `utils.rs` = settings cache and file IO; `state.rs`/`types.rs` = shared statics/types
- Backend→frontend events use `app.emit`: `settings-changed`, `settings-external-changed`, `media-update`, `volume-change`, `brightness-change`, `dock-overlap`, `notch-overlap`, `windows-changed`, `update-available`, `auto-update-status`. Listen via `@tauri-apps/api/event`

## Settings

- Stored in `%APPDATA%/com.sehaz.bloom/settings.json` as a flat object of `bloom-`-prefixed keys; all values are strings (`"true"`/`"false"` for booleans). `SETTINGS.md` documents every key
- UI write path: set `localStorage`, then `invoke("save_setting")` → backend caches it and emits `settings-changed`. External file edits are watched and emitted as `settings-external-changed`
- `src/hooks/useSettingsSync.ts` is the single sync hook for both events and normalizes string booleans/numbers
- The CSP in `tauri.conf.json` allow-lists network origins (weather APIs only); add new origins there. New Tauri plugins also need permissions in `capabilities/default.json`

## Gotchas

- **`cargo` needs the MSVC toolchain loaded, and nothing puts it on PATH.** `link.exe` lives in a versioned folder — `VC\Tools\MSVC\<version>\bin\Hostx64\x64\` — that VS replaces on every update, so a permanent PATH entry goes stale. PATH alone is not enough either: the msvc target links `msvcrt.lib`, which resolves only through `LIB`. MSBuild and CMake find the toolset through the registry; `rustc` does not, it does one PATH lookup and nothing else, so `cargo build` fails with ``linker `link.exe` not found`` on a machine where VS is installed and working. Run cargo through `.\scripts\vc-env.ps1`, or use the *Developer PowerShell for VS Insiders* shortcut. When checking for the toolset, `vswhere` needs **`-all -prerelease`** — without the prerelease flag it reports nothing for a VS 2026 Insiders install, which reads as "not installed" and sends you looking in the wrong place
- The app hides the native Windows taskbar and registers AppBars while running. Any new exit/restart path must restore the taskbar and unregister AppBars, like the tray menu in `main.rs` does. A marker file restores it after a crash
- This is a fork of `SehajveerSingh2005/bloom` and still ships the upstream `com.sehaz.bloom` identifier, so it shares `app_config_dir` (`settings.json`, `updater.json`, the taskbar marker) with an installed upstream build. Debug builds use a separate single-instance mutex (`BloomDevSingleInstance`) so both can run at once; release builds keep the shipped name. Changing the identifier later means migrating those files
- While `bun run tauri dev` is running, do NOT click Settings → General → **Restart Bloom**. It calls `handle.restart()`, which spawns a detached copy and kills the parent, so `cargo run` exits and takes Vite down with it. The detached copy keeps holding `target/debug/bloom.exe`, and the next build then fails with `failed to remove file ... Access is denied`. Quit the app instead, or just edit a Rust file — the watcher rebuilds and restarts on its own
- If the taskbar is hidden and the app is gone, the marker file is the only recovery path — see the "If your taskbar is missing" section in `README.md`. Keep any new code that hides the taskbar writing and clearing that marker
- The `windows` crate is pinned to 0.61 with an explicit feature list in `Cargo.toml`; add features there when using new Win32 APIs
- That feature list is not self-sufficient, and this is the most expensive trap in the repo. Two features the code needs — `Win32_UI_Shell_Common` (for `ILCombine`, `ILFree`, `SHGetNameFromIDList`, `SHGetKnownFolderIDList` in `commands.rs`) and `Win32_System_SystemServices` (for `IDropTarget_Impl` in `shelf.rs`) — are **not listed**, and `bloom` enables neither. Check with `cargo tree --locked -e features -i windows@0.61.3`: today `Win32_UI_Shell_Common` is switched on by `tauri-plugin-opener` 2.5.5, and `Win32_System_SystemServices` by `tao` 0.35.3 and `wry` 0.55.1. Bump any one of those past its current version and the build breaks with `E0432` unresolved imports pointing at `commands.rs` and `shelf.rs` — files the bump never touched. Listing both features in `Cargo.toml` is the fix, but only the first step
- After adding those two features the real blocker appears: 43 `E0308` mismatched-type errors whose cause the compiler names directly — *multiple different versions of crate `windows` in the dependency graph*. A newer stack pulls `windows` 0.62.2 while `Cargo.toml` pins `0.61.3`, and `HWND` from the two versions are distinct types, so every function taking one rejects the other. Clearing that needs a `windows` 0.61 → 0.62 migration across the codebase. Verified against upstream's PR #194, which bumps `tauri` 2.11→2.12, `wry` 0.55→0.57, `tao` 0.35→0.37 and `tauri-plugin-opener` 2.5→2.7 all at once and hits both stages in order. Treat any Dependabot PR moving those past their current versions as a migration, not a merge
- Commits follow conventional commits (`feat:`, `fix:`); release notes are generated from them and commits touching only `website/*`, `.github/*`, or `*.md` are filtered out
