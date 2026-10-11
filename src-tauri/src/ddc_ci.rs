//! DDC/CI brightness for every display, external or built in.
//!
//! Ported from Twinkle Tray (MIT, © Xander Frangos) — `ddcci.cc` for the Win32
//! calls and `Monitors.js` for the policy around them. Two things are worth
//! keeping from that port:
//!
//! * Both APIs are needed. Twinkle tries the high-level Monitor Configuration
//!   calls first and only falls back to raw VCP writes
//!   (`Monitors.js:1719`, `else if (... highLevelSupported?.brightness ...)`).
//!   Neither alone is enough: on some display paths every
//!   `GetVCPFeatureAndVCPFeatureReply` returns ERROR_INVALID_HANDLE while
//!   `GetMonitorBrightness` works, and on others it is the reverse.
//! * Transient I2C faults are retried (`tryDdcCiOperation` in `ddcci.cc:229`).
//!   A garbled message is routine on a busy bus and is not a reason to drop the
//!   write.
//!
//! Bloom's original code only called `SetMonitorBrightness` and ignored the
//! result, so the slider silently did nothing on displays that take the VCP
//! path instead.
//!
//! Each call takes roughly 40-50 ms over the I2C bus, so handles and each
//! monitor's usable range are cached after the first walk and a slider tick
//! costs a single write. The cache is dropped by [`invalidate`] when the
//! display topology changes. Callers must stay off the UI thread.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
    GetPhysicalMonitorsFromHMONITOR, GetVCPFeatureAndVCPFeatureReply, SetMonitorBrightness,
    SetVCPFeature, PHYSICAL_MONITOR,
};
use windows::Win32::Foundation::{HANDLE, LPARAM};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};

/// MCCS VCP code for brightness.
const VCP_BRIGHTNESS: u8 = 0x10;

/// The API a monitor answers on, in the order Twinkle prefers them.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Method {
    /// `Get/SetMonitorBrightness` from `highlevelmonitorconfigapi.h`.
    HighLevel,
    /// `GetVCPFeatureAndVCPFeatureReply` / `SetVCPFeature` on VCP code 0x10.
    Vcp,
}

/// A physical monitor handle plus everything a brightness call needs from it.
#[derive(Clone, Copy)]
struct Monitor {
    /// `HANDLE` stored as `usize`: the raw pointer is not `Send`, and the
    /// cache below is a static shared across threads.
    handle: usize,
    /// `PHYSICAL_MONITOR` description.
    name: [u16; 128],
    /// GDI device name (`\\.\DISPLAY1`), used when the description says nothing.
    device: [u16; 32],
    method: Method,
    /// The range the monitor reports, so a percentage can be mapped onto it.
    min: u32,
    max: u32,
    /// Last value that was read or written. A display that misses one I2C read
    /// keeps its row instead of disappearing — dropping it would make the
    /// panel flip between one master slider and a list of displays.
    last: u32,
}

/// One monitor's brightness, as handed to the frontend.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorBrightness {
    /// Position among the detected monitors, used to address a later write.
    pub index: usize,
    /// `PHYSICAL_MONITOR` description, e.g. "Dell U2720Q". Falls back to the
    /// GDI device name, which is all "Generic PnP Monitor" on some paths.
    pub name: String,
    /// Current brightness, 0-100.
    pub brightness: u32,
}

/// Physical monitors discovered on the first call, reused afterwards.
static MONITORS: Mutex<Option<Vec<Monitor>>> = Mutex::new(None);

// ---------------------------------------------------------------------------
// Dev-only multi-display stand-in.
//
// A laptop panel rarely speaks DDC/CI, so the per-display UI cannot be opened at
// all on the machine it was written on — and "it compiles" is exactly how the
// height arithmetic and the fixed-width label box go unnoticed. Setting
// `BLOOM_FAKE_DDC=<n>` reports `n` synthetic displays so the whole path can be
// driven on one screen: the frontend, the commands, the poll loop and the CSS
// are all real, and only the I2C bus is stood in for.
//
// Everything here is behind `cfg(debug_assertions)`, as are the call sites, so a
// release build does not merely skip the check — the branch is not compiled at
// all and there is no environment variable that can turn it on.
// ---------------------------------------------------------------------------

/// Synthetic displays and their current values, so a drag is observable on the
/// next read the same way a real panel's would be.
#[cfg(debug_assertions)]
static FAKE_DISPLAYS: Mutex<Vec<(String, u32)>> = Mutex::new(Vec::new());

/// How many displays `BLOOM_FAKE_DDC` asks for, or `None` when it is unset.
///
/// Bounded to 1..=8 so a typo cannot make the panel absurdly tall: the command
/// centre grows 26px per row.
#[cfg(debug_assertions)]
fn fake_count() -> Option<usize> {
    let count = std::env::var("BLOOM_FAKE_DDC").ok()?.trim().parse::<usize>().ok()?;
    (1..=8).contains(&count).then_some(count)
}

/// Names are drawn from what real EDID descriptions actually look like, not from
/// tidy placeholders: the per-display label box is a fixed 75px, so a long name
/// is the only thing that exercises the ellipsis.
#[cfg(debug_assertions)]
fn fake_name(index: usize) -> String {
    const NAMES: [&str; 4] = [
        "Dell U2720Q",
        "Generic PnP Monitor",
        "ASUS VG249Q",
        "LG ULTRAWIDE",
    ];
    NAMES[index % NAMES.len()].to_string()
}

/// The state a faked bus would report, seeding the store on first use so the
/// values survive across polls and drags.
#[cfg(debug_assertions)]
fn fake_state() -> Option<BrightnessState> {
    let count = fake_count()?;
    let mut displays = FAKE_DISPLAYS.lock().unwrap();
    if displays.len() != count {
        displays.clear();
        for index in 0..count {
            displays.push((fake_name(index), 40 + index as u32 * 15));
        }
    }
    let monitors: Vec<MonitorBrightness> = displays
        .iter()
        .enumerate()
        .map(|(index, (name, brightness))| MonitorBrightness {
            index,
            name: name.clone(),
            brightness: *brightness,
        })
        .collect();
    let per_display = monitors.len() > 1;
    Some(BrightnessState {
        master: monitors.first().map(|monitor| monitor.brightness),
        monitors,
        per_display,
    })
}

/// Records a write against a faked display. `Some(false)` for an index that does
/// not exist, mirroring a real handle that has stopped answering.
#[cfg(debug_assertions)]
fn fake_set(index: usize, percent: u32) -> Option<bool> {
    fake_count()?;
    let mut displays = FAKE_DISPLAYS.lock().unwrap();
    let Some(slot) = displays.get_mut(index) else {
        return Some(false);
    };
    slot.1 = percent.min(100);
    Some(true)
}


/// Rebuilds the `HANDLE` the Win32 calls take.
fn as_handle(raw: usize) -> HANDLE {
    HANDLE(raw as *mut std::ffi::c_void)
}

/// Length of a NUL-terminated fixed-width UTF-16 buffer, without the NUL.
fn utf16_len(buffer: &[u16; 128]) -> usize {
    buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len())
}

/// Length of the NUL-terminated `szDevice` buffer.
fn device_len(buffer: &[u16; 32]) -> usize {
    buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len())
}

/// The best name this monitor has.
///
/// Plenty of panels — anything behind a dock, KVM or `DisplayLink` — report
/// "Generic PnP Monitor", which is useless when two of them are attached. The
/// GDI device name always distinguishes them, so it is the fallback.
fn label(monitor: &Monitor) -> String {
    let description = String::from_utf16_lossy(&monitor.name[..utf16_len(&monitor.name)]);
    let description = description.trim();
    let generic = description.is_empty()
        || description.eq_ignore_ascii_case("generic monitor")
        || description.eq_ignore_ascii_case("generic pnp monitor");
    if !generic {
        return description.to_string();
    }
    let device = String::from_utf16_lossy(&monitor.device[..device_len(&monitor.device)]);
    match device.rsplit(['\\', ':']).next().filter(|part| !part.is_empty()) {
        // "\\.\DISPLAY2" -> "Display 2"
        Some(display) => {
            // `get` instead of slicing: a non-ASCII device name must not panic.
            let suffix = display
                .get(..7)
                .filter(|prefix| prefix.eq_ignore_ascii_case("DISPLAY"))
                .and_then(|_| display.get(7..))
                .unwrap_or(display);
            if suffix.is_empty() {
                display.to_string()
            } else {
                format!("Display {suffix}")
            }
        }
        None if !device.trim().is_empty() => device.trim().to_string(),
        None => format!("Monitor {}", monitor.handle),
    }
}

/// True when the Win32 error is a garbled-message or I2C glitch, i.e. worth
/// retrying. This is the same set Twinkle treats as transient
/// (`ddcci.cc:208`): `ERROR_GRAPHICS_I2C_ERROR_TRANSMITTING_DATA` through
/// `ERROR_GRAPHICS_DDCCI_INVALID_MESSAGE_CHECKSUM`.
fn is_transient_error(code: u32) -> bool {
    (1572..=1577).contains(&code)
}

/// Mirrors Twinkle's `tryDdcCiOperation`: at most three attempts, 50 ms apart,
/// and only retry the transient failures above.
fn try_ddc_ci<F: FnMut() -> bool>(mut operation: F) -> bool {
    for attempt in 1..=3 {
        if attempt > 1 {
            std::thread::sleep(Duration::from_millis(50));
        }
        if operation() {
            return true;
        }
        let code = unsafe { windows::Win32::Foundation::GetLastError().0 };
        if !is_transient_error(code) {
            return false;
        }
    }
    false
}

/// `GetMonitorBrightness` as `(min, current, max)`.
fn high_level_get(handle: HANDLE) -> Option<(u32, u32, u32)> {
    let (mut min, mut current, mut max) = (0u32, 0u32, 0u32);
    let ok = try_ddc_ci(|| unsafe { GetMonitorBrightness(handle, &mut min, &mut current, &mut max) != 0 });
    ok.then_some((min, current, max))
}

/// Reads a VCP feature as `(current, maximum)`, with retries.
///
/// `GetVCPFeatureAndVCPFeatureReply` returns TRUE on success, so the check is
/// for a non-zero result — testing for zero silently dropped every monitor
/// that does support DDC/CI.
fn vcp_get(handle: HANDLE, code: u8) -> Option<(u32, u32)> {
    let mut current = 0u32;
    let mut maximum = 0u32;
    let ok = try_ddc_ci(|| unsafe {
        GetVCPFeatureAndVCPFeatureReply(handle, code, None, &mut current, Some(&mut maximum)) != 0
    });
    ok.then_some((current, maximum))
}

/// Same, without retries. Used while building the cache, where an extra probe
/// is cheaper than a retry storm.
fn vcp_get_once(handle: HANDLE, code: u8) -> Option<(u32, u32)> {
    let mut current = 0u32;
    let mut maximum = 0u32;
    let ok = unsafe {
        GetVCPFeatureAndVCPFeatureReply(handle, code, None, &mut current, Some(&mut maximum)) != 0
    };
    ok.then_some((current, maximum))
}

/// Walks the bus once and records how each physical monitor wants to be
/// addressed. Returns the monitors plus how many physical monitors the bus
/// reports in total, so the caller can tell "no such display" apart from "it
/// did not answer yet". Mirrors Twinkle's `getAllHandles`.
fn probe_once() -> (Vec<Monitor>, usize) {
    // Third slot holds handles we will not use, so they can be closed instead
    // of leaked.
    let found = std::sync::Mutex::new((Vec::<Monitor>::new(), 0usize, Vec::<PHYSICAL_MONITOR>::new()));

    unsafe extern "system" fn collect(
        hmonitor: HMONITOR,
        _: HDC,
        _: *mut windows::Win32::Foundation::RECT,
        lparam: LPARAM,
    ) -> windows::core::BOOL {
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFOEXW};
        let found = &*(lparam.0 as *const std::sync::Mutex<(Vec<Monitor>, usize, Vec<PHYSICAL_MONITOR>)>);
        let mut count = 0u32;
        if GetNumberOfPhysicalMonitorsFromHMONITOR(hmonitor, &mut count).is_ok() && count > 0 {
            let mut monitors = vec![PHYSICAL_MONITOR::default(); count as usize];
            if GetPhysicalMonitorsFromHMONITOR(hmonitor, &mut monitors).is_ok() {
                // The GDI device name ("\\.\DISPLAY1") is the only thing that
                // tells two identically-named monitors apart.
                let mut device = MONITORINFOEXW::default();
                device.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
                let device = if GetMonitorInfoW(hmonitor, &mut device.monitorInfo).as_bool() {
                    device.szDevice
                } else {
                    [0; 32]
                };
                let mut found = found.lock().unwrap();
                found.1 += monitors.len();
                for monitor in &monitors {
                    // windows-core types are packed, so copy the fields out
                    // before touching them — borrowing a packed field
                    // directly is a compile error.
                    let handle = monitor.hPhysicalMonitor;
                    let name = monitor.szPhysicalMonitorDescription;
                    if handle.is_invalid() {
                        continue;
                    }

                    // High-level first, and its range comes free.
                    let high = high_level_get(handle);
                    // VCP codes Twinkle probes to validate a handle, in the
                    // same order (`ddcci.cc:633`).
                    let vcp = vcp_get_once(handle, VCP_BRIGHTNESS)
                        .or_else(|| vcp_get_once(handle, 0x02))
                        .or_else(|| vcp_get_once(handle, 0xDF));

                    // A monitor we will not keep still owns a handle, so it
                    // goes on the reject list to be closed after the walk.
                    let kept = match (high, vcp) {
                        (Some((min, current, max)), _) if max > min => {
                            let span = max - min;
                            (Method::HighLevel, min, max, current.saturating_sub(min) * 100 / span)
                        }
                        // A range with no span cannot carry a percentage, so
                        // fall back to the usual 0-100 window.
                        (Some((_, _, _)), _) => (Method::HighLevel, 0, 100, 0),
                        (None, Some((current, max))) if max > 0 => {
                            (Method::Vcp, 0, max, current.min(max) * 100 / max)
                        }
                        // Not answering on the first pass. Keep the monitor out
                        // of the cache for now, but count it as missing so the
                        // caller can scan again — a display that is asleep or
                        // still coming up is the usual reason.
                        (None, _) => {
                            found.2.push(*monitor);
                            continue;
                        }
                    };
                    found.0.push(Monitor {
                        handle: handle.0 as usize,
                        name,
                        device,
                        method: kept.0,
                        min: kept.1,
                        max: kept.2,
                        last: kept.3.min(100),
                    });
                }
            }
        }
        windows::core::BOOL(1)
    }

    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&found as *const _ as isize));
    }

    let (monitors, expected, rejected) = found.into_inner().unwrap();
    if !rejected.is_empty() {
        unsafe {
            let _ = DestroyPhysicalMonitors(&rejected);
        }
    }
    (monitors, expected)
}

/// Like [`probe_once`], but keeps scanning while displays are missing.
///
/// A monitor that is asleep or still waking up does not answer, and the cache
/// would then hold one display for the rest of the session — the cache is only
/// dropped on a display change. Three passes over ~500 ms catch that.
fn discover() -> Vec<Monitor> {
    for attempt in 0..3 {
        let (monitors, expected) = probe_once();
        if monitors.len() >= expected || attempt == 2 {
            return monitors;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    unreachable!("the loop always returns on its last attempt")
}

/// The cached monitors, walking the bus on the first call only.
fn cached() -> Vec<Monitor> {
    let mut cache = MONITORS.lock().unwrap();
    match cache.as_ref() {
        Some(monitors) => monitors.clone(),
        None => {
            let monitors = discover();
            *cache = Some(monitors.clone());
            monitors
        }
    }
}

/// Drops the cached handles so the next call re-enumerates. Wired to
/// `WM_DISPLAYCHANGE`, and used by itself when a write starts failing.
pub fn invalidate() {
    if let Some(monitors) = MONITORS.lock().unwrap().take() {
        release(&monitors);
    }
}

/// Closes the handles `discover` opened. The rebuilt array only needs the
/// handles — `DestroyPhysicalMonitors` ignores the descriptions.
fn release(monitors: &[Monitor]) {
    if monitors.is_empty() {
        return;
    }
    let physical: Vec<PHYSICAL_MONITOR> = monitors
        .iter()
        .map(|monitor| PHYSICAL_MONITOR {
            hPhysicalMonitor: as_handle(monitor.handle),
            szPhysicalMonitorDescription: monitor.name,
        })
        .collect();
    unsafe {
        let _ = DestroyPhysicalMonitors(&physical);
    }
}

/// Reads a monitor's brightness as a percentage of the range it reports.
///
/// The result is clamped: a panel that reports a degenerate range
/// (`max == min`, or a 0 % brightness that some drivers answer with) would
/// otherwise produce values like 5000 and paint a bar across the panel.
fn read(monitor: &Monitor) -> Option<u32> {
    let handle = as_handle(monitor.handle);
    let percent = match monitor.method {
        Method::HighLevel => {
            let (min, current, max) = high_level_get(handle)?;
            if max <= min {
                return None;
            }
            (current.saturating_sub(min)) * 100 / (max - min)
        }
        Method::Vcp => {
            let (current, max) = vcp_get(handle, VCP_BRIGHTNESS)?;
            let max = if max == 0 { monitor.max } else { max };
            if max == 0 {
                return None;
            }
            current.min(max) * 100 / max
        }
    };
    Some(percent.min(100))
}

/// Writes a percentage onto one monitor, mapped onto the range it reported.
fn write(monitor: &Monitor, percent: u32) -> bool {
    let handle = as_handle(monitor.handle);
    let percent = percent.min(100);
    match monitor.method {
        Method::HighLevel => {
            let span = monitor.max.saturating_sub(monitor.min).max(1);
            let value = monitor.min + percent * span / 100;
            try_ddc_ci(|| unsafe { SetMonitorBrightness(handle, value) != 0 })
        }
        Method::Vcp => {
            let value = if monitor.max != 100 {
                percent * monitor.max / 100
            } else {
                percent
            };
            try_ddc_ci(|| unsafe { SetVCPFeature(handle, VCP_BRIGHTNESS, value) == 1 })
        }
    }
}

/// Every cached monitor with its brightness.
///
/// A display that misses its I2C read keeps its last known value rather than
/// dropping out of the list: the panel decides between one master slider and
/// one row per display, and a list that flickers in size makes that decision
/// flicker too.
pub fn list() -> Vec<MonitorBrightness> {
    #[cfg(debug_assertions)]
    if let Some(state) = fake_state() {
        return state.monitors;
    }
    let monitors = cached();
    let mut listed = Vec::with_capacity(monitors.len());
    for (index, monitor) in monitors.iter().enumerate() {
        let brightness = read(monitor).unwrap_or(monitor.last);
        listed.push(MonitorBrightness {
            index,
            name: label(monitor),
            brightness,
        });
    }
    remember(listed.iter().map(|monitor| monitor.brightness));
    listed
}

/// Records the values that were just read, so a later failed read falls back
/// to them instead of losing the display.
fn remember(readings: impl Iterator<Item = u32>) {
    let readings: Vec<u32> = readings.collect();
    let mut cache = MONITORS.lock().unwrap();
    if let Some(monitors) = cache.as_mut() {
        for (monitor, brightness) in monitors.iter_mut().zip(readings) {
            monitor.last = brightness;
        }
    }
}

/// Records the value written to one monitor. Zipping a single reading against
/// the head of the list would put it on the wrong display.
fn remember_one(index: usize, brightness: u32) {
    let mut cache = MONITORS.lock().unwrap();
    if let Some(monitors) = cache.as_mut() {
        if let Some(monitor) = monitors.get_mut(index) {
            monitor.last = brightness;
        }
    }
}

/// [`state`], rescanning the bus first so a display that was asleep when the
/// cache was built still shows up.
pub fn state_refreshed() -> BrightnessState {
    #[cfg(debug_assertions)]
    if let Some(state) = fake_state() {
        return state;
    }
    let previous = MONITORS.lock().unwrap().take();
    let fresh = discover();
    // A scan that comes back with fewer displays is almost always one that is
    // asleep rather than a real change; unplugging raises WM_DISPLAYCHANGE,
    // which invalidates the cache outright.
    let keep_previous = previous
        .as_ref()
        .is_some_and(|old| fresh.len() < old.len());

    let mut cache = MONITORS.lock().unwrap();
    if keep_previous {
        release(&fresh);
        *cache = previous;
    } else {
        release(previous.as_deref().unwrap_or(&[]));
        *cache = Some(fresh);
    }
    drop(cache);

    state()
}

/// What the frontend needs to draw the brightness controls.
///
/// The rule "one slider per display, no single master" lives here rather than
/// in the UI so both surfaces (command center, notch overlay) can ask for the
/// state and get the same answer.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrightnessState {
    /// Value for the single master slider, or `None` when nothing reports a
    /// brightness at all.
    pub master: Option<u32>,
    pub monitors: Vec<MonitorBrightness>,
    /// True when there is more than one display, so the master row can offer
    /// the per-display breakdown.
    pub per_display: bool,
}

/// Last value applied to every display. The master slider shows this, which
/// is what Bloom always did — it is the value a drag will write everywhere.
/// `u32::MAX` means "never set", so a real 0% is not mistaken for unset.
static MASTER: AtomicU32 = AtomicU32::new(u32::MAX);

/// Master value and monitor list from the cached handles.
pub fn state() -> BrightnessState {
    let monitors = list();
    let per_display = monitors.len() > 1;
    if monitors.is_empty() {
        // A laptop panel rarely speaks DDC/CI, but WMI drives it just fine —
        // fall back to the value Bloom tracks so the slider still shows up.
        return BrightnessState {
            master: Some(crate::state::CURRENT_BRIGHTNESS.load(Ordering::Relaxed)),
            monitors,
            per_display,
        };
    }
    // Until Bloom writes a value itself, show what the first display reports.
    // `compare_exchange` returns the *previous* value, so the sentinel comes
    // back on the call that claims the slot — reading that as the master
    // would send `u32::MAX` to the slider.
    let seed = monitors[0].brightness;
    let master = match MASTER.compare_exchange(u32::MAX, seed, Ordering::AcqRel, Ordering::Acquire) {
        Ok(_) => seed,
        Err(current) => current,
    };
    BrightnessState {
        master: Some(master),
        monitors,
        per_display,
    }
}

/// Writes brightness to a single monitor, addressed by its index in [`list`].
pub fn set_one(index: usize, percent: u32) -> bool {
    #[cfg(debug_assertions)]
    if let Some(result) = fake_set(index, percent) {
        return result;
    }
    let monitors = cached();
    let Some(monitor) = monitors.get(index) else {
        return false;
    };
    let percent = percent.min(100);
    if write(monitor, percent) {
        remember_one(index, percent);
        true
    } else {
        // The handle stopped answering — usually a monitor that went away.
        invalidate();
        false
    }
}

/// Sets brightness on every monitor, returning how many accepted the value.
/// One write per monitor, no re-scan.
#[allow(dead_code)] // Part of the ported module's API; the master slider goes through the WMI worker.
pub fn set_brightness_all(percent: u32) -> usize {
    let percent = percent.min(100);
    let monitors = cached();
    let mut applied = 0;
    let mut failed = false;
    for (index, monitor) in monitors.iter().enumerate() {
        if write(monitor, percent) {
            applied += 1;
            // Remember only what the display actually took, and publish the
            // master before the last write finishes so a poll landing mid-loop
            // does not show the previous value.
            remember_one(index, percent);
            MASTER.store(percent, Ordering::Release);
        } else {
            failed = true;
        }
    }
    if failed {
        invalidate();
    }
    applied
}

/// Brightness of the first monitor that answers, used to seed the UI on
/// desktops where WMI reports no ACPI panel at all.
#[allow(dead_code)] // Same as set_brightness_all: kept so the port stays byte-comparable with upstream.
pub fn get_brightness_first() -> Option<u32> {
    read(&cached().into_iter().next()?)
}
