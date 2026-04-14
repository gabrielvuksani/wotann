// WOTANN Computer Use — Mouse & Keyboard Input
// Uses macOS osascript (AppleScript) for keyboard input and
// cliclick (if available) or osascript for mouse control.
//
// Strategy:
// - Mouse: prefer `cliclick` for precision (brew install cliclick),
//   fall back to AppleScript mouse events via System Events.
// - Keyboard: `osascript` via System Events for all typing/shortcuts.

use serde::{Deserialize, Serialize};
use std::process::Command;

/// Mouse action to perform
#[derive(Deserialize, Clone)]
pub enum MouseAction {
    Click { x: f64, y: f64 },
    DoubleClick { x: f64, y: f64 },
    RightClick { x: f64, y: f64 },
    Drag { from_x: f64, from_y: f64, to_x: f64, to_y: f64 },
    Scroll { x: f64, y: f64, delta_y: i32 },
    Move { x: f64, y: f64 },
}

/// Keyboard action to perform
#[derive(Deserialize, Clone)]
pub enum KeyboardAction {
    Type { text: String },
    Press { key: String, modifiers: Vec<String> },
    Shortcut { keys: Vec<String> },
}

/// Result of an input action
#[derive(Serialize, Clone)]
pub struct InputResult {
    pub success: bool,
    pub action: String,
    pub error: Option<String>,
}

/// Execute a mouse action.
/// Tries cliclick first (higher precision), falls back to AppleScript.
pub fn execute_mouse(action: &MouseAction) -> InputResult {
    if has_cliclick() {
        execute_mouse_cliclick(action)
    } else {
        execute_mouse_applescript(action)
    }
}

/// Execute a keyboard action via AppleScript System Events.
pub fn execute_keyboard(action: &KeyboardAction) -> InputResult {
    match action {
        KeyboardAction::Type { text } => type_text(text),
        KeyboardAction::Press { key, modifiers } => press_key(key, modifiers),
        KeyboardAction::Shortcut { keys } => press_shortcut(keys),
    }
}

// ── Mouse: cliclick backend ──────────────────────────────

fn execute_mouse_cliclick(action: &MouseAction) -> InputResult {
    let (cmd_arg, description) = match action {
        MouseAction::Click { x, y } => {
            (format!("c:{},{}", *x as i32, *y as i32), format!("click({}, {})", x, y))
        }
        MouseAction::DoubleClick { x, y } => {
            (format!("dc:{},{}", *x as i32, *y as i32), format!("double_click({}, {})", x, y))
        }
        MouseAction::RightClick { x, y } => {
            (format!("rc:{},{}", *x as i32, *y as i32), format!("right_click({}, {})", x, y))
        }
        MouseAction::Move { x, y } => {
            (format!("m:{},{}", *x as i32, *y as i32), format!("move({}, {})", x, y))
        }
        MouseAction::Drag { from_x, from_y, to_x, to_y } => {
            let arg = format!(
                "dd:{},{} du:{},{}",
                *from_x as i32, *from_y as i32,
                *to_x as i32, *to_y as i32
            );
            let desc = format!("drag({},{} -> {},{})", from_x, from_y, to_x, to_y);
            (arg, desc)
        }
        MouseAction::Scroll { x, y, delta_y } => {
            // cliclick doesn't support scroll directly; use AppleScript for this
            return execute_scroll_applescript(*x, *y, *delta_y);
        }
    };

    // cliclick uses space-separated multi-commands for drag (dd + du)
    let args: Vec<&str> = cmd_arg.split_whitespace().collect();
    run_command("cliclick", &args, &description)
}

// ── Mouse: AppleScript fallback ──────────────────────────

fn execute_mouse_applescript(action: &MouseAction) -> InputResult {
    match action {
        MouseAction::Click { x, y } => {
            let script = applescript_click(*x, *y, "left", false);
            run_osascript(&script, &format!("click({}, {})", x, y))
        }
        MouseAction::DoubleClick { x, y } => {
            let script = applescript_click(*x, *y, "left", true);
            run_osascript(&script, &format!("double_click({}, {})", x, y))
        }
        MouseAction::RightClick { x, y } => {
            let script = applescript_click(*x, *y, "right", false);
            run_osascript(&script, &format!("right_click({}, {})", x, y))
        }
        MouseAction::Move { x, y } => {
            // AppleScript can't easily move mouse without clicking.
            // Use Python + Quartz as fallback.
            let script = format!(
                "import Quartz; Quartz.CGEventPost(Quartz.kCGHIDEventTap, \
                 Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, ({}, {}), 0))",
                x, y
            );
            run_python(&script, &format!("move({}, {})", x, y))
        }
        MouseAction::Drag { from_x, from_y, to_x, to_y } => {
            let script = format!(
                concat!(
                    "import Quartz, time\n",
                    "down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, ({fx}, {fy}), 0)\n",
                    "Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)\n",
                    "time.sleep(0.05)\n",
                    "drag = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDragged, ({tx}, {ty}), 0)\n",
                    "Quartz.CGEventPost(Quartz.kCGHIDEventTap, drag)\n",
                    "time.sleep(0.05)\n",
                    "up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, ({tx}, {ty}), 0)\n",
                    "Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)\n",
                ),
                fx = from_x, fy = from_y, tx = to_x, ty = to_y
            );
            run_python(&script, &format!("drag({},{} -> {},{})", from_x, from_y, to_x, to_y))
        }
        MouseAction::Scroll { x, y, delta_y } => {
            execute_scroll_applescript(*x, *y, *delta_y)
        }
    }
}

fn execute_scroll_applescript(x: f64, y: f64, delta_y: i32) -> InputResult {
    // Move mouse to position first, then scroll via Python/Quartz
    let script = format!(
        concat!(
            "import Quartz\n",
            "move = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, ({x}, {y}), 0)\n",
            "Quartz.CGEventPost(Quartz.kCGHIDEventTap, move)\n",
            "scroll = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 1, {dy})\n",
            "Quartz.CGEventPost(Quartz.kCGHIDEventTap, scroll)\n",
        ),
        x = x, y = y, dy = delta_y
    );
    run_python(&script, &format!("scroll({},{}, dy={})", x, y, delta_y))
}

fn applescript_click(x: f64, y: f64, button: &str, double: bool) -> String {
    // Use Python/Quartz for click since AppleScript click-at-coordinate
    // is unreliable. Quartz CGEvent is the standard macOS approach.
    let event_down;
    let event_up;
    if button == "right" {
        event_down = "Quartz.kCGEventRightMouseDown";
        event_up = "Quartz.kCGEventRightMouseUp";
    } else {
        event_down = "Quartz.kCGEventLeftMouseDown";
        event_up = "Quartz.kCGEventLeftMouseUp";
    }

    let click_count = if double { 2 } else { 1 };

    // For double click, set clickState on the event
    format!(
        concat!(
            "import Quartz, time\n",
            "for i in range({count}):\n",
            "    down = Quartz.CGEventCreateMouseEvent(None, {edown}, ({x}, {y}), 0)\n",
            "    Quartz.CGEventSetIntegerValueField(down, Quartz.kCGMouseEventClickState, i + 1)\n",
            "    Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)\n",
            "    time.sleep(0.01)\n",
            "    up = Quartz.CGEventCreateMouseEvent(None, {eup}, ({x}, {y}), 0)\n",
            "    Quartz.CGEventSetIntegerValueField(up, Quartz.kCGMouseEventClickState, i + 1)\n",
            "    Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)\n",
            "    if i < {count} - 1: time.sleep(0.05)\n",
        ),
        count = click_count, edown = event_down, eup = event_up,
        x = x, y = y
    )
}

// ── Keyboard: AppleScript backend ────────────────────────

fn type_text(text: &str) -> InputResult {
    // Escape text for AppleScript: backslashes, quotes, and control characters.
    // Control characters can break AppleScript parsing or cause unintended behavior.
    let escaped = text
        .replace('\\', "\\\\")   // backslashes first
        .replace('"', "\\\"")    // double quotes
        .replace('\t', "\\t")    // tab
        .replace('\n', "\\n")    // newline
        .replace('\r', "\\r")    // carriage return
        .chars()
        .filter(|c| !c.is_control() || *c == '\t' || *c == '\n' || *c == '\r')
        .collect::<String>();     // strip remaining control chars (NUL, BEL, etc.)
    let script = format!(
        "tell application \"System Events\" to keystroke \"{}\"",
        escaped
    );
    let display = if text.len() > 20 {
        format!("type(\"{}...\")", &text[..20])
    } else {
        format!("type(\"{}\")", text)
    };
    run_osascript(&script, &display)
}

fn press_key(key: &str, modifiers: &[String]) -> InputResult {
    let key_code = map_key_name_to_applescript(key);

    if modifiers.is_empty() {
        let script = format!(
            "tell application \"System Events\" to key code {}",
            key_code
        );
        return run_osascript(&script, &format!("press({})", key));
    }

    let mod_str = modifiers
        .iter()
        .filter_map(|m| map_modifier_to_applescript(m))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        "tell application \"System Events\" to key code {} using {{{}}}",
        key_code, mod_str
    );
    run_osascript(&script, &format!("press({} + {:?})", key, modifiers))
}

fn press_shortcut(keys: &[String]) -> InputResult {
    if keys.is_empty() {
        return InputResult {
            success: false,
            action: "shortcut([])".into(),
            error: Some("No keys specified for shortcut".into()),
        };
    }

    // Split into modifiers and the final key
    let (modifiers, key) = if keys.len() > 1 {
        (&keys[..keys.len() - 1], &keys[keys.len() - 1])
    } else {
        (&keys[..0], &keys[0])
    };

    let key_code = map_key_name_to_applescript(key);

    if modifiers.is_empty() {
        let script = format!(
            "tell application \"System Events\" to key code {}",
            key_code
        );
        return run_osascript(&script, &format!("shortcut({:?})", keys));
    }

    let mod_str = modifiers
        .iter()
        .filter_map(|m| map_modifier_to_applescript(m))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        "tell application \"System Events\" to key code {} using {{{}}}",
        key_code, mod_str
    );
    run_osascript(&script, &format!("shortcut({:?})", keys))
}

// ── Key mapping ──────────────────────────────────────────

/// Map a key name (e.g. "return", "tab", "a") to an AppleScript key code.
/// For single characters, use `keystroke` instead of `key code`,
/// but key code is more reliable for special keys.
fn map_key_name_to_applescript(key: &str) -> String {
    match key.to_lowercase().as_str() {
        "return" | "enter" => "36".into(),
        "tab" => "48".into(),
        "space" => "49".into(),
        "delete" | "backspace" => "51".into(),
        "escape" | "esc" => "53".into(),
        "left" | "leftarrow" => "123".into(),
        "right" | "rightarrow" => "124".into(),
        "down" | "downarrow" => "125".into(),
        "up" | "uparrow" => "126".into(),
        "f1" => "122".into(),
        "f2" => "120".into(),
        "f3" => "99".into(),
        "f4" => "118".into(),
        "f5" => "96".into(),
        "f6" => "97".into(),
        "f7" => "98".into(),
        "f8" => "100".into(),
        "f9" => "101".into(),
        "f10" => "109".into(),
        "f11" => "103".into(),
        "f12" => "111".into(),
        "home" => "115".into(),
        "end" => "119".into(),
        "pageup" => "116".into(),
        "pagedown" => "121".into(),
        "forwarddelete" => "117".into(),
        // Single character keys — map to their key codes
        "a" => "0".into(),
        "b" => "11".into(),
        "c" => "8".into(),
        "d" => "2".into(),
        "e" => "14".into(),
        "f" => "3".into(),
        "g" => "5".into(),
        "h" => "4".into(),
        "i" => "34".into(),
        "j" => "38".into(),
        "k" => "40".into(),
        "l" => "37".into(),
        "m" => "46".into(),
        "n" => "45".into(),
        "o" => "31".into(),
        "p" => "35".into(),
        "q" => "12".into(),
        "r" => "15".into(),
        "s" => "1".into(),
        "t" => "17".into(),
        "u" => "32".into(),
        "v" => "9".into(),
        "w" => "13".into(),
        "x" => "7".into(),
        "y" => "16".into(),
        "z" => "6".into(),
        "0" => "29".into(),
        "1" => "18".into(),
        "2" => "19".into(),
        "3" => "20".into(),
        "4" => "21".into(),
        "5" => "23".into(),
        "6" => "22".into(),
        "7" => "26".into(),
        "8" => "28".into(),
        "9" => "25".into(),
        // Default: try to parse as a numeric key code
        other => other.to_string(),
    }
}

/// Map a modifier name to its AppleScript equivalent.
fn map_modifier_to_applescript(modifier: &str) -> Option<String> {
    match modifier.to_lowercase().as_str() {
        "cmd" | "command" | "meta" | "super" => Some("command down".into()),
        "shift" => Some("shift down".into()),
        "alt" | "option" | "opt" => Some("option down".into()),
        "ctrl" | "control" => Some("control down".into()),
        "fn" | "function" => Some("function down".into()),
        _ => None,
    }
}

// ── Command runners ──────────────────────────────────────

fn run_osascript(script: &str, description: &str) -> InputResult {
    match Command::new("osascript").args(["-e", script]).output() {
        Ok(output) => {
            if output.status.success() {
                InputResult {
                    success: true,
                    action: description.to_string(),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                InputResult {
                    success: false,
                    action: description.to_string(),
                    error: Some(format!("osascript failed: {}", stderr.trim())),
                }
            }
        }
        Err(e) => InputResult {
            success: false,
            action: description.to_string(),
            error: Some(format!("Failed to run osascript: {}", e)),
        },
    }
}

fn run_python(script: &str, description: &str) -> InputResult {
    match Command::new("python3").args(["-c", script]).output() {
        Ok(output) => {
            if output.status.success() {
                InputResult {
                    success: true,
                    action: description.to_string(),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                InputResult {
                    success: false,
                    action: description.to_string(),
                    error: Some(format!("python3 failed: {}", stderr.trim())),
                }
            }
        }
        Err(e) => InputResult {
            success: false,
            action: description.to_string(),
            error: Some(format!("Failed to run python3: {}", e)),
        },
    }
}

fn run_command(cmd: &str, args: &[&str], description: &str) -> InputResult {
    match Command::new(cmd).args(args).output() {
        Ok(output) => {
            if output.status.success() {
                InputResult {
                    success: true,
                    action: description.to_string(),
                    error: None,
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                InputResult {
                    success: false,
                    action: description.to_string(),
                    error: Some(format!("{} failed: {}", cmd, stderr.trim())),
                }
            }
        }
        Err(e) => InputResult {
            success: false,
            action: description.to_string(),
            error: Some(format!("Failed to run {}: {}", cmd, e)),
        },
    }
}

/// Check if cliclick is available on the system.
fn has_cliclick() -> bool {
    Command::new("which")
        .arg("cliclick")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
