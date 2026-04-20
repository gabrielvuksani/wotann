// WOTANN Desktop — Tauri v2 Backend
// Manages: system tray, global hotkeys, Node.js sidecar, window state

mod audio_capture;
// `commands` is pub so that integration tests in src-tauri/tests/ can
// reach the security regression test exports in commands::test_exports.
// Individual command functions remain private to the module — the
// test_exports submodule is itself gated on #[cfg(test)] so production
// builds do not leak the security internals.
pub mod commands;
mod computer_use;
mod cursor_overlay;
mod hotkeys;
mod input;
mod ipc_client;
mod localsend;
mod remote_control;
mod sidecar;
mod state;
mod tray;

use state::AppState;
use tauri::Manager;

/// Install a panic handler that logs to ~/.wotann/crash.log
fn install_panic_handler() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let crash_log = format!("{}/.wotann/crash.log", home);

        // Ensure .wotann directory exists
        let _ = std::fs::create_dir_all(format!("{}/.wotann", home));

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let message = format!(
            "\n[epoch:{}] WOTANN CRASH\n{}\n---\n",
            timestamp,
            info,
        );

        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&crash_log)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(message.as_bytes())
            });

        // Call the default handler too
        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install panic handler FIRST — before anything else can crash
    install_panic_handler();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_status,
            commands::send_message,
            commands::get_providers,
            commands::switch_provider,
            commands::get_cost,
            commands::enhance_prompt,
            commands::start_engine,
            commands::stop_engine,
            commands::get_conversations,
            commands::search_memory,
            commands::get_agents,
            commands::spawn_agent,
            commands::kill_agent,
            // Previously missing — called by frontend but not registered
            commands::read_directory,
            commands::read_file,
            commands::write_file,
            commands::execute_command,
            commands::run_arena,
            commands::get_cost_details,
            commands::get_arbitrage_estimates,
            commands::get_plugins,
            commands::get_connectors,
            commands::get_cron_jobs,
            commands::get_workspaces,
            commands::get_approval_rules,
            // First-launch dependency management
            commands::check_dependencies,
            commands::install_node,
            commands::install_wotann_cli,
            commands::install_ollama,
            commands::pull_ollama_model,
            commands::list_ollama_models,
            commands::save_api_keys,
            // Computer Use (Desktop Control)
            commands::get_computer_use_state,
            commands::start_computer_use,
            commands::stop_computer_use,
            commands::capture_screenshot,
            commands::check_cu_permissions,
            commands::open_cu_permission_settings,
            commands::execute_mouse_action,
            commands::execute_keyboard_action,
            commands::approve_cu_app,
            commands::is_cu_app_approved,
            commands::is_cu_sentinel_app,
            commands::get_cu_action_result,
            // Remote Control (Companion sessions)
            commands::list_remote_sessions,
            commands::create_remote_session,
            commands::end_remote_session,
            commands::remote_session_count,
            commands::spawn_remote_worktree,
            // Connection & Streaming
            commands::send_message_streaming,
            commands::is_daemon_connected,
            commands::install_daemon_service,
            commands::get_companion_pairing,
            commands::get_companion_devices,
            commands::get_companion_sessions,
            commands::unpair_companion_device,
            commands::end_companion_session,
            // Settings Persistence
            commands::save_settings,
            commands::load_settings,
            commands::clear_memory,
            // Ollama Sidecar
            commands::start_ollama_sidecar,
            commands::detect_system_ram,
            // Window Management
            commands::toggle_window,
            // CLI Parity Commands
            commands::deep_research,
            commands::get_skills,
            commands::search_skills,
            commands::trigger_dream,
            commands::run_doctor,
            commands::get_context_info,
            commands::get_config,
            commands::set_config,
            commands::get_channels_status,
            commands::get_mcp_servers,
            commands::toggle_mcp_server,
            commands::add_mcp_server,
            commands::composer_apply,
            commands::connector_save_config,
            commands::connector_test_connection,
            commands::run_autonomous,
            commands::run_architect,
            commands::run_council,
            commands::get_voice_status,
            commands::get_audit_trail,
            commands::run_precommit,
            // Dispatch & Automation
            commands::get_dispatch_items,
            commands::create_cron_job,
            commands::get_local_ip,
            // Process management
            commands::kill_process,
            // Agent proof retrieval
            commands::get_agent_proof,
            // Git Integration
            commands::get_git_status,
            commands::get_git_diff,
            // LocalSend P2P File Sharing
            localsend::discover_localsend_devices,
            localsend::send_file_localsend,
            localsend::accept_localsend_transfer,
            localsend::get_localsend_transfers,
            localsend::stop_localsend_discovery,
            // Native Input (Core Graphics — replaces cliclick/python3 subprocesses)
            input::cu_click,
            input::cu_type_text,
            input::cu_press_key,
            input::cu_mouse_move,
            input::cu_drag,
            input::cu_scroll,
            input::cu_screenshot,
            input::cu_window_screenshot,
            input::cu_region_screenshot,
            // Meet Mode Audio Capture
            audio_capture::detect_meeting,
            audio_capture::start_meeting_recording,
            audio_capture::stop_meeting_recording,
            audio_capture::check_audio_capture,
            audio_capture::get_meeting_pid,
            // Agent Cursor Overlay
            cursor_overlay::show_agent_cursor,
            cursor_overlay::move_agent_cursor,
            cursor_overlay::hide_agent_cursor,
            cursor_overlay::destroy_agent_cursor,
            // C6 Stubs — frontend-parity placeholders for pending features
            commands::process_pdf,
            commands::get_lifetime_token_stats,
            commands::get_marketplace_manifest,
            commands::refresh_marketplace_catalog,
            commands::get_camoufox_status,
            // Subscription login + credential detection (Claude Max, ChatGPT Plus)
            commands::login_anthropic,
            commands::login_codex,
            commands::detect_existing_subscriptions,
            commands::import_codex_credential,
            // Engine lifecycle: restart picks up newly-saved env vars
            commands::restart_engine,
            // Generic file existence check with ~ expansion
            commands::file_exists,
            // Command palette wiring: project scan + init
            commands::scan_project_hotspots,
            commands::initialize_project,
            // Transport-audit fills: previously-missing Tauri commands
            commands::open_folder_dialog,
            commands::predict_cost,
            commands::proofs_list,
            commands::proofs_reverify,
        ])
        .setup(|app| {
            // Get the main window — graceful fallback if not yet available
            if let Some(_window) = app.get_webview_window("main") {
                // Apply native macOS vibrancy for translucent sidebar effect
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::apply_vibrancy;
                    use window_vibrancy::NSVisualEffectMaterial;
                    let _ = apply_vibrancy(&_window, NSVisualEffectMaterial::Sidebar, None, None);
                }
            } else {
                eprintln!("Warning: main window not available during setup — continuing without it");
            }

            // System tray — deferred async creation to avoid tao panic during didFinishLaunching
            let tray_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                if let Err(e) = tray::setup_tray(&tray_handle) {
                    eprintln!("System tray setup failed: {} — continuing without tray", e);
                }
            });

            // Set up global hotkeys
            if let Err(e) = hotkeys::setup_hotkeys(app.handle()) {
                eprintln!("Failed to setup hotkeys: {}", e);
            }

            // Start the KAIROS daemon ASYNC — don't block app launch
            // The app ALWAYS opens. Engine connection is optional.
            //
            // Watchdog is always armed (even when the initial wait times out)
            // so late socket creation is picked up automatically rather than
            // stranding the app in standalone mode forever.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<AppState>();
                let spawn_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    state.sidecar.spawn()
                }));
                match spawn_result {
                    Ok(Ok(())) => {
                        if state.sidecar.is_running() {
                            *state.engine_running.lock().unwrap_or_else(|e| e.into_inner()) = true;
                            println!("KAIROS daemon connected");
                        } else {
                            println!(
                                "KAIROS daemon not yet available — watchdog will keep trying"
                            );
                        }
                    }
                    Ok(Err(e)) => {
                        eprintln!("Daemon error: {} — watchdog will retry", e);
                    }
                    Err(_) => {
                        eprintln!("Daemon spawn panicked — watchdog will retry");
                    }
                }
                // Always arm the watchdog. It polls every 15s and:
                //   - flips engine_running=true the moment the socket appears
                //   - restarts the daemon if the socket disappears
                state.sidecar.start_watchdog();
            });

            // Set Ollama optimization environment variables for memory-constrained devices
            // q8_0 KV cache halves memory usage with negligible quality impact
            // Flash attention reduces memory with no quality downside
            std::env::set_var("OLLAMA_KV_CACHE_TYPE", "q8_0");
            std::env::set_var("OLLAMA_FLASH_ATTENTION", "1");

            println!("WOTANN Desktop started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WOTANN Desktop");
}
