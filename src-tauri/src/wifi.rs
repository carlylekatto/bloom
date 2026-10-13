//! Wi-Fi network management for the notch's Wi-Fi view: scan, list, connect
//! (with a password for new personal networks), disconnect and forget, through
//! the native WLAN API. A notification listener emits `wifi-changed` when a
//! scan finishes or the connection changes, so the view never has to poll.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::{GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, HANDLE};
use windows::Win32::NetworkManagement::WiFi::{
    dot11_BSS_type_infrastructure, wlan_connection_mode_profile,
    wlan_intf_opcode_current_connection, wlan_notification_acm_connection_attempt_fail,
    wlan_notification_acm_connection_complete, wlan_notification_acm_disconnected,
    wlan_notification_acm_interface_arrival, wlan_notification_acm_interface_removal,
    wlan_notification_acm_profile_change, wlan_notification_acm_scan_complete,
    wlan_notification_acm_scan_fail, wlan_notification_acm_scan_list_refresh, WlanCloseHandle,
    WlanConnect, WlanDeleteProfile, WlanDisconnect, WlanEnumInterfaces, WlanFreeMemory,
    WlanGetAvailableNetworkList, WlanGetProfile, WlanOpenHandle, WlanQueryInterface,
    WlanRegisterNotification, WlanScan, WlanSetProfile, DOT11_CIPHER_ALGO_TKIP, DOT11_SSID,
    L2_NOTIFICATION_DATA, WLAN_AVAILABLE_NETWORK, WLAN_AVAILABLE_NETWORK_CONNECTED,
    WLAN_AVAILABLE_NETWORK_HAS_PROFILE, WLAN_AVAILABLE_NETWORK_LIST, WLAN_CONNECTION_ATTRIBUTES,
    WLAN_CONNECTION_NOTIFICATION_DATA, WLAN_CONNECTION_PARAMETERS, WLAN_INTERFACE_INFO_LIST,
    WLAN_NOTIFICATION_SOURCE_ACM, WLAN_REASON_CODE_MSMSEC_BASE,
    WLAN_REASON_CODE_MSMSEC_PSK_MISMATCH_SUSPECTED,
};

/// How long to wait for Windows to report the outcome of a connection attempt.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Clone, Serialize)]
pub struct WifiNetwork {
    pub ssid: String,
    /// Signal quality, 0-100.
    pub signal: u32,
    /// "open", "wep", "wpa", "wpa2", "wpa3", "owe", "enterprise" or "other".
    pub security: &'static str,
    pub connected: bool,
    /// Windows has a saved profile for it, so it connects without a password.
    pub saved: bool,
}

#[derive(Clone, Serialize)]
pub struct WifiNetworkList {
    pub networks: Vec<WifiNetwork>,
    /// Windows refused to list networks because location access is off for
    /// desktop apps (required for Wi-Fi scans since Windows 11 24H2).
    pub location_denied: bool,
}

/// One visible network as the connect path needs it.
struct Candidate {
    ssid_bytes: Vec<u8>,
    profile: Option<String>,
    security: &'static str,
    tkip: bool,
}

/// A WLAN client handle, closed on drop.
struct Client(HANDLE);

impl Client {
    fn open() -> Result<Self, String> {
        let mut version = 0u32;
        let mut handle = HANDLE::default();
        let rc = unsafe { WlanOpenHandle(2, None, &mut version, &mut handle) };
        if rc != 0 {
            return Err(format!("Couldn't reach the Wi-Fi service ({rc})"));
        }
        Ok(Client(handle))
    }

    /// The first wireless interface. Like the Windows quick settings, Bloom
    /// manages one adapter.
    fn interface(&self) -> Result<GUID, String> {
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        let rc = unsafe { WlanEnumInterfaces(self.0, None, &mut list) };
        if rc != 0 {
            return Err(format!("Couldn't list Wi-Fi adapters ({rc})"));
        }
        // Success guarantees an allocated list; it ends in a C flexible array,
        // and only its first entry is read.
        let guid = unsafe {
            let guid = list
                .as_ref()
                .filter(|l| l.dwNumberOfItems > 0)
                .map(|l| l.InterfaceInfo[0].InterfaceGuid);
            WlanFreeMemory(list as *const _);
            guid
        };
        guid.ok_or_else(|| "no-adapter".to_string())
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        unsafe {
            WlanCloseHandle(self.0, None);
        }
    }
}

fn ssid_bytes(ssid: &DOT11_SSID) -> &[u8] {
    &ssid.ucSSID[..(ssid.uSSIDLength as usize).min(ssid.ucSSID.len())]
}

fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

/// Maps a DOT11_AUTH_ALGORITHM value to the security label the view shows.
fn security_label(auth: i32, secured: bool) -> &'static str {
    match auth {
        1 if !secured => "open",
        1 | 2 => "wep",
        4 => "wpa",
        7 => "wpa2",
        9 => "wpa3",
        10 => "owe",
        3 | 6 | 8 | 11 => "enterprise",
        _ => "other",
    }
}

/// Reads the visible networks, grouped by SSID. Windows lists a saved network
/// twice (once with its profile), so entries are merged.
fn visible_networks(
    client: &Client,
    iface: &GUID,
) -> Result<Option<Vec<(WifiNetwork, Candidate)>>, String> {
    let mut list: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
    let rc = unsafe { WlanGetAvailableNetworkList(client.0, iface, 0, None, &mut list) };
    if rc == ERROR_ACCESS_DENIED.0 {
        return Ok(None);
    }
    if rc != 0 {
        return Err(format!("Couldn't list Wi-Fi networks ({rc})"));
    }

    let mut merged: HashMap<Vec<u8>, (WifiNetwork, Candidate)> = HashMap::new();
    unsafe {
        if let Some(header) = list.as_ref() {
            let count = header.dwNumberOfItems as usize;
            // Same flexible-array pattern as the interface list; the count is
            // bounded before the slice is built.
            if count > 0 && count <= 1024 {
                let entries: &[WLAN_AVAILABLE_NETWORK] =
                    std::slice::from_raw_parts(header.Network.as_ptr(), count);
                for entry in entries {
                    let bytes = ssid_bytes(&entry.dot11Ssid);
                    // Hidden networks have no name to show; ad hoc ones aren't managed.
                    if bytes.is_empty() || entry.dot11BssType != dot11_BSS_type_infrastructure {
                        continue;
                    }
                    let has_profile = entry.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE != 0;
                    let profile = has_profile.then(|| wide_to_string(&entry.strProfileName));
                    let network = WifiNetwork {
                        ssid: String::from_utf8_lossy(bytes).into_owned(),
                        signal: entry.wlanSignalQuality.min(100),
                        security: security_label(
                            entry.dot11DefaultAuthAlgorithm.0,
                            entry.bSecurityEnabled.as_bool(),
                        ),
                        connected: entry.dwFlags & WLAN_AVAILABLE_NETWORK_CONNECTED != 0,
                        saved: has_profile,
                    };
                    let candidate = Candidate {
                        ssid_bytes: bytes.to_vec(),
                        profile,
                        security: network.security,
                        tkip: entry.dot11DefaultCipherAlgorithm == DOT11_CIPHER_ALGO_TKIP,
                    };
                    match merged.get_mut(bytes) {
                        Some((existing, existing_candidate)) => {
                            existing.signal = existing.signal.max(network.signal);
                            existing.connected |= network.connected;
                            existing.saved |= network.saved;
                            if existing_candidate.profile.is_none() {
                                existing_candidate.profile = candidate.profile;
                            }
                        }
                        None => {
                            merged.insert(bytes.to_vec(), (network, candidate));
                        }
                    }
                }
            }
        }
        WlanFreeMemory(list as *const _);
    }

    let mut networks: Vec<_> = merged.into_values().collect();
    // Connected first, then saved, then strongest.
    networks.sort_by(|(a, _), (b, _)| {
        b.connected
            .cmp(&a.connected)
            .then(b.saved.cmp(&a.saved))
            .then(b.signal.cmp(&a.signal))
            .then(a.ssid.to_lowercase().cmp(&b.ssid.to_lowercase()))
    });
    Ok(Some(networks))
}

fn find_candidate(client: &Client, iface: &GUID, ssid: &str) -> Result<Candidate, String> {
    let networks = visible_networks(client, iface)?.ok_or("location-denied")?;
    networks
        .into_iter()
        .find(|(n, _)| n.ssid == ssid)
        .map(|(_, c)| c)
        .ok_or_else(|| "not-found".to_string())
}

fn escape_xml(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// A WLAN profile for an open or personal (pre-shared key) network. The SSID
/// is given in hex so names with any bytes round-trip exactly.
fn profile_xml(name: &str, ssid: &[u8], security: &str, tkip: bool, key: Option<&str>) -> String {
    let hex: String = ssid.iter().map(|b| format!("{b:02X}")).collect();
    let (auth, encryption) = match security {
        "wpa" => ("WPAPSK", if tkip { "TKIP" } else { "AES" }),
        "wpa2" => ("WPA2PSK", if tkip { "TKIP" } else { "AES" }),
        "wpa3" => ("WPA3SAE", "AES"),
        _ => ("open", "none"),
    };
    // WPA3 networks often also accept WPA2 clients; transition mode lets
    // Windows fall back instead of failing.
    let transition = if auth == "WPA3SAE" {
        r#"<transitionMode xmlns="http://www.microsoft.com/networking/WLAN/profile/v4">true</transitionMode>"#
    } else {
        ""
    };
    let shared_key = match key {
        Some(key) => format!(
            "<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{}</keyMaterial></sharedKey>",
            escape_xml(key)
        ),
        None => String::new(),
    };
    format!(
        r#"<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>{name}</name><SSIDConfig><SSID><hex>{hex}</hex><name>{name}</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>{auth}</authentication><encryption>{encryption}</encryption><useOneX>false</useOneX>{transition}</authEncryption>{shared_key}</security></MSM></WLANProfile>"#,
        name = escape_xml(name),
    )
}

/// A WPA passphrase is 8-63 characters, or exactly 64 hex digits.
fn valid_passphrase(key: &str) -> bool {
    let len = key.chars().count();
    (8..=63).contains(&len) || (len == 64 && key.chars().all(|c| c.is_ascii_hexdigit()))
}

// The windows crate binds this with a shared slice that Windows writes into,
// which lets the compiler assume the buffer never changes. Declared here with
// a writable pointer instead.
#[link(name = "wlanapi", kind = "raw-dylib")]
extern "system" {
    #[link_name = "WlanReasonCodeToString"]
    fn wlan_reason_code_to_string(
        reason: u32,
        size: u32,
        buffer: *mut u16,
        reserved: *const std::ffi::c_void,
    ) -> u32;
}

fn reason_text(code: u32) -> String {
    let mut buf = [0u16; 512];
    let rc = unsafe {
        wlan_reason_code_to_string(code, buf.len() as u32, buf.as_mut_ptr(), std::ptr::null())
    };
    let text = if rc == 0 {
        wide_to_string(&buf)
    } else {
        String::new()
    };
    if text.is_empty() {
        format!("Couldn't connect ({code})")
    } else {
        text
    }
}

fn get_profile_xml(client: &Client, iface: &GUID, name: &str) -> Option<String> {
    let mut xml = PWSTR::null();
    let rc = unsafe {
        WlanGetProfile(
            client.0,
            iface,
            &HSTRING::from(name),
            None,
            &mut xml,
            None,
            None,
        )
    };
    if rc != 0 || xml.is_null() {
        return None;
    }
    unsafe {
        let text = xml.to_string().ok();
        WlanFreeMemory(xml.0 as *const _);
        text
    }
}

fn set_profile_xml(client: &Client, iface: &GUID, xml: &str) -> Result<(), String> {
    let mut reason = 0u32;
    let rc = unsafe {
        WlanSetProfile(
            client.0,
            iface,
            0,
            &HSTRING::from(xml),
            PCWSTR::null(),
            true,
            None,
            &mut reason,
        )
    };
    if rc != 0 {
        return Err(if reason != 0 {
            reason_text(reason)
        } else {
            format!("Couldn't save the network ({rc})")
        });
    }
    Ok(())
}

// ── Notifications ────────────────────────────────────────────────────────────

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The SSID a connect call is waiting on, and where to send its reason code.
static PENDING_CONNECT: Mutex<Option<(Vec<u8>, Sender<u32>)>> = Mutex::new(None);

unsafe extern "system" fn on_notification(
    data: *mut L2_NOTIFICATION_DATA,
    _: *mut std::ffi::c_void,
) {
    let Some(data) = (unsafe { data.as_ref() }) else {
        return;
    };
    if data.NotificationSource != WLAN_NOTIFICATION_SOURCE_ACM {
        return;
    }
    let code = data.NotificationCode as i32;

    if code == wlan_notification_acm_connection_complete.0
        || code == wlan_notification_acm_connection_attempt_fail.0
    {
        let info = unsafe { (data.pData as *const WLAN_CONNECTION_NOTIFICATION_DATA).as_ref() };
        if let Some(info) = info {
            if let Ok(mut pending) = PENDING_CONNECT.lock() {
                let matches = pending
                    .as_ref()
                    .is_some_and(|(ssid, _)| ssid.as_slice() == ssid_bytes(&info.dot11Ssid));
                if matches {
                    if let Some((_, tx)) = pending.take() {
                        let _ = tx.send(info.wlanReasonCode);
                    }
                }
            }
        }
    }

    let refresh = [
        wlan_notification_acm_scan_complete.0,
        wlan_notification_acm_scan_fail.0,
        wlan_notification_acm_scan_list_refresh.0,
        wlan_notification_acm_connection_complete.0,
        wlan_notification_acm_disconnected.0,
        wlan_notification_acm_interface_arrival.0,
        wlan_notification_acm_interface_removal.0,
        wlan_notification_acm_profile_change.0,
    ];
    if refresh.contains(&code) {
        if let Some(app) = APP.get() {
            let _ = app.emit("wifi-changed", ());
        }
    }
}

/// Registers for WLAN notifications so the Wi-Fi view and the controls tile
/// update as soon as a scan finishes or the connection changes.
pub fn setup_wifi_notifications(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| {
        let Ok(client) = Client::open() else {
            return;
        };
        let rc = unsafe {
            WlanRegisterNotification(
                client.0,
                WLAN_NOTIFICATION_SOURCE_ACM,
                true,
                Some(on_notification),
                None,
                None,
                None,
            )
        };
        if rc == 0 {
            // Keep the handle open for the app's lifetime: closing it would
            // unregister the callback.
            std::mem::forget(client);
        }
    });
}

/// Name of the network the adapter is associated with, if any.
pub fn connected_ssid() -> Option<String> {
    let client = Client::open().ok()?;
    let iface = client.interface().ok()?;
    let mut size = 0u32;
    let mut data: *mut std::ffi::c_void = std::ptr::null_mut();
    unsafe {
        let rc = WlanQueryInterface(
            client.0,
            &iface,
            wlan_intf_opcode_current_connection,
            None,
            &mut size,
            &mut data,
            None,
        );
        // Fails with ERROR_INVALID_STATE while not associated.
        let ssid = if rc == 0 {
            (data as *const WLAN_CONNECTION_ATTRIBUTES)
                .as_ref()
                .map(|attrs| {
                    String::from_utf8_lossy(ssid_bytes(&attrs.wlanAssociationAttributes.dot11Ssid))
                        .into_owned()
                })
        } else {
            None
        };
        if !data.is_null() {
            WlanFreeMemory(data);
        }
        ssid
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

fn list_sync() -> Result<WifiNetworkList, String> {
    let client = Client::open()?;
    let iface = client.interface()?;
    Ok(match visible_networks(&client, &iface)? {
        Some(networks) => WifiNetworkList {
            networks: networks.into_iter().map(|(n, _)| n).collect(),
            location_denied: false,
        },
        None => WifiNetworkList {
            networks: Vec::new(),
            location_denied: true,
        },
    })
}

/// Networks Windows can currently see, from its last scan.
#[tauri::command]
pub async fn wifi_list_networks() -> Result<WifiNetworkList, String> {
    tauri::async_runtime::spawn_blocking(list_sync)
        .await
        .map_err(|e| e.to_string())?
}

/// Starts a fresh scan. Results arrive as a `wifi-changed` event.
#[tauri::command]
pub async fn wifi_scan() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = Client::open()?;
        let iface = client.interface()?;
        let rc = unsafe { WlanScan(client.0, &iface, None, None, None) };
        if rc != 0 {
            return Err(format!("Couldn't scan for networks ({rc})"));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn connect_sync(ssid: &str, password: Option<&str>) -> Result<(), String> {
    let client = Client::open()?;
    let iface = client.interface()?;
    let candidate = find_candidate(&client, &iface, ssid)?;
    let personal = matches!(candidate.security, "wpa" | "wpa2" | "wpa3");

    // What to restore if the attempt fails: the profile this call replaced,
    // or nothing (delete the one it created).
    let mut created: Option<(String, Option<String>)> = None;
    let profile = match (password, &candidate.profile) {
        (None, Some(existing)) => existing.clone(),
        (None, None) if candidate.security == "open" => {
            set_profile_xml(
                &client,
                &iface,
                &profile_xml(ssid, &candidate.ssid_bytes, "open", false, None),
            )?;
            created = Some((ssid.to_string(), None));
            ssid.to_string()
        }
        (None, None) if personal => return Err("password-required".into()),
        (None, None) => return Err("unsupported".into()),
        (Some(key), existing) => {
            if !personal {
                return Err("unsupported".into());
            }
            if !valid_passphrase(key) {
                return Err("password-length".into());
            }
            let name = existing.clone().unwrap_or_else(|| ssid.to_string());
            let backup = get_profile_xml(&client, &iface, &name);
            set_profile_xml(
                &client,
                &iface,
                &profile_xml(
                    &name,
                    &candidate.ssid_bytes,
                    candidate.security,
                    candidate.tkip,
                    Some(key),
                ),
            )?;
            created = Some((name.clone(), backup));
            name
        }
    };

    let (tx, rx) = channel();
    if let Ok(mut pending) = PENDING_CONNECT.lock() {
        *pending = Some((candidate.ssid_bytes.clone(), tx));
    }

    let name = HSTRING::from(profile.as_str());
    let params = WLAN_CONNECTION_PARAMETERS {
        wlanConnectionMode: wlan_connection_mode_profile,
        strProfile: PCWSTR(name.as_ptr()),
        pDot11Ssid: std::ptr::null_mut(),
        pDesiredBssidList: std::ptr::null_mut(),
        dot11BssType: dot11_BSS_type_infrastructure,
        dwFlags: 0,
    };
    let rc = unsafe { WlanConnect(client.0, &iface, &params, None) };
    let outcome = if rc != 0 {
        Err(format!("Couldn't connect ({rc})"))
    } else {
        match rx.recv_timeout(CONNECT_TIMEOUT) {
            Ok(0) => Ok(()),
            Ok(reason) if password.is_some() && is_key_mismatch(reason) => {
                Err("wrong-password".to_string())
            }
            Ok(reason) => Err(reason_text(reason)),
            Err(_) => Err("timeout".to_string()),
        }
    };
    if let Ok(mut pending) = PENDING_CONNECT.lock() {
        *pending = None;
    }

    if outcome.is_err() {
        // Don't leave a profile with a wrong key behind.
        if let Some((name, backup)) = created {
            match backup {
                Some(xml) => {
                    let _ = set_profile_xml(&client, &iface, &xml);
                }
                None => unsafe {
                    WlanDeleteProfile(client.0, &iface, &HSTRING::from(name.as_str()), None);
                },
            }
        }
    }
    outcome
}

/// Security failures during the key exchange, which with a typed password
/// almost always mean the password is wrong.
fn is_key_mismatch(reason: u32) -> bool {
    reason == WLAN_REASON_CODE_MSMSEC_PSK_MISMATCH_SUSPECTED
        || (WLAN_REASON_CODE_MSMSEC_BASE..WLAN_REASON_CODE_MSMSEC_BASE + 0x10000).contains(&reason)
}

/// Connects to a visible network. Saved and open networks need no password;
/// a new personal network needs one. Errors are short codes the view maps to
/// messages ("wrong-password", "password-required", "password-length",
/// "unsupported", "not-found", "timeout", "location-denied", "no-adapter") or
/// Windows' own text.
#[tauri::command]
pub async fn wifi_connect(ssid: String, password: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || connect_sync(&ssid, password.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn wifi_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = Client::open()?;
        let iface = client.interface()?;
        let rc = unsafe { WlanDisconnect(client.0, &iface, None) };
        if rc != 0 {
            return Err(format!("Couldn't disconnect ({rc})"));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes the saved profile of a visible network, disconnecting from it if
/// it's the current one.
#[tauri::command]
pub async fn wifi_forget(ssid: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = Client::open()?;
        let iface = client.interface()?;
        let candidate = find_candidate(&client, &iface, &ssid)?;
        let profile = candidate.profile.ok_or("not-saved")?;
        let rc =
            unsafe { WlanDeleteProfile(client.0, &iface, &HSTRING::from(profile.as_str()), None) };
        if rc != 0 {
            return Err(format!("Couldn't forget the network ({rc})"));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens the Windows Settings page the Wi-Fi view hands off to: the Wi-Fi
/// page (work networks, hidden networks) or the location page (scan access).
#[tauri::command]
pub fn wifi_open_settings(page: String) -> Result<(), String> {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let uri = match page.as_str() {
        "wifi" => "ms-settings:network-wifi",
        "location" => "ms-settings:privacy-location",
        _ => return Err(format!("Unknown settings page: {page}")),
    };
    unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("open"),
            &HSTRING::from(uri),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_security() {
        assert_eq!(security_label(1, false), "open");
        assert_eq!(security_label(1, true), "wep");
        assert_eq!(security_label(7, true), "wpa2");
        assert_eq!(security_label(9, true), "wpa3");
        assert_eq!(security_label(6, true), "enterprise");
        assert_eq!(security_label(11, true), "enterprise");
    }

    #[test]
    fn checks_passphrases() {
        assert!(!valid_passphrase("short"));
        assert!(valid_passphrase("eight ch"));
        assert!(valid_passphrase(&"a".repeat(63)));
        assert!(!valid_passphrase(&"a".repeat(64).replace('a', "g")));
        assert!(valid_passphrase(&"ab".repeat(32)));
    }

    #[test]
    fn builds_escaped_profiles() {
        let xml = profile_xml(
            "Café & <Home>",
            "Café".as_bytes(),
            "wpa2",
            false,
            Some("p&ss<word>"),
        );
        assert!(xml.contains("<name>Café &amp; &lt;Home&gt;</name>"));
        assert!(xml.contains("<hex>436166C3A9</hex>"));
        assert!(
            xml.contains("<authentication>WPA2PSK</authentication><encryption>AES</encryption>")
        );
        assert!(xml.contains("<keyMaterial>p&amp;ss&lt;word&gt;</keyMaterial>"));

        let open = profile_xml("Guest", b"Guest", "open", false, None);
        assert!(open.contains("<authentication>open</authentication><encryption>none</encryption>"));
        assert!(!open.contains("sharedKey"));

        let wpa3 = profile_xml("Home", b"Home", "wpa3", false, Some("password1"));
        assert!(wpa3.contains("WPA3SAE") && wpa3.contains("transitionMode"));
    }

    #[test]
    fn spots_key_mismatches() {
        assert!(is_key_mismatch(
            WLAN_REASON_CODE_MSMSEC_PSK_MISMATCH_SUSPECTED
        ));
        assert!(is_key_mismatch(WLAN_REASON_CODE_MSMSEC_BASE + 5));
        assert!(!is_key_mismatch(0));
        assert!(!is_key_mismatch(0x30000));
    }
}
