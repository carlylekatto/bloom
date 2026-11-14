//! First-time setup has its own durable lifecycle, independent of version splashes.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Window};

static STATE_LOCK: Mutex<()> = Mutex::new(());
static PREVIOUS_FOREGROUND: AtomicIsize = AtomicIsize::new(0);

#[derive(serde::Serialize, serde::Deserialize)]
struct State {
    completed: bool,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("onboarding.json"))
}

fn initialize_at(directory: &Path) -> Result<(), String> {
    let path = directory.join("onboarding.json");
    if path.exists() {
        return Ok(());
    }
    // Existing installations do not get an unsolicited wizard on upgrade.
    // Write false for fresh installs immediately so an interrupted first setup
    // is still pending even after other windows create settings.json.
    let state = State {
        completed: directory.join("settings.json").exists(),
    };
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    write_state(&path, &state)
}

fn write_state(path: &Path, state: &State) -> Result<(), String> {
    crate::utils::atomic_write_file(path, &serde_json::to_vec(state).map_err(|e| e.to_string())?)
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = state_path(app)?;
    initialize_at(path.parent().ok_or("Missing onboarding directory")?)
}

#[tauri::command(async)]
pub fn get_onboarding_completed(app: AppHandle) -> Result<bool, String> {
    initialize(&app)?;
    let state: State =
        serde_json::from_slice(&std::fs::read(state_path(&app)?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    Ok(state.completed)
}

#[tauri::command(async)]
pub fn complete_onboarding(app: AppHandle, window: Window) -> Result<(), String> {
    if window.label() != "overlay" {
        return Err("Only the overlay can complete setup".into());
    }
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    write_state(&state_path(&app)?, &State { completed: true })
}

#[tauri::command]
pub fn open_onboarding(app: AppHandle) -> Result<(), String> {
    if crate::state::OVERLAY_IN_SPLASH.load(Ordering::Relaxed) {
        return Err("Please wait for Bloom's startup or update to finish.".into());
    }
    app.emit_to("overlay", "open-onboarding", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_onboarding_active(app: AppHandle, window: Window, active: bool) -> Result<(), String> {
    if window.label() != "overlay" {
        return Err("Only the overlay can change setup interaction".into());
    }
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay is unavailable")?;
    let hwnd = overlay.hwnd().map_err(|e| e.to_string())?;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongPtrW, IsWindow, SetForegroundWindow, SetWindowLongPtrW,
        GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    crate::state::ONBOARDING_ACTIVE.store(active, Ordering::Relaxed);
    if active {
        unsafe {
            let previous = GetForegroundWindow();
            if previous != hwnd {
                PREVIOUS_FOREGROUND.store(previous.0 as isize, Ordering::Relaxed);
            }
        }
        crate::services::sync_overlays(&app);
        overlay.show().map_err(|e| e.to_string())?;
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style & !(WS_EX_NOACTIVATE.0 as isize));
        }
        crate::utils::set_click_through(hwnd, false);
        overlay.set_focus().map_err(|e| e.to_string())?;
    } else {
        crate::utils::set_click_through(hwnd, true);
        crate::utils::re_assert_topmost(hwnd);
        overlay.hide().map_err(|e| e.to_string())?;
        let previous = PREVIOUS_FOREGROUND.swap(0, Ordering::Relaxed);
        if previous != 0 {
            unsafe {
                let previous = HWND(previous as *mut _);
                if IsWindow(Some(previous)).as_bool() {
                    let _ = SetForegroundWindow(previous);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_setup_stays_pending_after_settings_are_created() {
        let directory =
            std::env::temp_dir().join(format!("bloom-onboarding-fresh-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        initialize_at(&directory).unwrap();
        std::fs::write(directory.join("settings.json"), "{}").unwrap();
        initialize_at(&directory).unwrap();
        let state: State =
            serde_json::from_slice(&std::fs::read(directory.join("onboarding.json")).unwrap())
                .unwrap();
        assert!(!state.completed);
        write_state(
            &directory.join("onboarding.json"),
            &State { completed: true },
        )
        .unwrap();
        initialize_at(&directory).unwrap();
        let state: State =
            serde_json::from_slice(&std::fs::read(directory.join("onboarding.json")).unwrap())
                .unwrap();
        assert!(state.completed);
        std::fs::remove_file(directory.join("settings.json")).unwrap();
        std::fs::remove_file(directory.join("onboarding.json")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn existing_install_is_migrated_without_launching_setup() {
        let directory =
            std::env::temp_dir().join(format!("bloom-onboarding-existing-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("settings.json"), "{}").unwrap();
        initialize_at(&directory).unwrap();
        let state: State =
            serde_json::from_slice(&std::fs::read(directory.join("onboarding.json")).unwrap())
                .unwrap();
        assert!(state.completed);
        std::fs::remove_file(directory.join("settings.json")).unwrap();
        std::fs::remove_file(directory.join("onboarding.json")).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
