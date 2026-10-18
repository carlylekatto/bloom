//! Two unrelated things share this file.
//!
//! - The runtime log is upstream #231's bounded event log. It appends
//!   panics and lifecycle events to `%LOCALAPPDATA%\com.sehaz.bloom\
//!   diagnostics.log`, rotating at 1 MB. It is write-only apart from that
//!   file and shares no state with the snapshot.
//! - The snapshot is this fork's read-only machine report, served by
//!   `get_diagnostics` for Settings -> About -> Copy Diagnostics.
//!
//! Every field below answers a question a bug reporter cannot answer about
//! their own PC: how many monitors, where, at what scale; whether Explorer
//! still owns the tray windows Bloom looks up by class; whether a crash
//! marker survived.
//!
//! Snapshot collection is strictly read-only. It never calls
//! `set_taskbar_visibility`, never sets `TRAY_INTERACTION_ACTIVE`, and never
//! touches Explorer â€” a diagnostic that perturbs the system it is describing
//! is worthless.
//!
//! Process and app names are deliberately omitted, and settings are an
//! allow-list. Counts and shapes only, so a pasted report does not leak the
//! reporter's running software or their city from `bloom-weather-city`.

use serde::Serialize;
use windows::core::PCWSTR;
use windows::Win32::{
    Foundation::{HWND, LPARAM},
    System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
        REG_DWORD, REG_SZ, REG_VALUE_TYPE,
    },
    UI::WindowsAndMessaging::{EnumWindows, GetClassNameA},
};

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use crate::state::*;

// â”€â”€â”€ Runtime log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MAX_LOG_BYTES: u64 = 1024 * 1024;
static LOG_PATH: OnceLock<Mutex<PathBuf>> = OnceLock::new();

pub fn initialize() {
    let Some(local_data) = std::env::var_os("LOCALAPPDATA") else {
        return;
    };
    let directory = PathBuf::from(local_data).join("com.sehaz.bloom");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let _ = LOG_PATH.set(Mutex::new(directory.join("diagnostics.log")));

    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown".into());
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        record("panic", &format!("at={location} message={message}"));
        previous_hook(info);
    }));
    record("startup", concat!("version=", env!("CARGO_PKG_VERSION")));
}

pub fn record(event: &str, detail: &str) {
    let Some(path) = LOG_PATH.get() else {
        return;
    };
    // Threads log at the same moment during startup, so wait briefly for the
    // lock rather than dropping the line. The wait is bounded, so a panic
    // raised while this thread already holds the lock can't deadlock.
    let mut attempts = 0;
    let path = loop {
        match path.try_lock() {
            Ok(path) => break path,
            // A thread that panicked mid-write leaves the path itself intact.
            Err(std::sync::TryLockError::Poisoned(poisoned)) => break poisoned.into_inner(),
            Err(_) if attempts < 50 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
            Err(_) => return,
        }
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let detail: String = detail
        .chars()
        .take(500)
        .map(|ch| if ch == '\r' || ch == '\n' { ' ' } else { ch })
        .collect();
    let line = format!(
        "{}.{:03} pid={} {} {}\n",
        now.as_secs(),
        now.subsec_millis(),
        std::process::id(),
        event,
        detail
    );
    let _ = append_line(&path, &line);
}

fn append_line(path: &Path, line: &str) -> io::Result<()> {
    if fs::metadata(path)
        .map(|metadata| metadata.len() + line.len() as u64 > MAX_LOG_BYTES)
        .unwrap_or(false)
    {
        let previous = path.with_extension("log.old");
        let _ = fs::remove_file(&previous);
        fs::rename(path, previous)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

// â”€â”€â”€ Read-only snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


#[derive(Serialize)]
pub struct MonitorInfo {
    pub primary: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    /// True when Bloom has a window registered against this monitor. Bloom only
    /// ever positions against the primary, so a second monitor is always false.
    /// Kept so a future multi-monitor change has a baseline to compare against.
    pub is_primary_target: bool,
}

#[derive(Serialize)]
pub struct ShellInfo {
    /// Class-name lookup is how Bloom reaches Explorer. A `null` here means the
    /// class stopped being findable, which is the single most likely cause of a
    /// broken taskbar after a Windows update.
    pub shell_traywnd_found: bool,
    pub shell_traywnd_visible: bool,
    /// Number of `Shell_SecondaryTrayWnd` windows. Bloom's own
    /// `set_taskbar_visibility` only handles the first one it finds.
    pub secondary_taskbar_count: usize,
    pub secondary_taskbar_classes_found: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct OsInfo {
    /// `DisplayVersion` alone is ambiguous: Microsoft has reused the same label
    /// across servicing releases of different major builds.
    pub display_version: Option<String>,
    pub current_build: Option<String>,
    /// Update Build Revision. Together with `current_build` this pins the exact
    /// Windows build, which is what actually decides whether Bloom's
    /// class-name lookups still resolve.
    pub ubr: Option<String>,
}

#[derive(Serialize)]
pub struct MarkerInfo {
    /// A leftover `taskbar_hidden.flag` means a previous session died with the
    /// taskbar hidden. Its presence while Bloom is running is the signature of
    /// a failed recovery.
    pub present: bool,
    /// The taskbar state saved before Bloom forced auto-hide, i.e. what
    /// `restore_taskbar_after_crash` will restore.
    pub original_abstate: Option<i32>,
}

#[derive(Serialize)]
pub struct RuntimeState {
    pub native_taskbar_hidden: bool,
    pub main_appbar_registered: bool,
    pub dock_appbar_registered: bool,
    pub shutting_down: bool,
    pub tray_interaction_active: bool,
    pub dock_overlap: i32,
    pub notch_overlap: i32,
    pub foreground_fullscreen: bool,
    pub foreground_maximized: bool,
    pub media_playing: bool,
}

#[derive(Serialize)]
pub struct Diagnostics {
    pub bloom_version: String,
    pub config_dir: String,
    pub os: OsInfo,
    pub monitors: Vec<MonitorInfo>,
    pub shell: ShellInfo,
    pub marker: MarkerInfo,
    pub state: RuntimeState,
    /// Only settings the user has actually changed. A key listed in
    /// `REPORTED_SETTINGS` but absent here is unset and running on the default
    /// from SETTINGS.md ΓÇö which is not the same as having been set back to that
    /// default, so the absence is meaningful and is called out below.
    pub settings: Vec<(String, String)>,
    /// Read by whoever reads the report, not by Bloom. Explains the omission
    /// above and why `product_name` is missing from `os`.
    pub notes: Vec<&'static str>,
}

const DIAGNOSTIC_NOTES: &[&str] = &[
    "settings: only keys present in settings.json are listed; a reported key that is absent is unset and uses its default from SETTINGS.md",
    "os: ProductName is omitted on purpose - Windows has not updated it since Windows 8, so it reports \"Windows 10\" on Windows 11 builds. Use current_build + ubr.",
    "shell.shell_traywnd_visible is false whenever Bloom is running, because hiding the taskbar is what Bloom does",
    "monitors[].is_primary_target is true only for the primary monitor: Bloom positions its windows against the primary monitor only",
];

struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

unsafe fn open_key(parent: HKEY, name: &str) -> Option<Key> {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut key = HKEY::default();
    RegOpenKeyExW(parent, PCWSTR(name.as_ptr()), Some(0), KEY_READ, &mut key)
        .ok()
        .ok()?;
    Some(Key(key))
}

/// Read a registry value as text. Windows mixes REG_SZ and REG_DWORD across
/// these keys ΓÇö UBR in particular is a DWORD, and UBR is the value that tells
/// 24H2 from 25H2, so rejecting it would drop the single most useful field in
/// the whole report.
unsafe fn string(key: HKEY, name: &str) -> Option<String> {
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut kind = REG_VALUE_TYPE::default();
    let mut size = 0u32;
    if RegQueryValueExW(
        key,
        PCWSTR(name.as_ptr()),
        None,
        Some(&mut kind),
        None,
        Some(&mut size),
    )
    .is_err()
        || size == 0
    {
        return None;
    }
    match kind {
        REG_SZ => {
            let mut buf = vec![0u8; size as usize];
            let mut read = size;
            if RegQueryValueExW(
                key,
                PCWSTR(name.as_ptr()),
                None,
                Some(&mut kind),
                Some(buf.as_mut_ptr()),
                Some(&mut read),
            )
            .is_err()
            {
                return None;
            }
            let chars: Vec<u16> = buf
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .take_while(|c| *c != 0)
                .collect();
            String::from_utf16(&chars).ok()
        }
        REG_DWORD => {
            let mut value = 0u32;
            let mut read = 4u32;
            if RegQueryValueExW(
                key,
                PCWSTR(name.as_ptr()),
                None,
                Some(&mut kind),
                Some(&mut value as *mut u32 as *mut u8),
                Some(&mut read),
            )
            .is_err()
            {
                return None;
            }
            Some(value.to_string())
        }
        _ => None,
    }
}

fn os_info() -> OsInfo {
    unsafe {
        // ProductName is deliberately NOT read. Microsoft has not updated it
        // since Windows 8, so on Windows 11 it reports "Windows 10" while
        // CurrentBuild is a Windows 11 build ΓÇö a report field that actively
        // misdirects triage is worse than no field at all. Build numbers are
        // authoritative.
        let key = open_key(
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
        );
        let Some(key) = key else {
            return OsInfo {
                display_version: None,
                current_build: None,
                ubr: None,
            };
        };
        OsInfo {
            display_version: string(key.0, "DisplayVersion"),
            current_build: string(key.0, "CurrentBuild"),
            ubr: string(key.0, "UBR"),
        }
    }
}

unsafe extern "system" fn collect_shell_window(hwnd: HWND, param: LPARAM) -> windows::core::BOOL {
    let found = &mut *(param.0 as *mut Vec<String>);
    let mut buf = [0u8; 256];
    let len = GetClassNameA(hwnd, &mut buf) as usize;
    if len > 0 && len <= buf.len() {
        let class = std::str::from_utf8(&buf[..len]).unwrap_or("");
        if class == "Shell_SecondaryTrayWnd" {
            found.push(class.to_owned());
        }
    }
    true.into()
}

fn shell_info() -> ShellInfo {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowA, IsWindowVisible};

        let primary = FindWindowA(
            windows::core::PCSTR(c"Shell_TrayWnd".as_ptr() as *const u8),
            windows::core::PCSTR::null(),
        );
        let shell_traywnd_found = primary.is_ok();
        let shell_traywnd_visible = primary
            .as_ref()
            .is_ok_and(|h| IsWindowVisible(*h).as_bool());

        // Enumerated rather than FindWindowA'd, because Bloom's taskbar code
        // only ever resolves the first secondary traybar. A count above 1 is
        // the direct evidence of that limitation on a multi-monitor setup.
        let mut secondary = Vec::new();
        let param = LPARAM(&mut secondary as *mut Vec<String> as isize);
        let _ = EnumWindows(Some(collect_shell_window), param);

        ShellInfo {
            shell_traywnd_found,
            shell_traywnd_visible,
            secondary_taskbar_count: secondary.len(),
            secondary_taskbar_classes_found: secondary,
        }
    }
}

fn monitors(app: &tauri::AppHandle) -> Vec<MonitorInfo> {
    let primary_pos = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.position().x, m.position().y));
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                primary: primary_pos == Some((pos.x, pos.y)),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor: m.scale_factor(),
                is_primary_target: primary_pos == Some((pos.x, pos.y)),
            }
        })
        .collect()
}

/// Settings worth attaching to a report: anything that changes layout or hook
/// behaviour. Deliberately an allow-list ΓÇö dumping every key would leak the
/// reporter's city from `bloom-weather-city` and pinned app paths.
pub const REPORTED_SETTINGS: &[&str] = &[
    "bloom-dock-mode",
    "bloom-notch-mode",
    "bloom-dock-enabled",
    "bloom-dock-adaptive",
    "bloom-notch-edge-delay",
    "bloom-scale",
    "bloom-theme-mode",
    "bloom-theme-opacity",
    "bloom-volume-overlay-enabled",
    "bloom-brightness-overlay-enabled",
    "bloom-media-layout",
    "bloom-media-visualizer-enabled",
    "bloom-time-format-24h",
    "bloom-auto-update",
];

pub fn collect(app: &tauri::AppHandle) -> Diagnostics {
    use tauri::Manager;

    let marker_present = crate::utils::taskbar_marker_exists();
    Diagnostics {
        bloom_version: app.package_info().version.to_string(),
        config_dir: app
            .path()
            .app_config_dir()
            .map(|d| d.display().to_string())
            .unwrap_or_else(|_| "<unavailable>".into()),
        os: os_info(),
        monitors: monitors(app),
        shell: shell_info(),
        marker: MarkerInfo {
            present: marker_present,
            original_abstate: crate::utils::taskbar_marker_state(),
        },
        state: RuntimeState {
            native_taskbar_hidden: NATIVE_TASKBAR_HIDDEN.load(std::sync::atomic::Ordering::Relaxed),
            main_appbar_registered: MAIN_APPBAR_REGISTERED
                .load(std::sync::atomic::Ordering::Relaxed),
            dock_appbar_registered: DOCK_APPBAR_REGISTERED
                .load(std::sync::atomic::Ordering::Relaxed),
            shutting_down: SHUTTING_DOWN.load(std::sync::atomic::Ordering::Relaxed),
            tray_interaction_active: TRAY_INTERACTION_ACTIVE
                .load(std::sync::atomic::Ordering::Relaxed),
            dock_overlap: CURRENT_DOCK_OVERLAP.load(std::sync::atomic::Ordering::Relaxed),
            notch_overlap: CURRENT_NOTCH_OVERLAP.load(std::sync::atomic::Ordering::Relaxed),
            foreground_fullscreen: CURRENT_FOREGROUND_FULLSCREEN
                .load(std::sync::atomic::Ordering::Relaxed),
            foreground_maximized: CURRENT_FOREGROUND_MAXIMIZED
                .load(std::sync::atomic::Ordering::Relaxed),
            media_playing: ANY_MEDIA_PLAYING.load(std::sync::atomic::Ordering::Relaxed),
        },
        settings: REPORTED_SETTINGS
            .iter()
            .filter_map(|k| crate::utils::get_setting_str(app, k).map(|v| ((*k).to_owned(), v)))
            .collect(),
        notes: DIAGNOSTIC_NOTES.to_vec(),
    }
}

#[tauri::command]
pub fn get_diagnostics(app: tauri::AppHandle) -> Diagnostics {
    collect(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ProductName has not been updated by Microsoft since Windows 8: on this
    /// machine it reports "Windows 10 Home Single Language" while CurrentBuild
    /// is 26300, a Windows 11 build. A report field that misdirects triage is
    /// worse than an absent one, so this pins its removal.
    #[test]
    fn product_name_is_not_reported() {
        let text = serde_json::to_string(&os_info()).unwrap();
        assert!(
            !text.contains("product_name"),
            "ProductName is stale on modern Windows; do not put it in a report"
        );
    }

    /// These all run on any Windows machine, so they catch the parts most
    /// likely to break: registry value decoding and the EnumWindows class
    /// filter. Neither needs an AppHandle, which is why they are testable at
    /// all ΓÇö and why they run on a CI runner with no desktop attached.
    #[test]
    fn notes_explain_every_deliberate_omission() {
        let joined = DIAGNOSTIC_NOTES.join(" ");
        for expected in ["settings", "ProductName", "shell_traywnd_visible"] {
            assert!(
                joined.contains(expected),
                "no note explains the {expected} omission, so a reader cannot tell it was intentional"
            );
        }
    }

    #[test]
    fn os_build_is_read_without_panicking() {
        let os = os_info();
        // On any real Windows these are populated; the point is that a missing
        // key degrades to None instead of aborting a bug report.
        assert!(
            os.current_build.is_some() && os.ubr.is_some(),
            "expected CurrentBuild and URB from the Windows NT key, got {os:?}"
        );
    }

    #[test]
    fn shell_traywnd_is_discoverable() {
        let shell = shell_info();
        assert!(
            shell.shell_traywnd_found,
            "Shell_TrayWnd not found by class name ΓÇö Bloom's taskbar code would fail too"
        );
    }

    #[test]
    fn secondary_taskbar_count_matches_the_enum_walk() {
        let shell = shell_info();
        assert_eq!(
            shell.secondary_taskbar_count,
            shell.secondary_taskbar_classes_found.len(),
            "count and collected class list must agree"
        );
        for class in &shell.secondary_taskbar_classes_found {
            assert_eq!(class, "Shell_SecondaryTrayWnd");
        }
    }

    #[test]
    fn diagnostics_serialise_to_valid_json() {
        // A malformed struct would make Copy Diagnostics paste broken JSON.
        let value = serde_json::json!({
            "bloom_version": "0.0.0",
            "os": OsInfo { display_version: None, current_build: None, ubr: None },
            "monitors": Vec::<MonitorInfo>::new(),
            "shell": shell_info(),
            "marker": MarkerInfo { present: false, original_abstate: None },
            "state": RuntimeState {
                native_taskbar_hidden: false,
                main_appbar_registered: false,
                dock_appbar_registered: false,
                shutting_down: false,
                tray_interaction_active: false,
                dock_overlap: -1,
                notch_overlap: -1,
                foreground_fullscreen: false,
                foreground_maximized: false,
                media_playing: false,
            },
            "settings": Vec::<(String, String)>::new(),
            "notes": DIAGNOSTIC_NOTES.to_vec(),
        });
        let text = serde_json::to_string_pretty(&value).expect("diagnostics must serialise");
        assert!(text.contains("shell_traywnd_found"));
        assert!(text.contains("notes"));
    }

    #[test]
    fn log_rotates_before_exceeding_limit() {
        let directory = std::env::temp_dir().join(format!(
            "bloom-log-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("diagnostics.log");
        std::fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        append_line(&path, "new event\n").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new event\n");
        assert_eq!(
            std::fs::metadata(path.with_extension("log.old"))
                .unwrap()
                .len(),
            MAX_LOG_BYTES
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_file(path.with_extension("log.old")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
