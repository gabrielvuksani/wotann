// WOTANN Desktop — System tray with live cost display and quick actions

use crate::ipc_client;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

/// Set up the system tray with menu items.
/// Must be called AFTER the app window is ready (deferred from setup).
pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show WOTANN", true, None::<&str>)?;
    let new_chat_item = MenuItem::with_id(app, "new_chat", "New Chat", true, None::<&str>)?;
    let cost_label = format!("Today: {}", get_today_cost());
    let cost_item = MenuItem::with_id(app, "cost", &cost_label, false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit WOTANN", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show_item, &new_chat_item, &cost_item, &quit_item],
    )?;

    // Embed the 32x32 icon PNG at compile time
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("WOTANN — AI Agent Harness")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _: Result<(), _> = window.show();
                    let _: Result<(), _> = window.set_focus();
                }
            }
            "new_chat" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _: Result<(), _> = window.show();
                    let _: Result<(), _> = window.set_focus();
                    let _ = window.emit("tray-new-chat", ());
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    // Start periodic cost refresh
    start_cost_refresh_timer(app.clone());

    Ok(())
}

/// Fetch today's cost from KAIROS daemon, or return $0.00 if unavailable
fn get_today_cost() -> String {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("cost.current", serde_json::json!({})) {
            let cost = result
                .get("dailyCost")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            return format_cost(cost);
        }
    }
    "$0.00".to_string()
}

fn format_cost(cost: f64) -> String {
    if cost < 0.01 {
        format!("${:.4}", cost)
    } else {
        format!("${:.2}", cost)
    }
}

/// Start a background timer that refreshes the tray cost every 60 seconds.
/// Emits a "tray-cost-update" event so the frontend can display the current cost.
fn start_cost_refresh_timer(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let cost = get_today_cost();
            // Emit cost update to frontend for any in-app cost displays
            let _ = app_handle.emit("tray-cost-update", &cost);
        }
    });
}
