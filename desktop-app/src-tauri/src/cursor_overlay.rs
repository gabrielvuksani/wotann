//! Agent cursor overlay — a transparent always-on-top window showing where
//! the agent is about to click.
//!
//! The overlay is a tiny Tauri webview window that:
//! - Is transparent and click-through (pointer-events: none in CSS)
//! - Stays always-on-top
//! - Is hidden from the taskbar/dock
//! - Moves to the agent's target position before each action
//! - Renders a small cursor indicator (defined in cursor-overlay.html)

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The window label used for the agent cursor overlay.
const OVERLAY_LABEL: &str = "agent-cursor";

/// Size of the cursor overlay window (pixels).
const OVERLAY_SIZE: f64 = 32.0;

/// Offset so the cursor tip aligns with the target coordinate.
/// The cursor image is centered in the window, so offset by half.
const CURSOR_OFFSET: f64 = OVERLAY_SIZE / 2.0;

/// Create the agent cursor overlay window.
///
/// The window starts hidden. Call `move_cursor` to show it at a position.
/// If the window already exists, this is a no-op.
pub fn create_overlay(app: &AppHandle) -> Result<(), String> {
    // If the window already exists, don't create a duplicate
    if app.get_webview_window(OVERLAY_LABEL).is_some() {
        return Ok(());
    }

    // Note: Window-level transparency on macOS requires Tauri's `macos-private-api` feature.
    // The cursor-overlay.html achieves visual transparency via CSS `background: transparent`
    // on the webview content, which works without the private API feature.
    let _window = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("cursor-overlay.html".into()),
    )
    .title("")
    .inner_size(OVERLAY_SIZE, OVERLAY_SIZE)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map_err(|e| format!("Failed to create cursor overlay window: {}", e))?;

    Ok(())
}

/// Move the agent cursor overlay to a screen position.
///
/// Shows the overlay if it is currently hidden.
/// The cursor tip is centered on (x, y) by applying the offset.
pub fn move_cursor(app: &AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "Agent cursor overlay not created. Call show_agent_cursor first.".to_string())?;

    let position = tauri::Position::Logical(tauri::LogicalPosition::new(
        x - CURSOR_OFFSET,
        y - CURSOR_OFFSET,
    ));

    window
        .set_position(position)
        .map_err(|e| format!("Failed to move cursor overlay: {}", e))?;

    // Show the window if it's not visible yet
    let is_visible = window.is_visible().unwrap_or(false);
    if !is_visible {
        window
            .show()
            .map_err(|e| format!("Failed to show cursor overlay: {}", e))?;
    }

    Ok(())
}

/// Hide the agent cursor overlay without destroying it.
pub fn hide_cursor(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window
            .hide()
            .map_err(|e| format!("Failed to hide cursor overlay: {}", e))?;
    }
    Ok(())
}

/// Destroy the agent cursor overlay window entirely.
/// Call this when Computer Use mode is deactivated.
pub fn destroy_overlay(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        window
            .destroy()
            .map_err(|e| format!("Failed to destroy cursor overlay: {}", e))?;
    }
    Ok(())
}

// ── Tauri Commands ─────────────���────────────────────────────

/// Create and show the agent cursor overlay window.
#[tauri::command]
pub fn show_agent_cursor(app: AppHandle) -> Result<(), String> {
    create_overlay(&app)
}

/// Move the agent cursor overlay to a screen position.
#[tauri::command]
pub fn move_agent_cursor(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    move_cursor(&app, x, y)
}

/// Hide the agent cursor overlay.
#[tauri::command]
pub fn hide_agent_cursor(app: AppHandle) -> Result<(), String> {
    hide_cursor(&app)
}

/// Destroy the agent cursor overlay entirely.
#[tauri::command]
pub fn destroy_agent_cursor(app: AppHandle) -> Result<(), String> {
    destroy_overlay(&app)
}
