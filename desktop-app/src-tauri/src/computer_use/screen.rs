// WOTANN Computer Use — Screen Capture
// Uses macOS `screencapture` CLI for window/region screenshots.
// This avoids Objective-C bindings to ScreenCaptureKit while
// delivering real screen capture through the same system backend.

use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

/// Screenshot metadata + base64-encoded image data
#[derive(Serialize, Clone)]
pub struct Screenshot {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub data_base64: String,
    pub timestamp: u64,
    pub window_title: Option<String>,
}

/// Capture the entire screen using `screencapture -x -t png`.
/// The `-x` flag suppresses the shutter sound.
pub fn capture_screen() -> Result<Screenshot, String> {
    let tmp = temp_screenshot_path();
    let output = Command::new("screencapture")
        .args(["-x", "-t", "png", tmp.to_str().unwrap_or("/tmp/wotann_sc.png")])
        .output()
        .map_err(|e| format!("Failed to execute screencapture: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("screencapture failed (exit {}): {}", output.status, stderr));
    }

    read_screenshot_file(&tmp, None)
}

/// Capture a specific window by title.
/// Uses `screencapture -x -t png -l <window_id>` when a window ID
/// can be resolved from the title. Falls back to interactive window
/// selection with `-w` (auto-clicks the target) when the title
/// cannot be mapped to a numeric ID.
pub fn capture_window(title: &str) -> Result<Screenshot, String> {
    let tmp = temp_screenshot_path();

    // Try to resolve the window ID via AppleScript
    if let Some(window_id) = resolve_window_id(title) {
        let output = Command::new("screencapture")
            .args([
                "-x", "-t", "png",
                "-l", &window_id.to_string(),
                tmp.to_str().unwrap_or("/tmp/wotann_sc.png"),
            ])
            .output()
            .map_err(|e| format!("Failed to execute screencapture: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("screencapture window failed (exit {}): {}", output.status, stderr));
        }
    } else {
        // Fallback: capture the frontmost window
        let output = Command::new("screencapture")
            .args(["-x", "-t", "png", "-w", tmp.to_str().unwrap_or("/tmp/wotann_sc.png")])
            .output()
            .map_err(|e| format!("Failed to execute screencapture: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("screencapture window fallback failed (exit {}): {}", output.status, stderr));
        }
    }

    read_screenshot_file(&tmp, Some(title.to_string()))
}

/// Capture a rectangular region of the screen.
/// Uses `screencapture -x -t png -R x,y,w,h`.
pub fn capture_region(x: u32, y: u32, width: u32, height: u32) -> Result<Screenshot, String> {
    let tmp = temp_screenshot_path();
    let rect = format!("{},{},{},{}", x, y, width, height);

    let output = Command::new("screencapture")
        .args([
            "-x", "-t", "png",
            "-R", &rect,
            tmp.to_str().unwrap_or("/tmp/wotann_sc.png"),
        ])
        .output()
        .map_err(|e| format!("Failed to execute screencapture: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("screencapture region failed (exit {}): {}", output.status, stderr));
    }

    let mut screenshot = read_screenshot_file(&tmp, None)?;
    screenshot.window_title = Some(format!("region({}x{} at {},{})", width, height, x, y));
    Ok(screenshot)
}

// ── Private helpers ───────────────────────────────────────

/// Read a PNG file from disk, extract dimensions from the PNG
/// header, base64-encode the bytes, and clean up the temp file.
fn read_screenshot_file(path: &PathBuf, window_title: Option<String>) -> Result<Screenshot, String> {
    let data = std::fs::read(path)
        .map_err(|e| format!("Failed to read screenshot file: {}", e))?;

    // Clean up temp file (best-effort)
    let _ = std::fs::remove_file(path);

    if data.len() < 24 {
        return Err("Screenshot file is too small to be a valid PNG".into());
    }

    let (width, height) = read_png_dimensions(&data);
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(&data);

    Ok(Screenshot {
        width,
        height,
        format: "png".into(),
        data_base64,
        timestamp: chrono_ts(),
        window_title,
    })
}

/// Extract width and height from the PNG IHDR chunk.
/// PNG layout: 8-byte signature, then IHDR chunk where
/// bytes 16..20 = width (big-endian u32),
/// bytes 20..24 = height (big-endian u32).
fn read_png_dimensions(data: &[u8]) -> (u32, u32) {
    if data.len() < 24 {
        return (0, 0);
    }
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
    (width, height)
}

/// Resolve a window title to a CGWindowID via AppleScript + CGWindowListCopyWindowInfo.
/// Returns None if the title cannot be matched (caller should fall back to `-w`).
fn resolve_window_id(title: &str) -> Option<u32> {
    // Use Python to query the CGWindowListCopyWindowInfo API since
    // it's the most reliable way to get window IDs without ObjC bindings.
    // Python ships with macOS and Quartz is always available.
    //
    // SECURITY: Escape all special characters to prevent code injection.
    // Order matters — backslashes MUST be escaped first, then the rest.
    let safe_title = title
        .replace('\\', "\\\\")   // backslashes first
        .replace('"', "\\\"")    // double quotes
        .replace('\'', "\\'")    // single quotes
        .replace('$', "\\$")     // dollar signs (shell expansion)
        .replace('\n', "\\n")    // newlines — prevent multi-line injection
        .replace('\r', "\\r")    // carriage returns
        .replace('\t', "\\t")    // tabs
        .replace('\0', "");      // null bytes — strip entirely

    let script = format!(
        r#"
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
    Quartz.kCGNullWindowID
)
target = "{}"
for w in windows:
    name = w.get("kCGWindowName", "")
    owner = w.get("kCGWindowOwnerName", "")
    if target.lower() in str(name).lower() or target.lower() in str(owner).lower():
        print(w.get("kCGWindowNumber", 0))
        break
"#,
        safe_title
    );

    let output = Command::new("python3")
        .args(["-c", &script])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.trim().parse::<u32>().ok().filter(|&id| id > 0)
}

/// Generate a unique temp file path for a screenshot.
fn temp_screenshot_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.push(format!("wotann_screenshot_{}.png", id));
    path
}

fn chrono_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
