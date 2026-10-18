use base64::{engine::general_purpose, Engine as _};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::Manager;
use windows::core::Interface;
use windows::Win32::Foundation::{HGLOBAL, HWND};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_ContainerFormatPng, GUID_WICPixelFormat32bppPBGRA,
    IWICImagingFactory, WICBitmapEncoderNoCache,
};
use windows::Win32::System::Com::StructuredStorage::{CreateStreamOnHGlobal, GetHGlobalFromStream};
use windows::Win32::System::Com::{
    CoCreateInstance, IPersistFile, CLSCTX_ALL, CLSCTX_INPROC_SERVER,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
use windows::Win32::UI::WindowsAndMessaging::HICON;

pub fn resolve_shortcut(path: &str) -> Option<(String, String)> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;

        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        persist_file
            .Load(
                windows::core::PCWSTR(wide_path.as_ptr()),
                windows::Win32::System::Com::STGM(0),
            )
            .ok()?;

        let _ = shell_link.Resolve(HWND(std::ptr::null_mut()), 1 | 16 | 32);

        let mut buffer = [0u16; 260];
        let mut data = windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW::default();
        shell_link.GetPath(&mut buffer, &mut data, 0).ok()?;

        let mut arg_buffer = [0u16; 1024];
        let _ = shell_link.GetArguments(&mut arg_buffer);

        let target = String::from_utf16_lossy(&buffer)
            .trim_matches(char::from(0))
            .to_string();
        let args = String::from_utf16_lossy(&arg_buffer)
            .trim_matches(char::from(0))
            .to_string();

        if target.trim().is_empty() {
            None
        } else {
            Some((target, args))
        }
    }
}

pub static ORIGINAL_TRAY_RECT: std::sync::Mutex<Option<windows::Win32::Foundation::RECT>> =
    std::sync::Mutex::new(None);
static ORIGINAL_SEC_TRAY_RECT: std::sync::Mutex<Option<windows::Win32::Foundation::RECT>> =
    std::sync::Mutex::new(None);
static ORIGINAL_TASKBAR_STATE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);

static TASKBAR_MARKER: OnceLock<PathBuf> = OnceLock::new();
static TASKBAR_WATCHDOG_STARTED: std::sync::Mutex<bool> = std::sync::Mutex::new(false);

/// Point the crash-recovery marker at this user's app config dir (called from setup).
pub fn init_taskbar_marker(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = TASKBAR_MARKER.set(dir.join("taskbar_hidden.flag"));
    }
}

/// A separate Bloom process restores Explorer's taskbar when this process is
/// terminated without running Tauri's exit handlers.
pub fn start_taskbar_watchdog() -> std::io::Result<()> {
    let mut started = TASKBAR_WATCHDOG_STARTED
        .lock()
        .map_err(|_| std::io::Error::other("taskbar watchdog lock poisoned"))?;
    if *started {
        return Ok(());
    }
    let marker = TASKBAR_MARKER.get().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "taskbar marker path unavailable",
        )
    })?;
    if let Some(dir) = marker.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::process::Command::new(std::env::current_exe()?)
        .arg("--taskbar-watchdog")
        .arg(std::process::id().to_string())
        .arg(marker)
        .spawn()?;
    *started = true;
    Ok(())
}

pub fn run_taskbar_watchdog(parent_pid: u32, marker: PathBuf) {
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };
    // Only treat a missing PID as an already-exited parent. Access denied or
    // another wait failure must not restore the taskbar over a live Bloom.
    unsafe {
        match OpenProcess(PROCESS_SYNCHRONIZE, false, parent_pid) {
            Ok(parent) => {
                let result = WaitForSingleObject(parent, INFINITE);
                let _ = CloseHandle(parent);
                if result != WAIT_OBJECT_0 {
                    return;
                }
            }
            Err(_) if GetLastError() == ERROR_INVALID_PARAMETER => {}
            Err(_) => {
                return;
            }
        }
    }
    let _ = TASKBAR_MARKER.set(marker.clone());
    // Explorer can be restarting at the same time. Retry briefly, but never
    // act on a marker owned by a replacement Bloom process.
    for _ in 0..120 {
        if std::fs::read_to_string(&marker)
            .ok()
            .and_then(|contents| parse_marker_pid(&contents))
            != Some(parent_pid)
        {
            return;
        }
        restore_taskbar_after_crash();
        if !marker.exists() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

/// True if a previous Bloom session died without restoring the native taskbar.
pub fn taskbar_marker_exists() -> bool {
    TASKBAR_MARKER.get().is_some_and(|p| p.exists())
}

/// The taskbar state recorded before Bloom forced auto-hide, or `None` when no
/// marker survives. Read by diagnostics so a report can show what the next
/// launch would restore, not merely that a marker exists.
pub fn taskbar_marker_state() -> Option<i32> {
    TASKBAR_MARKER
        .get()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|contents| parse_marker_state(&contents))
}

/// The marker records the user's own taskbar state (`ABM_GETSTATE`) from
/// before Bloom forced auto-hide, so a crash can't lose it. Markers written by
/// older versions only contain "1" and carry no state.
fn marker_contents(
    original_state: i32,
    pid: u32,
    primary: Option<windows::Win32::Foundation::RECT>,
    secondary: Option<windows::Win32::Foundation::RECT>,
) -> String {
    let mut contents = format!("abstate={original_state}\npid={pid}\n");
    if let Some(rect) = primary {
        contents.push_str(&format!(
            "primary={},{},{},{}\n",
            rect.left, rect.top, rect.right, rect.bottom
        ));
    }
    if let Some(rect) = secondary {
        contents.push_str(&format!(
            "secondary={},{},{},{}\n",
            rect.left, rect.top, rect.right, rect.bottom
        ));
    }
    contents
}

fn parse_marker_state(contents: &str) -> Option<i32> {
    contents
        .lines()
        .next()?
        .strip_prefix("abstate=")?
        .parse()
        .ok()
}

fn parse_marker_pid(contents: &str) -> Option<u32> {
    contents
        .lines()
        .find_map(|line| line.strip_prefix("pid=")?.parse().ok())
}

fn parse_marker_rect(contents: &str, key: &str) -> Option<windows::Win32::Foundation::RECT> {
    let value = contents.lines().find_map(|line| line.strip_prefix(key))?;
    let mut parts = value.split(',').map(str::parse::<i32>);
    let rect = windows::Win32::Foundation::RECT {
        left: parts.next()?.ok()?,
        top: parts.next()?.ok()?,
        right: parts.next()?.ok()?,
        bottom: parts.next()?.ok()?,
    };
    parts.next().is_none().then_some(rect)
}

/// Restores the native taskbar after a previous session died with it hidden.
/// The state saved in the marker becomes the original to restore; without it,
/// the current state would be captured instead, and that is Bloom's own
/// auto-hide.
pub fn restore_taskbar_after_crash() {
    let saved = TASKBAR_MARKER
        .get()
        .and_then(|p| std::fs::read_to_string(p).ok());
    if let Some(contents) = saved {
        if let Some(state) = parse_marker_state(&contents) {
            ORIGINAL_TASKBAR_STATE.store(state, std::sync::atomic::Ordering::Relaxed);
        }
        if let Some(rect) = parse_marker_rect(&contents, "primary=") {
            if let Ok(mut guard) = ORIGINAL_TRAY_RECT.lock() {
                *guard = Some(rect);
            }
        }
        if let Some(rect) = parse_marker_rect(&contents, "secondary=") {
            if let Ok(mut guard) = ORIGINAL_SEC_TRAY_RECT.lock() {
                *guard = Some(rect);
            }
        }
    }
    set_taskbar_visibility(true, true);
}

pub fn set_taskbar_visibility(visible: bool, always_on_top: bool) -> bool {
    // Delayed AppBar and tray callbacks cannot hide Windows' taskbar after the
    // dock has been disabled or while its tray is in use.
    if !visible
        && (!dock_enabled()
            || crate::state::TRAY_INTERACTION_ACTIVE.load(std::sync::atomic::Ordering::Relaxed))
    {
        return false;
    }
    unsafe {
        use windows::Win32::UI::Shell::{
            SHAppBarMessage, ABM_GETSTATE, ABM_GETTASKBARPOS, ABM_SETSTATE, APPBARDATA,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            FindWindowA, GetWindowRect, IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOW,
        };

        // Startup retries and display/AppBar handlers can still try to hide the
        // taskbar after shutdown restored it, leaving the user without one.
        if !visible && crate::state::SHUTTING_DOWN.load(std::sync::atomic::Ordering::Relaxed) {
            return false;
        }

        let tray_class = windows::core::PCSTR(c"Shell_TrayWnd".as_ptr() as *const u8);
        let secondary_tray_class =
            windows::core::PCSTR(c"Shell_SecondaryTrayWnd".as_ptr() as *const u8);
        let Ok(tray_hwnd) = FindWindowA(tray_class, windows::core::PCSTR::null()) else {
            return false;
        };
        let secondary_tray = FindWindowA(secondary_tray_class, windows::core::PCSTR::null()).ok();

        // Legacy crash markers did not save the original window rectangle.
        // Explorer's AppBar position can still recover it after Bloom moved the
        // taskbar window off-screen.
        if visible {
            if let Ok(mut guard) = ORIGINAL_TRAY_RECT.lock() {
                if guard.is_none() {
                    let mut position = APPBARDATA {
                        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
                        hWnd: tray_hwnd,
                        ..Default::default()
                    };
                    if SHAppBarMessage(ABM_GETTASKBARPOS, &mut position) != 0
                        && position.rc.right > position.rc.left
                        && position.rc.bottom > position.rc.top
                        && position.rc.left > -9000
                        && position.rc.top > -9000
                    {
                        *guard = Some(position.rc);
                    }
                }
            }
        }

        if !visible {
            if let Ok(mut guard) = ORIGINAL_TRAY_RECT.lock() {
                if guard.is_none() {
                    let mut rect = windows::Win32::Foundation::RECT::default();
                    if GetWindowRect(tray_hwnd, &mut rect).is_ok() {
                        *guard = Some(rect);
                    }
                }
            }
            if let Some(hwnd) = secondary_tray {
                if let Ok(mut guard) = ORIGINAL_SEC_TRAY_RECT.lock() {
                    if guard.is_none() {
                        let mut rect = windows::Win32::Foundation::RECT::default();
                        if GetWindowRect(hwnd, &mut rect).is_ok() {
                            *guard = Some(rect);
                        }
                    }
                }
            }
        }

        // Save original taskbar state before modifying
        if ORIGINAL_TASKBAR_STATE.load(std::sync::atomic::Ordering::Relaxed) == -1 {
            let mut get_abd = APPBARDATA {
                cbSize: std::mem::size_of::<APPBARDATA>() as u32,
                hWnd: tray_hwnd,
                ..Default::default()
            };
            let original_state = SHAppBarMessage(ABM_GETSTATE, &mut get_abd);
            ORIGINAL_TASKBAR_STATE
                .store(original_state as i32, std::sync::atomic::Ordering::Relaxed);
        }

        // Persist the original state and placement before hiding. The watchdog
        // restores it if this process is force-killed, and startup is a fallback.
        // Written after the original state is known, so the marker can carry it.
        if !visible {
            if start_taskbar_watchdog().is_err() {
                return false;
            }
            let Some(p) = TASKBAR_MARKER.get() else {
                return false;
            };
            if p.exists() {
                if std::fs::read_to_string(p)
                    .ok()
                    .and_then(|contents| parse_marker_pid(&contents))
                    != Some(std::process::id())
                {
                    return false;
                }
            } else {
                use std::io::Write;
                let original = ORIGINAL_TASKBAR_STATE.load(std::sync::atomic::Ordering::Relaxed);
                let primary = ORIGINAL_TRAY_RECT.lock().ok().and_then(|guard| *guard);
                let secondary = ORIGINAL_SEC_TRAY_RECT.lock().ok().and_then(|guard| *guard);
                let written = std::fs::File::create(p).and_then(|mut file| {
                    file.write_all(
                        marker_contents(original, std::process::id(), primary, secondary)
                            .as_bytes(),
                    )?;
                    file.sync_all()
                });
                if written.is_err() {
                    return false;
                }
            }
        }

        let state_val = if visible {
            let orig = ORIGINAL_TASKBAR_STATE.load(std::sync::atomic::Ordering::Relaxed);
            if orig != -1 {
                orig as isize
            } else {
                if always_on_top {
                    2
                } else {
                    1
                }
            }
        } else {
            1 // Force Auto-hide when hiding
        };

        // 1. Set the taskbar state (Auto-hide or Always-on-top)
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: tray_hwnd,
            lParam: windows::Win32::Foundation::LPARAM(state_val),
            ..Default::default()
        };
        SHAppBarMessage(ABM_SETSTATE, &mut abd);

        // 2. Control visibility of the primary taskbar
        let mut primary_positioned = true;
        {
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowLongA, SetLayeredWindowAttributes, SetWindowLongA, SetWindowPos,
                GWL_EXSTYLE, LWA_ALPHA, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED,
                WS_EX_TRANSPARENT,
            };
            if visible {
                // Revert any lingering WS_EX_LAYERED / WS_EX_TRANSPARENT left by
                // open_system_tray if the user quit before the tray thread cleaned up.
                let ex = GetWindowLongA(tray_hwnd, GWL_EXSTYLE);
                let cleaned = ex & !(WS_EX_LAYERED.0 as i32) & !(WS_EX_TRANSPARENT.0 as i32);
                if cleaned != ex {
                    let _ = SetWindowLongA(tray_hwnd, GWL_EXSTYLE, cleaned);
                    let _ = SetLayeredWindowAttributes(
                        tray_hwnd,
                        windows::Win32::Foundation::COLORREF(0),
                        255,
                        LWA_ALPHA,
                    );
                }
                if let Ok(guard) = ORIGINAL_TRAY_RECT.lock() {
                    if let Some(rect) = *guard {
                        primary_positioned = SetWindowPos(
                            tray_hwnd,
                            None,
                            rect.left,
                            rect.top,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                        .is_ok();
                    }
                }
                let _ = ShowWindow(tray_hwnd, SW_SHOW);
            } else {
                let has_rect = ORIGINAL_TRAY_RECT
                    .lock()
                    .map(|g| g.is_some())
                    .unwrap_or(false);
                if !has_rect {
                    let mut rect = windows::Win32::Foundation::RECT::default();
                    let _ = GetWindowRect(tray_hwnd, &mut rect);
                    if let Ok(mut guard) = ORIGINAL_TRAY_RECT.lock() {
                        *guard = Some(rect);
                    }
                }
                let _ = ShowWindow(tray_hwnd, SW_HIDE);
                // Move it far off-screen to prevent any "thin line" artifacts or flashes
                let _ = SetWindowPos(
                    tray_hwnd,
                    None,
                    -10000,
                    -10000,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }

        // 3. Control visibility of secondary taskbars (multi-monitor)
        let mut secondary_positioned = true;
        if let Some(secondary_tray_hwnd) = secondary_tray {
            use windows::Win32::UI::WindowsAndMessaging::{
                SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
            };
            if visible {
                if let Ok(guard) = ORIGINAL_SEC_TRAY_RECT.lock() {
                    if let Some(rect) = *guard {
                        secondary_positioned = SetWindowPos(
                            secondary_tray_hwnd,
                            None,
                            rect.left,
                            rect.top,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                        )
                        .is_ok();
                    }
                }
                let _ = ShowWindow(secondary_tray_hwnd, SW_SHOW);
            } else {
                let has_sec_rect = ORIGINAL_SEC_TRAY_RECT
                    .lock()
                    .map(|g| g.is_some())
                    .unwrap_or(false);
                if !has_sec_rect {
                    let mut rect = windows::Win32::Foundation::RECT::default();
                    let _ = GetWindowRect(secondary_tray_hwnd, &mut rect);
                    if let Ok(mut guard) = ORIGINAL_SEC_TRAY_RECT.lock() {
                        *guard = Some(rect);
                    }
                }
                let _ = ShowWindow(secondary_tray_hwnd, SW_HIDE);
                let _ = SetWindowPos(
                    secondary_tray_hwnd,
                    None,
                    -10000,
                    -10000,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
        }
        let on_screen = |hwnd| {
            let mut rect = windows::Win32::Foundation::RECT::default();
            GetWindowRect(hwnd, &mut rect).is_ok() && rect.left > -9000 && rect.top > -9000
        };
        let primary_matches = primary_positioned
            && IsWindowVisible(tray_hwnd).as_bool() == visible
            && (!visible || on_screen(tray_hwnd));
        let secondary_matches = secondary_positioned
            && secondary_tray.is_none_or(|hwnd| {
                IsWindowVisible(hwnd).as_bool() == visible && (!visible || on_screen(hwnd))
            });
        if visible && primary_matches && secondary_matches {
            if let Some(p) = TASKBAR_MARKER.get() {
                if p.exists() && std::fs::remove_file(p).is_err() {
                    return false;
                }
            }
        }
        primary_matches && secondary_matches
    }
}

/// Extracts the icon a shortcut declares for itself (`IShellLinkW::GetIconLocation`).
///
/// This is how Firefox web apps and user-customized shortcuts store their icon.
/// Returns only real image files (`.ico`, `.png`, ...). Icon references into
/// executables/DLLs are ignored so the regular target-based extraction is used
/// instead (it yields a better icon than the file's first resource).
pub fn get_shortcut_icon_location(path: &str) -> Option<String> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_ALL).ok()?;
        let persist_file: IPersistFile = shell_link.cast().ok()?;
        let wide_path: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        persist_file
            .Load(
                windows::core::PCWSTR(wide_path.as_ptr()),
                windows::Win32::System::Com::STGM(0),
            )
            .ok()?;

        let mut buffer = [0u16; 512];
        let mut index = 0i32;
        shell_link.GetIconLocation(&mut buffer, &mut index).ok()?;

        let raw = String::from_utf16_lossy(&buffer)
            .trim_matches(char::from(0))
            .trim()
            .to_string();
        if raw.is_empty() {
            return None;
        }

        let location = expand_env_vars(&raw);
        let ext = std::path::Path::new(&location)
            .extension()?
            .to_str()?
            .to_lowercase();
        if !matches!(
            ext.as_str(),
            "ico" | "png" | "jpg" | "jpeg" | "bmp" | "webp" | "gif"
        ) {
            return None;
        }
        if !std::path::Path::new(&location).exists() {
            return None;
        }
        Some(location)
    }
}

/// Expands `%VAR%` references using the current process environment.
fn expand_env_vars(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('%') {
        result.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let name = &after[..end];
            if !name.is_empty() && !name.contains(' ') {
                match std::env::var(name) {
                    Ok(value) => result.push_str(&value),
                    Err(_) => {
                        result.push('%');
                        result.push_str(name);
                        result.push('%');
                    }
                }
            } else {
                result.push('%');
                result.push_str(name);
                result.push('%');
            }
            rest = &after[end + 1..];
        } else {
            result.push_str(&rest[start..]);
            rest = "";
            break;
        }
    }
    result.push_str(rest);
    result
}

/// Reads an image file (PNG/ICO/etc.) and returns it as a base64 PNG data URI.
pub fn image_file_to_base64(path: &str) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 8 * 1024 * 1024 {
        return None;
    }

    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        use base64::Engine;
        return Some(format!(
            "data:image/png;base64,{}",
            general_purpose::STANDARD.encode(&bytes)
        ));
    }

    let img = image::load_from_memory(&bytes).ok()?;
    let mut png: Vec<u8> = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    use base64::Engine;
    Some(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(&png)
    ))
}

/// True when the window's client area covers its monitor and it is not a
/// standard (captioned) maximized window — i.e. a real fullscreen window.
pub fn is_window_fullscreen(hwnd: HWND) -> bool {
    unsafe {
        use windows::Win32::Foundation::{POINT, RECT};
        use windows::Win32::Graphics::Gdi::{
            ClientToScreen, GetMonitorInfoA, MonitorFromWindow, MONITORINFO,
            MONITOR_DEFAULTTONEAREST,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetClientRect, GetWindowLongW, IsZoomed, GWL_STYLE, WS_CAPTION, WS_MAXIMIZE,
        };

        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_invalid() {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoA(monitor, &mut info).as_bool() {
            return false;
        }
        let screen = info.rcMonitor;

        let mut client = RECT::default();
        if GetClientRect(hwnd, &mut client).is_err() {
            return false;
        }
        let mut top_left = POINT {
            x: client.left,
            y: client.top,
        };
        let mut bottom_right = POINT {
            x: client.right,
            y: client.bottom,
        };
        let _ = ClientToScreen(hwnd, &mut top_left);
        let _ = ClientToScreen(hwnd, &mut bottom_right);

        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let is_maximized_standard = (IsZoomed(hwnd).as_bool() || (style & WS_MAXIMIZE.0) != 0)
            && (style & WS_CAPTION.0) != 0;

        let client_fullscreen = top_left.x <= screen.left
            && top_left.y <= screen.top
            && bottom_right.x >= screen.right
            && bottom_right.y >= screen.bottom;
        client_fullscreen && !is_maximized_standard
    }
}

/// Resolves a bare executable name (e.g. `notepad.exe`, `msedge`, `wt.exe`) to a
/// full path, using the same mechanisms Windows uses: the registry `App Paths`
/// registration, then the standard executable search path, then a few well-known
/// install locations for apps that register in neither.
///
/// This matters for default pins: on Windows 11 `notepad.exe` resolves through
/// App Paths to the Store Notepad package, whose icon comes from the package
/// manifest rather than the stale stub in System32.
pub fn resolve_executable_path(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_matches('"');
    if trimmed.is_empty() || trimmed.contains('\\') || trimmed.contains('/') {
        return None;
    }

    let file = if trimmed.to_lowercase().ends_with(".exe") {
        trimmed.to_string()
    } else {
        format!("{}.exe", trimmed)
    };

    if let Some(path) = app_paths_lookup(&file) {
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    if let Some(path) = search_system_path(&file) {
        return Some(path);
    }
    known_install_location(&file)
}

/// Reads `HKCU`/`HKLM\Software\Microsoft\Windows\CurrentVersion\App Paths\<file>`.
fn app_paths_lookup(file: &str) -> Option<String> {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
        KEY_READ,
    };

    unsafe {
        let subkey: Vec<u16> = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{}",
            file
        )
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

        for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            let mut key = HKEY::default();
            if RegOpenKeyExW(
                root,
                windows::core::PCWSTR(subkey.as_ptr()),
                None,
                KEY_READ,
                &mut key,
            )
            .0 != 0
            {
                continue;
            }

            let mut buffer = [0u16; 1024];
            let mut size = (buffer.len() * 2) as u32;
            let status = RegQueryValueExW(
                key,
                windows::core::PCWSTR::null(),
                None,
                None,
                Some(buffer.as_mut_ptr() as *mut u8),
                Some(&mut size),
            );
            let _ = RegCloseKey(key);
            if status.0 != 0 {
                continue;
            }

            let value = String::from_utf16_lossy(&buffer[..(size as usize / 2).min(buffer.len())]);
            let value = value
                .trim_matches(char::from(0))
                .trim()
                .trim_matches('"')
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
        None
    }
}

/// Standard executable search (PATH, System32, Windows, ...).
fn search_system_path(file: &str) -> Option<String> {
    use windows::Win32::Storage::FileSystem::SearchPathW;

    unsafe {
        let wide: Vec<u16> = file.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buffer = vec![0u16; 32768];
        let len = SearchPathW(
            None,
            windows::core::PCWSTR(wide.as_ptr()),
            windows::core::PCWSTR::null(),
            Some(&mut buffer),
            None,
        );
        if len == 0 || len as usize >= buffer.len() {
            return None;
        }

        let path = String::from_utf16_lossy(&buffer[..len as usize]);
        if std::path::Path::new(&path).exists() {
            Some(path)
        } else {
            None
        }
    }
}

/// Last resort for apps that are neither registered in App Paths nor on PATH.
fn known_install_location(file: &str) -> Option<String> {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let home = std::env::var("USERPROFILE").unwrap_or_default();

    let candidates: Vec<String> = match file.to_lowercase().as_str() {
        "code.exe" | "code-insiders.exe" => vec![
            format!(
                "{}\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
                home
            ),
            format!("{}\\Programs\\Microsoft VS Code\\Code.exe", local),
            "C:\\Program Files\\Microsoft VS Code\\Code.exe".into(),
            "C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe".into(),
        ],
        "msedge.exe" => vec![
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe".into(),
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe".into(),
            format!("{}\\Microsoft\\Edge\\Application\\msedge.exe", local),
        ],
        "notepad.exe" => vec![
            "C:\\Windows\\System32\\notepad.exe".into(),
            "C:\\Windows\\notepad.exe".into(),
        ],
        "explorer.exe" => vec!["C:\\Windows\\explorer.exe".into()],
        _ => Vec::new(),
    };

    candidates
        .into_iter()
        .find(|c| std::path::Path::new(c).exists())
}

/// Reads the `System.AppUserModel.ID` shell property of a window.
///
/// This is the same identity the taskbar uses to group windows: for Store/UWP
/// apps it is the package AppUserModelID, for installed browser web apps it is
/// the browser's web app id. Unlike the process command line it is always
/// available on the window itself.
pub fn get_window_app_user_model_id(hwnd: HWND) -> Option<String> {
    unsafe {
        use windows::Win32::Foundation::PROPERTYKEY;
        use windows::Win32::System::Com::StructuredStorage::{
            PropVariantClear, PropVariantToStringAlloc,
        };
        use windows::Win32::UI::Shell::PropertiesSystem::{
            IPropertyStore, SHGetPropertyStoreForWindow,
        };

        const PKEY_APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
            fmtid: windows::core::GUID {
                data1: 0x9F4C2855,
                data2: 0x9F79,
                data3: 0x4B39,
                data4: [0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3],
            },
            pid: 5,
        };

        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        let mut prop = store.GetValue(&PKEY_APP_USER_MODEL_ID).ok()?;
        let result = PropVariantToStringAlloc(&prop)
            .ok()
            .map(|pwstr| String::from_utf16_lossy(pwstr.as_wide()).trim().to_string());
        let _ = PropVariantClear(&mut prop);
        result.filter(|s| !s.is_empty())
    }
}

pub unsafe fn icon_to_base64(hicon: HICON) -> Option<String> {
    let factory: IWICImagingFactory =
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
    let bitmap = factory.CreateBitmapFromHICON(hicon).ok()?;
    wic_bitmap_to_base64(&factory, &bitmap)
}

/// Encodes an `HBITMAP` (as returned by `IShellItemImageFactory::GetImage`) to a base64 PNG.
pub unsafe fn hbitmap_to_base64(hbitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<String> {
    let factory: IWICImagingFactory =
        CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).ok()?;
    let bitmap = factory
        .CreateBitmapFromHBITMAP(
            hbitmap,
            windows::Win32::Graphics::Gdi::HPALETTE::default(),
            windows::Win32::Graphics::Imaging::WICBitmapUsePremultipliedAlpha,
        )
        .ok()?;
    wic_bitmap_to_base64(&factory, &bitmap)
}

unsafe fn wic_bitmap_to_base64(
    factory: &IWICImagingFactory,
    bitmap: &windows::Win32::Graphics::Imaging::IWICBitmapSource,
) -> Option<String> {
    let stream = CreateStreamOnHGlobal(HGLOBAL(std::ptr::null_mut()), true).ok()?;
    let encoder = factory
        .CreateEncoder(&GUID_ContainerFormatPng, std::ptr::null())
        .ok()?;
    encoder.Initialize(&stream, WICBitmapEncoderNoCache).ok()?;

    let mut frame = None;
    encoder
        .CreateNewFrame(&mut frame, std::ptr::null_mut())
        .ok()?;
    let frame = frame?;
    frame.Initialize(None).ok()?;

    let (mut width, mut height) = (0u32, 0u32);
    bitmap.GetSize(&mut width, &mut height).ok()?;
    frame.SetSize(width, height).ok()?;

    let mut format = GUID_WICPixelFormat32bppPBGRA;
    frame.SetPixelFormat(&mut format).ok()?;

    frame.WriteSource(bitmap, std::ptr::null()).ok()?;
    frame.Commit().ok()?;
    encoder.Commit().ok()?;

    let hglobal = GetHGlobalFromStream(&stream).ok()?;
    let ptr = windows::Win32::System::Memory::GlobalLock(hglobal);
    let size = windows::Win32::System::Memory::GlobalSize(hglobal);

    let data = std::slice::from_raw_parts(ptr as *const u8, size);
    let base64_str = general_purpose::STANDARD.encode(data);

    let _ = windows::Win32::System::Memory::GlobalUnlock(hglobal);

    Some(format!("data:image/png;base64,{}", base64_str))
}

pub fn get_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Load settings.json into the in-memory cache. Call once at startup.
pub fn init_settings_cache(app: &tauri::AppHandle) {
    use crate::state::SETTINGS_CACHE;
    use tauri::Manager;
    let cache =
        SETTINGS_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Some(path) = app
        .path()
        .app_config_dir()
        .ok()
        .map(|p| p.join("settings.json"))
    {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(settings) = serde_json::from_str::<
                std::collections::HashMap<String, serde_json::Value>,
            >(&content)
            {
                if let Ok(mut cache) = cache.lock() {
                    *cache = settings;
                }
            }
        }
    }
}

/// Replace the entire settings cache (used by save_setting and the file watcher).
///
/// Uses `get_or_init` rather than `get().unwrap()`: a webview can invoke
/// `save_setting` before the setup hook has initialized the cache, and a panic
/// on the main thread inside a WebView2 callback cannot unwind, which aborts
/// the process.
pub fn replace_settings_cache(new_settings: std::collections::HashMap<String, serde_json::Value>) {
    let cache = crate::state::SETTINGS_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(mut cache) = cache.lock() {
        *cache = new_settings;
    }
}

pub fn get_bloom_scale(_app: &tauri::AppHandle) -> f64 {
    get_setting_str(_app, "bloom-scale")
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(1.0)
}

/// Read any string value from the settings cache. Returns None if the key is absent.
pub fn get_setting_str(_app: &tauri::AppHandle, key: &str) -> Option<String> {
    let cache = crate::state::SETTINGS_CACHE.get()?;
    let guard = cache.lock().ok()?;
    guard.get(key)?.as_str().map(|s| s.to_string())
}

fn dock_setting_enabled(value: Option<&serde_json::Value>) -> bool {
    value.is_none_or(|value| value.as_str() == Some("true"))
}

/// An absent setting uses the fresh-install default; any explicit value other
/// than the string "true" leaves Windows' taskbar in charge.
pub fn dock_enabled() -> bool {
    crate::state::SETTINGS_CACHE.get().is_none_or(|cache| {
        cache
            .lock()
            .map(|settings| dock_setting_enabled(settings.get("bloom-dock-enabled")))
            .unwrap_or(false)
    })
}

/// Re-assert HWND_TOPMOST without activating the window.
///
/// Tauri's `set_always_on_top(true)` calls `SetWindowPos(HWND_TOPMOST)` without
/// `SWP_NOACTIVATE`, which causes Windows to send `WM_ACTIVATE` to the WebView2 window.
/// This activation message makes the WebView compositor briefly blank/hide the window,
/// and can also strip the `WS_EX_NOACTIVATE` extended style.
///
/// This helper uses the raw Win32 call with the correct flags and re-stamps
/// `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW` to prevent both problems.
pub fn re_assert_topmost(hwnd: HWND) {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
            SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSENDCHANGING, SWP_NOSIZE, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW,
        };
        // Set topmost without activating or notifying the window
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING,
        );
        // Re-stamp NOACTIVATE + TOOLWINDOW — HWND_TOPMOST can cause these to be reset
        // by the shell on some Windows builds
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as usize;
        let new_ex = ex | WS_EX_NOACTIVATE.0 as usize | WS_EX_TOOLWINDOW.0 as usize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex as isize);
    }
}

/// Appends a timestamped line to `%TEMP%\bloom-dock.log` when `BLOOM_DOCK_LOG`
/// is set. Off by default; the file is capped so a long session cannot grow it
/// without bound.
///
/// This exists because the defect it was added for is not reproducible on
/// demand: clicking quickly between two windows of the same app sometimes
/// leaves the target window black, sometimes not. Guessing at the cause from
/// outside produced several wrong fixes in a row. A timeline of what Bloom
/// actually did to each window turns that into something observable.
pub fn dock_log(line: &str) {
    use std::io::Write;
    static ENABLED: OnceLock<bool> = OnceLock::new();
    if !*ENABLED.get_or_init(|| std::env::var_os("BLOOM_DOCK_LOG").is_some()) {
        return;
    }
    let path = std::env::temp_dir().join("bloom-dock.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "[{}] {line}", get_now_ms());
        // Keep the tail. Cheap enough at this volume, and avoids needing a
        // second process to rotate.
        if let Ok(meta) = std::fs::metadata(&path) {
            if meta.len() > 2_000_000 {
                drop(f);
                if let Ok(content) = std::fs::read_to_string(&path) {
                    let trimmed: String = content
                        .chars()
                        .skip(content.chars().count() / 2)
                        .collect();
                    let _ = std::fs::write(&path, trimmed);
                }
            }
        }
    }
}

/// Mean RGB of a captured RGBA buffer, scaled 0-255. A window that PrintWindow
/// has blackened reads near 0; a healthy one rarely drops below about 20 even
/// for a dark UI. Sampling every 64th pixel keeps this off the hot path.
pub fn mean_luma(pixels: &[u8]) -> u32 {
    let mut total: u64 = 0;
    let mut count: u64 = 0;
    for px in pixels.as_chunks::<4>().0.iter().step_by(64) {
        total += (px[0] as u64 + px[1] as u64 + px[2] as u64) / 3;
        count += 1;
    }
    u32::try_from(total / count.max(1)).unwrap_or(u32::MAX)
}

/// Diagnostic switch: `BLOOM_NO_CAPTURE=1` skips PrintWindow entirely so no
/// target window is sent WM_PRINT.
///
/// It returns a flat placeholder rather than `None` on purpose. Returning
/// `None` drops the whole preview card in `Dock.tsx`
/// (`captured.length > 0` gates rendering), which leaves nothing to click — the
/// test then cannot reproduce the gesture it exists to test. A placeholder
/// keeps the card clickable while guaranteeing no window is harmed.
fn capture_disabled() -> bool {
    static DISABLED: OnceLock<bool> = OnceLock::new();
    *DISABLED.get_or_init(|| std::env::var_os("BLOOM_NO_CAPTURE").is_some())
}

/// A small solid dark PNG used as the placeholder while capture is off. Carries
/// the same `data:` prefix the real capture path emits, so the frontend cannot
/// tell the two apart and renders it normally.
fn placeholder_thumbnail() -> String {
    // 4x4 opaque grey PNG.
    const B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR42mNk+M9QzzCKRsEoGgWjYBQAAF9wAgF7pVvUAAAAASUVORK5CYII=";
    format!("data:image/png;base64,{B64}")
}

pub fn capture_hwnd_to_base64(hwnd: HWND, max_width: u32, max_height: u32) -> Option<String> {
    // Single freshness gate for every caller.
    //
    // This used to live in the `capture_window_thumbnail` command, which left
    // the focus and minimize hooks calling straight through with no dedup at
    // all. Their own checks did not help either: the focus hook allows two
    // seconds per window, so alternating between exactly two windows — the
    // normal dock case — defeated it every single time. The dock log showed
    // well over two hundred PrintWindow calls in a minute of rapid switching,
    // and every one is a chance to leave a surface black.
    //
    // PrintWindow with PW_RENDERFULLCONTENT damages Chromium targets, so the
    // fix that matters is calling it less, not repairing faster afterwards.
    const REUSE_MS: i64 = 1_000;
    if let Some(cache) = crate::state::THUMBNAIL_CACHE.get() {
        let fresh = cache
            .lock()
            .ok()
            .and_then(|g| match g.get(&(hwnd.0 as isize)) {
                Some((img, ts)) if crate::utils::get_now_ms() - ts < REUSE_MS => Some(img.clone()),
                _ => None,
            });
        if let Some(img) = fresh {
            crate::utils::dock_log(&format!("capture REUSED hwnd=0x{:x}", hwnd.0 as isize));
            return Some(img);
        }
    }

    // Never PrintWindow a minimized window. This is the most damaging call in
    // the whole capture path: the target gets WM_PRINT while it cannot paint,
    // and the repair below does nothing, because InvalidateRect/UpdateWindow on
    // a hidden window never reaches the screen. When the user restores it, the
    // surface is dead and the app has no reason to redraw. Every black-window
    // report lined up with a minimize/restore cycle in the dock log.
    //
    // Checked here rather than at each call site so every path is covered,
    // including the minimize hook and the focus hook.
    {
        use windows::Win32::UI::WindowsAndMessaging::IsIconic;
        if unsafe { IsIconic(hwnd) }.as_bool() {
            crate::utils::dock_log(&format!(
                "capture SKIPPED iconic hwnd=0x{:x}",
                hwnd.0 as isize
            ));
            return None;
        }
    }
    unsafe {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
            ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowPlacement, IsWindow, WINDOWPLACEMENT,
        };
        #[link(name = "user32")]
        extern "system" {
            pub fn PrintWindow(hwnd: HWND, hdcBlt: HDC, nFlags: u32) -> i32;
        }

        if !IsWindow(Some(hwnd)).as_bool() {
            return None;
        }

        let mut rect = RECT::default();
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut _,
            std::mem::size_of::<RECT>() as u32,
        );
        if rect.right == 0
            && rect.bottom == 0
            && windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut rect).is_err()
        {
            return None;
        }
        let mut width = rect.right - rect.left;
        let mut height = rect.bottom - rect.top;
        if width <= 10 || height <= 10 {
            let mut wp = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            if GetWindowPlacement(hwnd, &mut wp).is_ok() {
                width = wp.rcNormalPosition.right - wp.rcNormalPosition.left;
                height = wp.rcNormalPosition.bottom - wp.rcNormalPosition.top;
            }
        }
        if width <= 100 || height <= 100 || width > 7680 || height > 4320 {
            return None;
        }

        if capture_disabled() {
            return Some(placeholder_thumbnail());
        }
        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        let hbm_mem = CreateCompatibleBitmap(hdc_screen, width, height);
        let h_old = SelectObject(hdc_mem, hbm_mem.into());
        let success = PrintWindow(hwnd, hdc_mem, 2);

        // PW_RENDERFULLCONTENT leaves Chromium-based targets (Discord, most
        // Electron apps, VS Code) with a black, unrepainted surface: the
        // window stays dark even after it is focused, so its caption buttons go
        // dead too. Nothing in the capture path asks for a repaint, so the
        // damage persists. Ask for one explicitly.
        //
        // Off-thread on purpose. `UpdateWindow` sends WM_PAINT and waits for the
        // target app to finish drawing; doing that inline held up the pixel
        // read and made previews feel slower. The repair is a side effect nobody
        // is waiting on, so it has no business sitting in this critical path.
        if success != 0 {
            crate::utils::dock_log(&format!(
                "capture start hwnd=0x{:x} printwindow={}",
                hwnd.0 as isize,
                success
            ));
        }

        let mut result = None;
        if success != 0 {
            let mut bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default(); 1],
            };
            let mut pixels = vec![0u8; (width * height * 4) as usize];
            if GetDIBits(
                hdc_mem,
                hbm_mem,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut _),
                &mut bmi,
                DIB_RGB_COLORS,
            ) != 0
            {
                for chunk in pixels.chunks_exact_mut(4) {
                    let b = chunk[0];
                    let r = chunk[2];
                    chunk[0] = r;
                    chunk[2] = b;
                    chunk[3] = 255;
                }
                // The one objective signal available: a surface PrintWindow has
                // blackened reads near-zero here, and the user sees exactly
                // that on their screen. Logging the number turns "sometimes
                // black" into a timestamped event that can be lined up against
                // the clicks that caused it.
                crate::utils::dock_log(&format!(
                    "capture luma={} size={}x{} hwnd=0x{:x}",
                    crate::utils::mean_luma(&pixels),
                    width,
                    height,
                    hwnd.0 as isize
                ));

                // No repaint repair here. Earlier versions called InvalidateRect with
                // bErase = false followed by UpdateWindow, on the assumption that
                // PrintWindow was leaving the target's surface damaged. That
                // assumption was never tested, and the repair turned out to be
                // the cause of the black-window bug rather than the cure.
                //
                // InvalidateRect with bErase = false invalidates the entire
                // client area, and UpdateWindow forces a synchronous repaint. On
                // a GPU-composited window such as Chromium's that forces a full
                // surface rebuild at exactly the moment the window is being
                // raised — the classic way to produce a black flash. It also ran
                // after every capture, which during rapid dock switching is
                // several times a second.
                //
                // Measured with BLOOM_NO_REPAIR: 503 clicks with the repair on
                // produced the black windows; 142 clicks with it off, across the
                // same 144 PrintWindow calls, produced none. PrintWindow with
                // PW_RENDERFULLCONTENT does not in fact damage these targets.
                // Nothing needs repairing, so nothing repairs.
                if let Ok(Some(png_base64)) =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        if let Some(mut img) =
                            image::RgbaImage::from_raw(width as u32, height as u32, pixels)
                        {
                            if img.width() > max_width || img.height() > max_height {
                                let dyn_img = image::DynamicImage::ImageRgba8(img);
                                img = dyn_img
                                    .resize(
                                        max_width,
                                        max_height,
                                        image::imageops::FilterType::Triangle,
                                    )
                                    .into_rgba8();
                            }
                            let mut buf = std::io::Cursor::new(Vec::new());
                            if image::write_buffer_with_format(
                                &mut buf,
                                &img,
                                img.width(),
                                img.height(),
                                image::ColorType::Rgba8,
                                image::ImageFormat::Png,
                            )
                            .is_ok()
                            {
                                use base64::Engine;
                                let b64 = base64::engine::general_purpose::STANDARD
                                    .encode(buf.into_inner());
                                return Some(format!("data:image/png;base64,{}", b64));
                            }
                        }
                        None
                    }))
                {
                    result = Some(png_base64);
                }
            }
        }
        SelectObject(hdc_mem, h_old);
        let _ = DeleteObject(hbm_mem.into());
        let _ = DeleteDC(hdc_mem);
        ReleaseDC(None, hdc_screen);

        result
    }
}

#[cfg(test)]
mod tests {
    use super::{
        expand_env_vars, marker_contents, parse_marker_pid, parse_marker_rect, parse_marker_state,
    };

    // Guards the diagnostics allow-list against silent drift: a key that is not
    // a plain layout or appearance setting must not be reported, or a pasted
    // report starts leaking the user's city or pinned app paths.
    #[test]
    fn reported_settings_carry_nothing_user_supplied() {
        for key in crate::diagnostics::REPORTED_SETTINGS {
            let lower = key.to_lowercase();
            // Matched as whole words or trailing segments. Substring matching
            // trips over unrelated keys like bloom-theme-opacITy containing "lat".
            for forbidden in [
                "city", "lat", "lon", "path", "icon", "app", "weather", "cached",
            ] {
                let hit = lower.split('_').any(|segment| segment == forbidden)
                    || lower.ends_with(&format!("-{forbidden}"))
                    || lower.ends_with(&format!("_{forbidden}"));
                assert!(!hit, "{key} looks like it could carry user-supplied data");
            }
        }
    }

    #[test]
    fn taskbar_marker_round_trips_the_original_state() {
        for state in [0, 1, 2, 3] {
            let rect = windows::Win32::Foundation::RECT {
                left: 12,
                top: 34,
                right: 1234,
                bottom: 56,
            };
            let contents = marker_contents(state, 1234, Some(rect), None);
            assert_eq!(parse_marker_state(&contents), Some(state));
            assert_eq!(parse_marker_pid(&contents), Some(1234));
            assert_eq!(parse_marker_rect(&contents, "primary="), Some(rect));
        }
    }

    #[test]
    fn legacy_and_damaged_markers_carry_no_state() {
        // Older versions wrote a bare "1": it must not be read as auto-hide.
        assert_eq!(parse_marker_state("1"), None);
        assert_eq!(parse_marker_state(""), None);
        assert_eq!(parse_marker_state("abstate="), None);
        assert_eq!(parse_marker_state("abstate=x"), None);
        assert_eq!(parse_marker_state("abstate=2\r\n"), Some(2));
        assert_eq!(parse_marker_pid("abstate=2\r\n"), None);
        assert_eq!(parse_marker_rect("primary=1,2,3", "primary="), None);
    }

    #[test]
    fn env_expansion() {
        let out = expand_env_vars("%SystemRoot%\\System32");
        assert!(out.to_lowercase().ends_with("\\system32"), "got {out}");
        assert!(!out.contains('%'), "got {out}");

        // Unknown variables stay verbatim
        assert_eq!(
            expand_env_vars("%BLOOM_NOT_A_REAL_VAR%\\x"),
            "%BLOOM_NOT_A_REAL_VAR%\\x"
        );

        // Unclosed percent is left alone
        assert_eq!(expand_env_vars("50% done"), "50% done");

        // Plain paths are untouched
        assert_eq!(expand_env_vars("C:\\plain\\path"), "C:\\plain\\path");
    }

    #[test]
    fn bare_executable_resolution() {
        use super::resolve_executable_path;

        for name in ["notepad", "notepad.exe", "msedge"] {
            let path =
                resolve_executable_path(name).unwrap_or_else(|| panic!("{name} did not resolve"));
            assert!(
                std::path::Path::new(&path).exists(),
                "{name} -> {path} does not exist"
            );
            assert!(path.to_lowercase().ends_with(".exe"), "{name} -> {path}");
        }

        // Already-qualified paths and nonsense are not resolved
        assert_eq!(resolve_executable_path("C:\\Windows\\notepad.exe"), None);
        assert_eq!(
            resolve_executable_path("bloom-definitely-not-installed"),
            None
        );
        assert_eq!(resolve_executable_path(""), None);
    }

    #[test]
    fn replace_settings_cache_before_init_does_not_panic() {
        use super::replace_settings_cache;
        use crate::state::SETTINGS_CACHE;

        // Mirrors a webview invoking save_setting before the setup hook has
        // initialized the cache.
        let mut settings = std::collections::HashMap::new();
        settings.insert("bloom-test".to_string(), serde_json::json!("true"));
        replace_settings_cache(settings);

        let cache = SETTINGS_CACHE.get().expect("cache initialized");
        let guard = cache.lock().expect("cache lock");
        assert_eq!(
            guard.get("bloom-test").and_then(|value| value.as_str()),
            Some("true")
        );
    }

    #[test]
    fn dock_setting_defaults_on_but_rejects_explicit_invalid_values() {
        use super::dock_setting_enabled;

        assert!(dock_setting_enabled(None));
        assert!(dock_setting_enabled(Some(&serde_json::json!("true"))));
        assert!(!dock_setting_enabled(Some(&serde_json::json!("false"))));
        assert!(!dock_setting_enabled(Some(&serde_json::json!("invalid"))));
        assert!(!dock_setting_enabled(Some(&serde_json::json!(true))));
    }
}
