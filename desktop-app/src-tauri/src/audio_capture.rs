//! Audio capture for Meet Mode.
//!
//! Strategy:
//! - Primary: Core Audio Taps (macOS 14.4+) for per-process audio capture.
//!   Requires the `coreaudio-sys` crate with complex bindings — deferred to
//!   a future sprint when the full audio pipeline is built.
//! - Fallback: System-level recording via screencapture -v (macOS 13+).
//!   Uses ScreenCaptureKit's audio capture through the screencapture CLI,
//!   which captures system audio output including meeting audio.
//!
//! This module provides:
//! 1. Meeting app detection (Zoom, Teams, Slack, Discord, FaceTime, Meet)
//! 2. Meeting app PID resolution for targeted audio capture
//! 3. Start/stop recording via screencapture subprocess
//! 4. Tauri command wrappers for the frontend

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

/// Active recording process handle.
/// Protected by a Mutex so start/stop can be called from any thread.
static RECORDING_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

/// Known meeting applications and their process names.
const MEETING_APPS: &[(&str, &str)] = &[
    ("zoom", "zoom.us"),
    ("teams", "Microsoft Teams"),
    ("slack", "Slack"),
    ("discord", "Discord"),
    ("facetime", "FaceTime"),
    ("meet", "Google Chrome"), // Meet runs in browser — detection is approximate
    ("webex", "Cisco Webex"),
    ("skype", "Skype"),
];

/// Detect which meeting app is currently running.
/// Returns the internal name (e.g., "zoom", "teams") or None if no known
/// meeting app is found in the process list.
pub fn detect_meeting_app() -> Option<String> {
    let output = Command::new("ps")
        .args(["-eo", "comm"])
        .output()
        .ok()?;

    let ps = String::from_utf8_lossy(&output.stdout);

    for (name, process_name) in MEETING_APPS {
        if ps.contains(process_name) {
            return Some((*name).to_string());
        }
    }
    None
}

/// Get the PID of the detected meeting app for targeted audio capture.
/// Uses `pgrep` for reliable process matching.
pub fn get_meeting_app_pid() -> Option<u32> {
    let app_name = detect_meeting_app()?;

    let target = MEETING_APPS
        .iter()
        .find(|(name, _)| *name == app_name)
        .map(|(_, proc_name)| *proc_name)?;

    let output = Command::new("pgrep")
        .args(["-f", target])
        .output()
        .ok()?;

    // pgrep may return multiple PIDs (one per line); take the first
    let pid_str = String::from_utf8_lossy(&output.stdout);
    pid_str
        .lines()
        .next()
        .and_then(|line| line.trim().parse::<u32>().ok())
}

/// Start recording system audio using `screencapture -v` (macOS 13+).
///
/// Creates a timestamped `.mov` file in the given directory.
/// The screencapture CLI uses ScreenCaptureKit internally to capture
/// system audio output, which includes meeting/call audio.
///
/// Returns the output file path on success.
///
/// NOTE: Full Core Audio Taps (per-process capture via
/// `AudioHardwareCreateProcessTap`) require `coreaudio-sys` bindings
/// and will be added in a future sprint. This screencapture fallback
/// captures all system audio, not just a single app.
pub fn start_recording(output_dir: &str) -> Result<PathBuf, String> {
    // Bail if a recording is already in progress
    {
        let guard = RECORDING_PROCESS.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("A recording is already in progress".to_string());
        }
    }

    // Ensure the output directory exists
    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let output_path = PathBuf::from(output_dir).join(format!("meeting-{}.mov", timestamp));

    // screencapture -v captures video + audio via ScreenCaptureKit.
    // -C hides the cursor, -G sets a display name for the permission dialog.
    let child = Command::new("screencapture")
        .args([
            "-v",
            "-C",
            "-G",
            "wotann-meeting",
            &output_path.to_string_lossy(),
        ])
        .spawn()
        .map_err(|e| format!("Failed to start recording: {}", e))?;

    let mut guard = RECORDING_PROCESS.lock().map_err(|e| e.to_string())?;
    *guard = Some(child);

    Ok(output_path)
}

/// Stop the current audio recording.
///
/// Sends SIGKILL to the screencapture process and waits for it to exit.
/// Returns true if a recording was stopped, false if none was active.
pub fn stop_recording() -> bool {
    let mut guard = match RECORDING_PROCESS.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };

    if let Some(ref mut child) = *guard {
        let _ = child.kill();
        let _ = child.wait();
        *guard = None;
        true
    } else {
        false
    }
}

/// Check if system audio capture is available.
/// On macOS 14.4+, Core Audio Taps are available.
/// On older versions, we fall back to screencapture -v.
pub fn is_audio_capture_available() -> bool {
    // Check macOS version for Core Audio Taps support (14.4+)
    let output = Command::new("sw_vers")
        .args(["-productVersion"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let parts: Vec<u32> = version
                .split('.')
                .filter_map(|p| p.parse().ok())
                .collect();

            // Core Audio Taps require macOS 14.4+
            // Fallback (screencapture -v) is available on 13.0+
            match (parts.first(), parts.get(1)) {
                (Some(&major), _) if major >= 15 => true,
                (Some(14), Some(&minor)) if minor >= 4 => true,
                (Some(&major), _) if major >= 13 => true, // screencapture fallback
                _ => false,
            }
        }
        _ => false,
    }
}

// ── Tauri Commands ──────────────────────────────────────────

/// Detect which meeting app is running (Zoom, Teams, Slack, etc.).
#[tauri::command]
pub fn detect_meeting() -> Option<String> {
    detect_meeting_app()
}

/// Start recording meeting audio to the given output directory.
/// Returns the output file path.
#[tauri::command]
pub fn start_meeting_recording(output_dir: String) -> Result<String, String> {
    start_recording(&output_dir).map(|p| p.to_string_lossy().to_string())
}

/// Stop the current meeting audio recording.
#[tauri::command]
pub fn stop_meeting_recording() -> bool {
    stop_recording()
}

/// Check if audio capture is available on this system.
#[tauri::command]
pub fn check_audio_capture() -> bool {
    is_audio_capture_available()
}

/// Get the PID of the running meeting app, if any.
#[tauri::command]
pub fn get_meeting_pid() -> Option<u32> {
    get_meeting_app_pid()
}
