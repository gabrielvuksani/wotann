//! Native input simulation using Core Graphics.
//! Replaces cliclick/xdotool/python3 subprocess calls with direct CGEvent creation.
//!
//! The existing `computer_use/input.rs` uses osascript + cliclick + python3 subprocesses.
//! This module provides zero-subprocess alternatives via the core-graphics crate.
//! Agent events are tagged with a custom userData field so event taps can
//! distinguish agent-generated events from real user input.

#[cfg(target_os = "macos")]
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, EventField, KeyCode,
    ScrollEventUnit,
};
#[cfg(target_os = "macos")]
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
#[cfg(target_os = "macos")]
use core_graphics::geometry::CGPoint;

/// Custom event field for tagging agent-generated events.
/// Uses the generic userData1 field (field 55 / 0x37).
/// Value is "WOTANN" encoded as ASCII bytes packed into a u64.
#[cfg(target_os = "macos")]
const AGENT_EVENT_TAG_FIELD: u32 = 55;
#[cfg(target_os = "macos")]
const AGENT_EVENT_TAG_VALUE: i64 = 0x574F54414E4E; // "WOTANN" in hex

// ── Event Source ────────────────────────────────────────────

/// Create a private event source for agent-generated events.
/// Using `Private` state ensures agent events don't feed back into
/// the combined event state that user input reads from.
#[cfg(target_os = "macos")]
fn agent_source() -> Option<CGEventSource> {
    CGEventSource::new(CGEventSourceStateID::Private).ok()
}

/// Tag an event so downstream event taps can identify it as agent-generated.
#[cfg(target_os = "macos")]
fn tag_event(event: &CGEvent) {
    event.set_integer_value_field(AGENT_EVENT_TAG_FIELD, AGENT_EVENT_TAG_VALUE);
}

// ── Mouse Operations ────────────────────────────────────────

/// Move the mouse cursor to a screen position without clicking.
/// Returns true on success, false if the event could not be created.
#[cfg(target_os = "macos")]
pub fn mouse_move(x: f64, y: f64) -> bool {
    let Some(source) = agent_source() else {
        return false;
    };
    let point = CGPoint::new(x, y);
    let Ok(event) =
        CGEvent::new_mouse_event(source, CGEventType::MouseMoved, point, CGMouseButton::Left)
    else {
        return false;
    };
    tag_event(&event);
    event.post(CGEventTapLocation::HID);
    true
}

/// Click at a screen position.
///
/// - `button`: "left" (default), "right", or "middle"
/// - `count`: number of clicks (1 = single, 2 = double, 3 = triple)
///
/// Each click is a down+up pair with the click state field set correctly
/// so the system recognizes multi-clicks (double-click, triple-click).
#[cfg(target_os = "macos")]
pub fn click(x: f64, y: f64, button: &str, count: u32) -> bool {
    let Some(source) = agent_source() else {
        return false;
    };
    let point = CGPoint::new(x, y);

    let cg_button = match button {
        "right" => CGMouseButton::Right,
        "middle" => CGMouseButton::Center,
        _ => CGMouseButton::Left,
    };

    let (down_type, up_type) = match button {
        "right" => (CGEventType::RightMouseDown, CGEventType::RightMouseUp),
        "middle" => (CGEventType::OtherMouseDown, CGEventType::OtherMouseUp),
        _ => (CGEventType::LeftMouseDown, CGEventType::LeftMouseUp),
    };

    let click_count = if count == 0 { 1 } else { count };

    for i in 0..click_count {
        let click_state = (i + 1) as i64;

        if let Ok(down) =
            CGEvent::new_mouse_event(source.clone(), down_type, point, cg_button)
        {
            tag_event(&down);
            down.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click_state);
            down.post(CGEventTapLocation::HID);
        } else {
            return false;
        }

        if let Ok(up) =
            CGEvent::new_mouse_event(source.clone(), up_type, point, cg_button)
        {
            tag_event(&up);
            up.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click_state);
            up.post(CGEventTapLocation::HID);
        } else {
            return false;
        }
    }
    true
}

/// Drag from one position to another.
/// Sends: mouse-down at (from_x, from_y), drag to (to_x, to_y), mouse-up.
#[cfg(target_os = "macos")]
pub fn drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> bool {
    let Some(source) = agent_source() else {
        return false;
    };
    let from_point = CGPoint::new(from_x, from_y);
    let to_point = CGPoint::new(to_x, to_y);

    // Mouse down at start position
    let Ok(down) = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::LeftMouseDown,
        from_point,
        CGMouseButton::Left,
    ) else {
        return false;
    };
    tag_event(&down);
    down.post(CGEventTapLocation::HID);

    // Drag to end position
    let Ok(drag_event) = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::LeftMouseDragged,
        to_point,
        CGMouseButton::Left,
    ) else {
        return false;
    };
    tag_event(&drag_event);
    drag_event.post(CGEventTapLocation::HID);

    // Mouse up at end position
    let Ok(up) = CGEvent::new_mouse_event(
        source,
        CGEventType::LeftMouseUp,
        to_point,
        CGMouseButton::Left,
    ) else {
        return false;
    };
    tag_event(&up);
    up.post(CGEventTapLocation::HID);
    true
}

/// Scroll at a position.
///
/// - `delta_y`: positive = scroll up, negative = scroll down (line units)
#[cfg(target_os = "macos")]
pub fn scroll(x: f64, y: f64, delta_y: i32) -> bool {
    // Move mouse to position first
    if !mouse_move(x, y) {
        return false;
    }

    let Some(source) = agent_source() else {
        return false;
    };
    let Ok(event) =
        CGEvent::new_scroll_event(source, ScrollEventUnit::LINE, 1, delta_y, 0, 0)
    else {
        return false;
    };
    tag_event(&event);
    event.post(CGEventTapLocation::HID);
    true
}

// ── Keyboard Operations ─────────────────────────────────────

/// Type text using CGEvent unicode string injection.
/// This is faster and more reliable than AppleScript keystroke for
/// arbitrary unicode text, including emoji and CJK characters.
#[cfg(target_os = "macos")]
pub fn type_text(text: &str) -> bool {
    let Some(source) = agent_source() else {
        return false;
    };

    // CGEventKeyboardSetUnicodeString has a practical limit of ~20 chars
    // per event on some macOS versions. Chunk the text to be safe.
    let chars: Vec<u16> = text.encode_utf16().collect();
    let chunk_size = 20;

    for chunk in chars.chunks(chunk_size) {
        // Create a key-down event with keycode 0 (placeholder)
        let Ok(event) = CGEvent::new_keyboard_event(source.clone(), 0, true) else {
            return false;
        };
        tag_event(&event);
        event.set_string_from_utf16_unchecked(chunk);
        event.post(CGEventTapLocation::HID);
    }
    true
}

/// Press a key combination (e.g., "cmd+c", "ctrl+shift+s", "return").
///
/// Modifier names: cmd/command, ctrl/control, alt/option, shift, fn
/// Key names: a-z, 0-9, return, tab, space, escape, delete, up/down/left/right, f1-f12
#[cfg(target_os = "macos")]
pub fn press_key(combo: &str) -> bool {
    let Some(source) = agent_source() else {
        return false;
    };

    let parts: Vec<&str> = combo.split('+').collect();
    if parts.is_empty() {
        return false;
    }

    let key_name = parts[parts.len() - 1];
    let modifier_names = &parts[..parts.len().saturating_sub(1)];

    let Some(keycode) = map_key_name(key_name) else {
        return false;
    };

    // Build modifier flags
    let mut flags = CGEventFlags::CGEventFlagNull;
    for modifier in modifier_names {
        match modifier.to_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" => {
                flags |= CGEventFlags::CGEventFlagCommand;
            }
            "ctrl" | "control" => {
                flags |= CGEventFlags::CGEventFlagControl;
            }
            "alt" | "option" | "opt" => {
                flags |= CGEventFlags::CGEventFlagAlternate;
            }
            "shift" => {
                flags |= CGEventFlags::CGEventFlagShift;
            }
            "fn" | "function" => {
                flags |= CGEventFlags::CGEventFlagSecondaryFn;
            }
            _ => {}
        }
    }

    // Key down
    if let Ok(down) = CGEvent::new_keyboard_event(source.clone(), keycode, true) {
        tag_event(&down);
        if flags != CGEventFlags::CGEventFlagNull {
            down.set_flags(flags);
        }
        down.post(CGEventTapLocation::HID);
    } else {
        return false;
    }

    // Key up
    if let Ok(up) = CGEvent::new_keyboard_event(source, keycode, false) {
        tag_event(&up);
        if flags != CGEventFlags::CGEventFlagNull {
            up.set_flags(flags);
        }
        up.post(CGEventTapLocation::HID);
    } else {
        return false;
    }

    true
}

// ── Screenshot ──────────────────────────────────────────────

/// Take a screenshot using the screencapture CLI.
/// This is kept as a CLI call because ScreenCaptureKit requires
/// an async Objective-C runtime that is impractical to bind from pure Rust.
/// The screencapture binary uses the same SCK backend internally.
pub fn take_screenshot(output_path: &str) -> bool {
    std::process::Command::new("screencapture")
        .args(["-x", "-C", output_path])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── Key Name Mapping ────────────────────────────────────────

/// Map a key name string to a macOS virtual keycode.
/// Uses the `KeyCode` constants from `core-graphics` for correctness.
#[cfg(target_os = "macos")]
fn map_key_name(name: &str) -> Option<u16> {
    let code = match name.to_lowercase().as_str() {
        // Letters
        "a" => KeyCode::ANSI_A,
        "b" => KeyCode::ANSI_B,
        "c" => KeyCode::ANSI_C,
        "d" => KeyCode::ANSI_D,
        "e" => KeyCode::ANSI_E,
        "f" => KeyCode::ANSI_F,
        "g" => KeyCode::ANSI_G,
        "h" => KeyCode::ANSI_H,
        "i" => KeyCode::ANSI_I,
        "j" => KeyCode::ANSI_J,
        "k" => KeyCode::ANSI_K,
        "l" => KeyCode::ANSI_L,
        "m" => KeyCode::ANSI_M,
        "n" => KeyCode::ANSI_N,
        "o" => KeyCode::ANSI_O,
        "p" => KeyCode::ANSI_P,
        "q" => KeyCode::ANSI_Q,
        "r" => KeyCode::ANSI_R,
        "s" => KeyCode::ANSI_S,
        "t" => KeyCode::ANSI_T,
        "u" => KeyCode::ANSI_U,
        "v" => KeyCode::ANSI_V,
        "w" => KeyCode::ANSI_W,
        "x" => KeyCode::ANSI_X,
        "y" => KeyCode::ANSI_Y,
        "z" => KeyCode::ANSI_Z,
        // Numbers
        "0" => KeyCode::ANSI_0,
        "1" => KeyCode::ANSI_1,
        "2" => KeyCode::ANSI_2,
        "3" => KeyCode::ANSI_3,
        "4" => KeyCode::ANSI_4,
        "5" => KeyCode::ANSI_5,
        "6" => KeyCode::ANSI_6,
        "7" => KeyCode::ANSI_7,
        "8" => KeyCode::ANSI_8,
        "9" => KeyCode::ANSI_9,
        // Special keys
        "return" | "enter" => KeyCode::RETURN,
        "tab" => KeyCode::TAB,
        "space" => KeyCode::SPACE,
        "delete" | "backspace" => KeyCode::DELETE,
        "forwarddelete" => KeyCode::FORWARD_DELETE,
        "escape" | "esc" => KeyCode::ESCAPE,
        "up" | "uparrow" => KeyCode::UP_ARROW,
        "down" | "downarrow" => KeyCode::DOWN_ARROW,
        "left" | "leftarrow" => KeyCode::LEFT_ARROW,
        "right" | "rightarrow" => KeyCode::RIGHT_ARROW,
        "home" => KeyCode::HOME,
        "end" => KeyCode::END,
        "pageup" => KeyCode::PAGE_UP,
        "pagedown" => KeyCode::PAGE_DOWN,
        // Function keys
        "f1" => KeyCode::F1,
        "f2" => KeyCode::F2,
        "f3" => KeyCode::F3,
        "f4" => KeyCode::F4,
        "f5" => KeyCode::F5,
        "f6" => KeyCode::F6,
        "f7" => KeyCode::F7,
        "f8" => KeyCode::F8,
        "f9" => KeyCode::F9,
        "f10" => KeyCode::F10,
        "f11" => KeyCode::F11,
        "f12" => KeyCode::F12,
        // Punctuation
        "minus" | "-" => KeyCode::ANSI_MINUS,
        "equal" | "=" => KeyCode::ANSI_EQUAL,
        "leftbracket" | "[" => KeyCode::ANSI_LEFT_BRACKET,
        "rightbracket" | "]" => KeyCode::ANSI_RIGHT_BRACKET,
        "backslash" | "\\" => KeyCode::ANSI_BACKSLASH,
        "semicolon" | ";" => KeyCode::ANSI_SEMICOLON,
        "quote" | "'" => KeyCode::ANSI_QUOTE,
        "comma" | "," => KeyCode::ANSI_COMMA,
        "period" | "." => KeyCode::ANSI_PERIOD,
        "slash" | "/" => KeyCode::ANSI_SLASH,
        "grave" | "`" => KeyCode::ANSI_GRAVE,
        _ => return None,
    };
    Some(code)
}

/// Take a screenshot of the frontmost window by querying its window ID.
///
/// Uses osascript to resolve the front window's ID, then `screencapture -l`
/// to capture just that window. Falls back to full-screen capture on failure.
pub fn take_window_screenshot(output_path: &str, _window_title: &str) -> bool {
    // Get the window ID of the frontmost window via AppleScript
    let window_id_script =
        r#"tell application "System Events" to get id of first window of (first process whose frontmost is true)"#;

    if let Ok(output) = std::process::Command::new("osascript")
        .args(["-e", window_id_script])
        .output()
    {
        let id_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(wid) = id_str.parse::<u32>() {
            return std::process::Command::new("screencapture")
                .args(["-x", "-l", &wid.to_string(), output_path])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
        }
    }

    // Fallback to full screen capture
    take_screenshot(output_path)
}

/// Take a region screenshot (fast crop without full screen capture).
///
/// Uses `screencapture -R x,y,w,h` to capture only the specified rectangle.
/// Coordinates are in screen points (not pixels).
pub fn take_region_screenshot(output_path: &str, x: i32, y: i32, w: i32, h: i32) -> bool {
    std::process::Command::new("screencapture")
        .args(["-x", "-R", &format!("{},{},{},{}", x, y, w, h), output_path])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── Non-macOS stubs ─────────────────────────────────────────
// Provide no-op stubs on non-macOS platforms so the crate compiles
// for cross-platform CI checks.

#[cfg(not(target_os = "macos"))]
pub fn mouse_move(_x: f64, _y: f64) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn click(_x: f64, _y: f64, _button: &str, _count: u32) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn drag(_from_x: f64, _from_y: f64, _to_x: f64, _to_y: f64) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn scroll(_x: f64, _y: f64, _delta_y: i32) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn type_text(_text: &str) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn press_key(_combo: &str) -> bool {
    false
}

// ── Tauri Commands ───────────��──────────────────────────────
// Thin wrappers that expose the native input functions to the frontend.

/// Native mouse click via Core Graphics (replaces cliclick subprocess).
#[tauri::command]
pub fn cu_click(x: f64, y: f64, button: String, count: u32) -> bool {
    click(x, y, &button, count)
}

/// Native text typing via Core Graphics unicode string injection.
#[tauri::command]
pub fn cu_type_text(text: String) -> bool {
    type_text(&text)
}

/// Native key press via Core Graphics (e.g., "cmd+c", "return").
#[tauri::command]
pub fn cu_press_key(combo: String) -> bool {
    press_key(&combo)
}

/// Native mouse move via Core Graphics.
#[tauri::command]
pub fn cu_mouse_move(x: f64, y: f64) -> bool {
    mouse_move(x, y)
}

/// Native drag operation via Core Graphics.
#[tauri::command]
pub fn cu_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> bool {
    drag(from_x, from_y, to_x, to_y)
}

/// Native scroll via Core Graphics.
#[tauri::command]
pub fn cu_scroll(x: f64, y: f64, delta_y: i32) -> bool {
    scroll(x, y, delta_y)
}

/// Screenshot via screencapture CLI.
#[tauri::command]
pub fn cu_screenshot(output_path: String) -> bool {
    take_screenshot(&output_path)
}

/// Screenshot of the frontmost window via screencapture -l.
#[tauri::command]
pub fn cu_window_screenshot(output_path: String, window_title: String) -> bool {
    take_window_screenshot(&output_path, &window_title)
}

/// Region screenshot via screencapture -R.
#[tauri::command]
pub fn cu_region_screenshot(output_path: String, x: i32, y: i32, w: i32, h: i32) -> bool {
    take_region_screenshot(&output_path, x, y, w, h)
}
