// WOTANN Computer Use — macOS Permission Management
// Checks TCC (Transparency, Consent, and Control) permissions
// for Screen Recording, Accessibility, and Automation.
//
// Strategy:
// - Screen Recording: attempt a real screencapture; if the output
//   file is valid, permission is granted.
// - Accessibility: ask System Events for a process name; if it
//   fails, accessibility is not granted.
// - Automation: ask System Events to get the frontmost app;
//   if it fails, automation is not granted.
// - Settings: open the correct System Settings privacy pane.

use serde::Serialize;
use std::process::Command;

/// Permission status for Computer Use capabilities
#[derive(Serialize, Clone)]
pub struct PermissionStatus {
    pub screen_recording: PermissionState,
    pub accessibility: PermissionState,
    pub automation: PermissionState,
}

/// State of a single permission
#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub enum PermissionState {
    Granted,
    Denied,
    NotDetermined,
}

/// Check all required permissions by probing the system.
pub fn check_permissions() -> PermissionStatus {
    PermissionStatus {
        screen_recording: check_screen_recording(),
        accessibility: check_accessibility(),
        automation: check_automation(),
    }
}

/// Open System Settings to the relevant permission pane.
/// Supports: screen_recording, accessibility, automation.
pub fn open_permission_settings(permission: &str) -> Result<(), String> {
    let url = match permission {
        "screen_recording" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "automation" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        }
        _ => return Err(format!("Unknown permission: {}", permission)),
    };

    Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| format!("Failed to open System Settings: {}", e))?;

    Ok(())
}

// ── Permission probes ────────────────────────────────────

/// Check Screen Recording permission by attempting a real capture.
/// When screen recording is denied, `screencapture` either produces
/// a 0-byte file or a tiny all-black image. We check that the output
/// is a valid PNG of reasonable size.
fn check_screen_recording() -> PermissionState {
    let mut tmp = std::env::temp_dir();
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    tmp.push(format!("wotann_perm_check_{}.png", id));

    let result = Command::new("screencapture")
        .args(["-x", "-t", "png", tmp.to_str().unwrap_or("/tmp/wotann_perm.png")])
        .output();

    let state = match result {
        Ok(output) if output.status.success() => {
            // Check if the file exists and has meaningful content.
            // A denied capture often produces a file <1KB (blank/black).
            // A real capture of even a tiny screen is typically >10KB.
            match std::fs::metadata(&tmp) {
                Ok(meta) if meta.len() > 1024 => PermissionState::Granted,
                Ok(_) => PermissionState::Denied,
                Err(_) => PermissionState::Denied,
            }
        }
        Ok(_) => PermissionState::Denied,
        Err(_) => PermissionState::NotDetermined,
    };

    // Clean up temp file (best-effort)
    let _ = std::fs::remove_file(&tmp);
    state
}

/// Check Accessibility permission by asking System Events for
/// the name of the first process. This requires the calling app
/// to have Accessibility permission in TCC.
fn check_accessibility() -> PermissionState {
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get name of first process",
        ])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            if stdout.trim().is_empty() {
                PermissionState::Denied
            } else {
                PermissionState::Granted
            }
        }
        Ok(_) => PermissionState::Denied,
        Err(_) => PermissionState::NotDetermined,
    }
}

/// Check Automation permission by asking System Events for the
/// frontmost application. Automation permission is a subset of
/// Accessibility but is tracked separately in TCC on newer macOS.
fn check_automation() -> PermissionState {
    let output = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            if stdout.trim().is_empty() {
                PermissionState::Denied
            } else {
                PermissionState::Granted
            }
        }
        Ok(_) => PermissionState::Denied,
        Err(_) => PermissionState::NotDetermined,
    }
}
