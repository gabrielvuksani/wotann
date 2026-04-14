// WOTANN Desktop — Global hotkey registration
//
// Global shortcuts are handled via the frontend JavaScript API
// (@tauri-apps/plugin-global-shortcut) rather than Rust-side registration,
// because the Rust tauri-plugin-global-shortcut causes tao panic_nounwind on macOS.
//
// Intended shortcuts:
// - Cmd+Shift+Space → Quick prompt overlay
// - Cmd+Shift+N → Toggle WOTANN window

use tauri::{AppHandle, Manager};

/// Set up global hotkeys. Currently a no-op on the Rust side —
/// hotkeys are registered via the frontend JS API.
pub fn setup_hotkeys(_app: &AppHandle) -> Result<(), String> {
    println!("Global hotkey system initialized");
    Ok(())
}

/// Toggle the main window visibility
pub fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
