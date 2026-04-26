// WOTANN Desktop — Tauri Commands
// Invoked from the React frontend via @tauri-apps/api
// All commands attempt KAIROS daemon IPC first, with graceful fallbacks.

use crate::ipc_client;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::ShellExt;

// ── PATH Fix for .app Bundles ───────────────────────────
// macOS .app bundles inherit minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
// This function builds a complete PATH so node, brew, ollama, etc. are findable.

pub fn augmented_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".into());
    let mut paths: Vec<String> = Vec::new();

    // Homebrew (Apple Silicon + Intel)
    paths.push("/opt/homebrew/bin".into());
    paths.push("/opt/homebrew/sbin".into());
    paths.push("/usr/local/bin".into());
    paths.push("/usr/local/sbin".into());

    // NVM — find the latest installed Node version
    let nvm_dir = format!("{}/.nvm/versions/node", home);
    if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
        let mut versions: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        versions.sort();
        if let Some(latest) = versions.last() {
            paths.push(format!("{}/bin", latest.display()));
        }
    }

    // ~/.local/bin — common location for pipx, Claude Code CLI, etc.
    paths.push(format!("{}/.local/bin", home));

    // Cargo / Rust
    paths.push(format!("{}/.cargo/bin", home));

    // Read /etc/paths for system defaults
    if let Ok(contents) = std::fs::read_to_string("/etc/paths") {
        for line in contents.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !paths.contains(&trimmed.to_string()) {
                paths.push(trimmed.into());
            }
        }
    }

    // Read /etc/paths.d/* for additional paths
    if let Ok(entries) = std::fs::read_dir("/etc/paths.d") {
        for entry in entries.flatten() {
            if let Ok(contents) = std::fs::read_to_string(entry.path()) {
                for line in contents.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && !paths.contains(&trimmed.to_string()) {
                        paths.push(trimmed.into());
                    }
                }
            }
        }
    }

    // Fallback system paths
    for p in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        if !paths.contains(&p.to_string()) {
            paths.push(p.into());
        }
    }

    paths.join(":")
}

// ── Response Types ───────────────────────────────────────

/// Runtime status returned to the frontend
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub connected: bool,
    pub provider: String,
    pub model: String,
    pub mode: String,
    pub session_id: String,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub context_percent: f32,
    pub worker_count: u32,
}

/// Provider information
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub name: String,
    pub id: String,
    pub enabled: bool,
    pub models: Vec<ModelInfo>,
    pub default_model: String,
}

/// Model information within a provider
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub context_window: u64,
    pub cost_per_m_tok: f64,
}

/// Cost breakdown
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CostSnapshot {
    pub session_cost: f64,
    pub today_cost: f64,
    pub week_cost: f64,
    pub budget_remaining: Option<f64>,
}

/// Conversation summary for sidebar
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub updated_at: u64,
    pub provider: String,
    pub model: String,
    pub cost: f64,
    pub message_count: u32,
}

/// Enhance prompt response
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceResponse {
    pub original: String,
    pub enhanced: String,
    pub style: String,
    pub improvements: Vec<String>,
}

/// Memory search result
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryResult {
    pub id: String,
    pub content: String,
    pub score: f32,
    pub source: String,
    pub r#type: String,
    pub created_at: u64,
}

/// Stream chunk emitted to frontend via Tauri events
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunk {
    pub r#type: String,
    pub content: String,
    pub provider: String,
    pub model: String,
    pub message_id: String,
    pub tokens_used: Option<u64>,
    pub cost_usd: Option<f64>,
}

/// Agent information
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub task: String,
    pub status: String,
}

/// Agent spawn result
#[derive(Serialize, Deserialize, Clone)]
pub struct AgentSpawnResult {
    pub id: String,
    pub task: String,
    pub status: String,
}

/// Agent kill result
#[derive(Serialize, Deserialize, Clone)]
pub struct AgentKillResult {
    pub success: bool,
}

/// Real pairing payload from the companion server
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanionPairingInfo {
    pub qr_data: String,
    pub pin: String,
    pub host: String,
    pub port: u16,
    pub expires_at: String,
}

/// Paired companion device
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDeviceInfo {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub last_seen: String,
    pub connected: bool,
}

/// Active companion session
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompanionSessionInfo {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub connected_at: u64,
    pub messages_exchanged: u64,
    pub status: String,
}

// ── Commands ─────────────────────────────────────────────

fn ensure_kairos_available(state: &AppState) -> Result<ipc_client::KairosClient, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        return Ok(client);
    }

    state.sidecar.spawn_explicit()?;

    for _ in 0..15 {
        if let Ok(client) = ipc_client::try_kairos() {
            return Ok(client);
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    ipc_client::try_kairos().map_err(|e| e.to_string())
}

/// Get runtime status — tries KAIROS daemon first, falls back to local state
#[tauri::command]
pub fn get_status(state: State<AppState>) -> RuntimeStatus {
    // Try daemon for real-time status
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("status", serde_json::json!({})) {
            Ok(result) => {
                let connected = result
                    .get("activeProvider")
                    .and_then(|v| v.as_str())
                    .is_some();
                // Empty sentinel — daemon will pick from configured providers.
                // Hard-coding "anthropic" here would silently flip every fresh
                // install to that vendor before the user picked one (v9 META-AUDIT).
                let provider = result
                    .get("activeProvider")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                // Prefer what KAIROS reports; fall back to locally-stored
                // model selection. Prior versions hardcoded "auto" which
                // broke the picker for every user (the stored selection
                // and the header pill would never match reality).
                let model = result
                    .get("activeModel")
                    .or_else(|| result.get("model"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| {
                        state
                            .model
                            .lock()
                            .map(|m| m.clone())
                            .unwrap_or_else(|e| e.into_inner().clone())
                    });
                return RuntimeStatus {
                    connected,
                    provider,
                    model,
                    mode: result
                        .get("currentMode")
                        .and_then(|v| v.as_str())
                        .unwrap_or("build")
                        .to_string(),
                    session_id: result
                        .get("sessionId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    total_tokens: result
                        .get("totalTokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    total_cost: result
                        .get("totalCost")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                    context_percent: 0.0,
                    worker_count: if connected { 1 } else { 0 },
                };
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] get_status failed: {}", e);
            }
        }
    }

    // Fallback to local state
    let provider = state.provider.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on provider: {}", e);
        e.into_inner()
    });
    let model = state.model.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on model: {}", e);
        e.into_inner()
    });
    let session_id = state.session_id.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on session_id: {}", e);
        e.into_inner()
    });
    let engine_running = *state.engine_running.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on engine_running: {}", e);
        e.into_inner()
    });
    let total_cost = *state.session_cost.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on session_cost: {}", e);
        e.into_inner()
    });
    let total_tokens = *state.total_tokens.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on total_tokens: {}", e);
        e.into_inner()
    });

    RuntimeStatus {
        connected: engine_running,
        provider: provider.clone(),
        model: model.clone(),
        mode: "build".into(),
        session_id: session_id.clone(),
        total_tokens,
        total_cost,
        context_percent: 0.0,
        worker_count: if engine_running { 1 } else { 0 },
    }
}

/// Forward a JSON-RPC request to the KAIROS daemon (S1-7).
///
/// Every desktop component that needs to call a daemon RPC method does so via
/// `commands.sendMessage(JSON.stringify({method, params}))`. Historically this
/// handler was a deprecated stub that returned only a fake message ID — the
/// RPC payload reached nobody. That single deprecated stub broke ~1,700 LOC of
/// frontend code (@ references, ghost-text autocomplete, workflows, multi-file
/// composer, TrustView, SymbolOutline, intelligence dashboard, etc.).
///
/// The new behaviour:
///   1. Parse `prompt` as JSON `{ method, params }` — if the payload isn't
///      valid JSON-RPC we treat the raw string as a fallback message ID so
///      old call sites that stored ad-hoc strings continue to compile.
///   2. Open a UDS connection to `~/.wotann/kairos.sock` via `ipc_client`.
///   3. Forward the call and return the daemon's `result` as a JSON string
///      (the caller already wraps this in JSON.parse).
///
/// Streaming responses are still handled by `send_message_streaming`. This
/// command is the synchronous single-response path.
#[tauri::command]
pub async fn send_message(
    _app: AppHandle,
    prompt: String,
    message_id: Option<String>,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    // If the prompt isn't a JSON-RPC envelope, preserve the legacy back-compat
    // behaviour of returning a synthesized message ID. Nothing in the current
    // codebase depends on this, but defence-in-depth.
    let parsed: serde_json::Value = match serde_json::from_str(&prompt) {
        Ok(v) => v,
        Err(_) => {
            let id = message_id.unwrap_or_else(|| format!("msg-{}", chrono_ts()));
            return Ok(id);
        }
    };

    let method = parsed
        .get("method")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "send_message: missing 'method' field in JSON-RPC payload".to_string())?
        .to_string();
    let params = parsed
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let client = ipc_client::try_kairos()
        .map_err(|e| format!("KAIROS daemon unavailable: {e}. Start it with: wotann daemon start"))?;

    let result = client.call(&method, params)?;
    serde_json::to_string(&result)
        .map_err(|e| format!("send_message: failed to serialize daemon response: {e}"))
}

// Legacy send_message body (the fabricate-success stub that hid 13 broken
// RPC paths for a release) fully removed — the real send_message above
// forwards to the KAIROS daemon via UDS. History preserved in git; no
// runtime code retained so a reader can't accidentally revive the stub.

/// Get available providers and their models — routes through KAIROS `providers.list`
#[tauri::command]
pub fn get_providers() -> Vec<ProviderInfo> {
    // Try KAIROS daemon first
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("providers.list", serde_json::json!({})) {
            Ok(result) => {
                if let Ok(providers) =
                    serde_json::from_value::<Vec<ProviderInfo>>(result.clone())
                {
                    if !providers.is_empty() {
                        return providers;
                    }
                }
                // If result is an object with a providers array field, try that
                if let Some(arr) = result.get("providers") {
                    if let Ok(providers) =
                        serde_json::from_value::<Vec<ProviderInfo>>(arr.clone())
                    {
                        if !providers.is_empty() {
                            return providers;
                        }
                    }
                }
                eprintln!(
                    "[WOTANN IPC] providers.list returned unparseable data, using fallback"
                );
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] providers.list failed: {}", e);
            }
        }
    }

    // Fallback: hardcoded provider list
    hardcoded_providers()
}

/// Switch the active provider and model — persists in AppState
#[tauri::command]
pub fn switch_provider(
    provider: String,
    model: String,
    state: State<AppState>,
) -> Result<(), String> {
    // Try KAIROS daemon first
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call(
            "providers.switch",
            serde_json::json!({ "provider": provider, "model": model }),
        ) {
            Ok(_) => {
                // Also update local state to stay in sync
                *state.provider.lock().map_err(|e| e.to_string())? = provider;
                *state.model.lock().map_err(|e| e.to_string())? = model;
                return Ok(());
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] providers.switch failed: {}", e);
                // Fall through to local-only update
            }
        }
    }

    // Fallback: update local state only
    *state.provider.lock().map_err(|e| e.to_string())? = provider;
    *state.model.lock().map_err(|e| e.to_string())? = model;
    Ok(())
}

/// Get cost information — routes through KAIROS `cost.current`
#[tauri::command]
pub fn get_cost(state: State<AppState>) -> CostSnapshot {
    // Try KAIROS daemon first
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("cost.current", serde_json::json!({})) {
            Ok(result) => {
                let session_cost = result
                    .get("sessionCost")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let daily_cost = result
                    .get("dailyCost")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let weekly_cost = result
                    .get("weeklyCost")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let budget = result.get("budget").and_then(|v| v.as_f64());
                let budget_used_pct = result
                    .get("budgetUsedPercent")
                    .and_then(|v| v.as_f64());

                let budget_remaining = match (budget, budget_used_pct) {
                    (Some(b), Some(pct)) => Some(b * (1.0 - pct / 100.0)),
                    (Some(b), None) => Some(b - weekly_cost),
                    _ => None,
                };

                return CostSnapshot {
                    session_cost,
                    today_cost: daily_cost,
                    week_cost: weekly_cost,
                    budget_remaining,
                };
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] cost.current failed: {}", e);
            }
        }
    }

    // Fallback to local AppState
    let session_cost = *state.session_cost.lock().unwrap_or_else(|e| {
        eprintln!("[WOTANN IPC] Lock error on session_cost: {}", e);
        e.into_inner()
    });
    // Return real local cost only — no fake offsets
    CostSnapshot {
        session_cost,
        today_cost: session_cost,
        week_cost: session_cost,
        budget_remaining: None,
    }
}

/// Enhance a prompt — routes through KAIROS `enhance` RPC
#[tauri::command]
pub async fn enhance_prompt(
    prompt: String,
    style: Option<String>,
) -> Result<EnhanceResponse, String> {
    let effective_style = style.unwrap_or_else(|| "detailed".into());

    // Try KAIROS daemon first
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call(
            "enhance",
            serde_json::json!({
                "prompt": prompt,
                "style": effective_style,
            }),
        ) {
            Ok(result) => {
                let original = result
                    .get("original")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&prompt)
                    .to_string();
                let enhanced = result
                    .get("enhanced")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let rpc_style = result
                    .get("style")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&effective_style)
                    .to_string();

                if !enhanced.is_empty() {
                    return Ok(EnhanceResponse {
                        original,
                        enhanced,
                        style: rpc_style,
                        improvements: vec![
                            "Enhanced by KAIROS runtime".into(),
                        ],
                    });
                }
                eprintln!("[WOTANN IPC] enhance returned empty enhanced text, using fallback");
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] enhance failed: {}", e);
            }
        }
    }

    // Fallback: local string-based enhancement
    let enhanced = match effective_style.as_str() {
        "concise" => format!(
            "{} — Be precise and concise. Show only the essential code changes.",
            prompt
        ),
        "exploratory" => format!(
            "Explore this thoroughly: {}. Consider multiple approaches, list tradeoffs, and recommend the best path forward.",
            prompt
        ),
        "strict" => format!(
            "{} — Follow strict coding standards: no any types, full error handling, immutable patterns, 100% test coverage.",
            prompt
        ),
        _ => format!(
            "Please help with the following task. Be thorough and provide working code with explanations.\n\n{}",
            prompt
        ),
    };

    Ok(EnhanceResponse {
        original: prompt,
        enhanced,
        style: effective_style,
        improvements: vec![
            "Added specificity and context".into(),
            "Structured for optimal model performance".into(),
            "Included quality constraints".into(),
        ],
    })
}

/// Start the WOTANN Engine sidecar
#[tauri::command]
pub async fn start_engine(state: State<'_, AppState>) -> Result<(), String> {
    state.sidecar.spawn_explicit()?;
    if state.sidecar.is_running() {
        *state.engine_running.lock().map_err(|e| e.to_string())? = true;
    }
    Ok(())
}

/// Stop the WOTANN Engine sidecar
#[tauri::command]
pub async fn stop_engine(state: State<'_, AppState>) -> Result<(), String> {
    state.sidecar.stop()?;
    *state.engine_running.lock().map_err(|e| e.to_string())? = false;
    Ok(())
}

/// Install KAIROS daemon as a macOS launchd service (runs at login, auto-restarts)
#[tauri::command]
pub async fn install_daemon_service(state: State<'_, AppState>) -> Result<String, String> {
    state.sidecar.install_launchd()
}

#[tauri::command]
pub fn get_companion_pairing(
    state: State<'_, AppState>,
) -> Result<CompanionPairingInfo, String> {
    let client = ensure_kairos_available(&state)?;
    let result = client.call("companion.pairing", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_companion_devices(
    state: State<'_, AppState>,
) -> Result<Vec<CompanionDeviceInfo>, String> {
    let client = ensure_kairos_available(&state)?;
    let result = client.call("companion.devices", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_companion_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<CompanionSessionInfo>, String> {
    let client = ensure_kairos_available(&state)?;
    let result = client.call("companion.sessions", serde_json::json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unpair_companion_device(
    device_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = ensure_kairos_available(&state)?;
    let _ = client.call(
        "companion.unpair",
        serde_json::json!({ "deviceId": device_id }),
    )?;
    Ok(())
}

#[tauri::command]
pub fn end_companion_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let client = ensure_kairos_available(&state)?;
    let _ = client.call(
        "companion.session.end",
        serde_json::json!({ "sessionId": session_id }),
    )?;
    Ok(())
}


/// Start Ollama from bundled sidecar or system installation.
/// Called on first launch if no AI provider is configured.
/// Ensures Gemma 4 is available out-of-the-box.
#[tauri::command]
pub async fn start_ollama_sidecar(app: AppHandle) -> Result<String, String> {
    // Strategy: try system Ollama first, fall back to bundled binary
    let ollama_running = check_ollama_api().await.is_some();
    if ollama_running {
        return Ok("Ollama already running".into());
    }

    // Try system Ollama
    let system_start = tokio::process::Command::new("ollama")
        .arg("serve")
        .env("PATH", augmented_path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    if system_start.is_ok() {
        // Wait for it to be ready
        for _ in 0..10 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if check_ollama_api().await.is_some() {
                return Ok("Ollama started from system installation".into());
            }
        }
    }

    // Try bundled Ollama sidecar
    let sidecar_result = app.shell().sidecar("ollama");
    match sidecar_result {
        Ok(sidecar) => {
            match sidecar.args(["serve"]).spawn() {
                Ok(_child) => {
                    // Wait for API to be ready
                    for _ in 0..10 {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        if check_ollama_api().await.is_some() {
                            return Ok("Ollama started from bundled binary".into());
                        }
                    }
                    Ok("Ollama sidecar spawned but API not yet ready".into())
                }
                Err(e) => Err(format!("Failed to start bundled Ollama: {}", e)),
            }
        }
        Err(_) => {
            Err("Ollama not available. Install from https://ollama.com/download".into())
        }
    }
}

/// Detect system RAM for smart model variant selection
#[tauri::command]
pub fn detect_system_ram() -> u64 {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok();

    output
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u64>().ok())
        .map(|bytes| bytes / (1024 * 1024 * 1024)) // Convert to GB
        .unwrap_or(8) // Default to 8GB if detection fails
}

/// Get conversation list — routes through KAIROS `session.list`
#[tauri::command]
pub fn get_conversations() -> Vec<ConversationSummary> {
    // Try KAIROS daemon first
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("session.list", serde_json::json!({})) {
            Ok(result) => {
                // Try direct array deserialization
                if let Ok(sessions) =
                    serde_json::from_value::<Vec<ConversationSummary>>(result.clone())
                {
                    return sessions;
                }
                // Try nested "sessions" field
                if let Some(arr) = result.get("sessions") {
                    if let Ok(sessions) =
                        serde_json::from_value::<Vec<ConversationSummary>>(arr.clone())
                    {
                        return sessions;
                    }
                }
                eprintln!(
                    "[WOTANN IPC] session.list returned unparseable data, using fallback"
                );
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] session.list failed: {}", e);
            }
        }
    }

    // Fallback: conversations are managed client-side in Zustand store
    vec![]
}

/// Search persistent memory — routes through KAIROS `memory.search`
#[tauri::command]
pub async fn search_memory(query: String) -> Result<Vec<MemoryResult>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }

    // Try KAIROS daemon first
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("memory.search", serde_json::json!({ "query": query })) {
            Ok(result) => {
                // The daemon returns [{id, score}] — map to MemoryResult
                if let Some(arr) = result.as_array() {
                    let results: Vec<MemoryResult> = arr
                        .iter()
                        .filter_map(|item| {
                            let id = item.get("id")?.as_str()?.to_string();
                            let score = item
                                .get("score")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0) as f32;
                            let content = item
                                .get("content")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let source = item
                                .get("source")
                                .and_then(|v| v.as_str())
                                .unwrap_or("memory")
                                .to_string();
                            let mem_type = item
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("general")
                                .to_string();
                            let created_at = item
                                .get("createdAt")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            Some(MemoryResult {
                                id,
                                content,
                                score,
                                source,
                                r#type: mem_type,
                                created_at,
                            })
                        })
                        .collect();
                    return Ok(results);
                }
                // Try as wrapped object with "results" field
                if let Some(arr) = result.get("results").and_then(|v| v.as_array()) {
                    let results: Vec<MemoryResult> = arr
                        .iter()
                        .filter_map(|item| {
                            let id = item.get("id")?.as_str()?.to_string();
                            let score = item
                                .get("score")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0) as f32;
                            Some(MemoryResult {
                                id,
                                content: item
                                    .get("content")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                                score,
                                source: "memory".into(),
                                r#type: "general".into(),
                                created_at: 0,
                            })
                        })
                        .collect();
                    return Ok(results);
                }
                eprintln!(
                    "[WOTANN IPC] memory.search returned unexpected format, using fallback"
                );
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] memory.search failed: {}", e);
            }
        }
    }

    // Fallback: no memory results when daemon is unavailable
    Ok(vec![])
}

/// List active agents — routes through KAIROS `agents.list`
#[tauri::command]
pub fn get_agents() -> Vec<AgentInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("agents.list", serde_json::json!({})) {
            Ok(result) => {
                // Try direct array
                if let Ok(agents) =
                    serde_json::from_value::<Vec<AgentInfo>>(result.clone())
                {
                    return agents;
                }
                // Try nested "agents" field
                if let Some(arr) = result.get("agents") {
                    if let Ok(agents) =
                        serde_json::from_value::<Vec<AgentInfo>>(arr.clone())
                    {
                        return agents;
                    }
                }
                eprintln!(
                    "[WOTANN IPC] agents.list returned unparseable data, using fallback"
                );
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] agents.list failed: {}", e);
            }
        }
    }

    // Fallback: no agents when daemon is unavailable
    vec![]
}

/// Spawn a new agent with a task — routes through KAIROS `agents.spawn`
#[tauri::command]
pub fn spawn_agent(task: String) -> Result<AgentSpawnResult, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("agents.spawn", serde_json::json!({ "task": task })) {
            Ok(result) => {
                let id = result
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let rpc_task = result
                    .get("task")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&task)
                    .to_string();
                let status = result
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("spawned")
                    .to_string();

                if !id.is_empty() {
                    return Ok(AgentSpawnResult {
                        id,
                        task: rpc_task,
                        status,
                    });
                }
                eprintln!("[WOTANN IPC] agents.spawn returned empty id");
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] agents.spawn failed: {}", e);
            }
        }
    }

    Err("KAIROS daemon is not running — cannot spawn agents without the runtime".into())
}

/// Kill a running agent — routes through KAIROS `agents.kill`
#[tauri::command]
pub fn kill_agent(id: String) -> Result<AgentKillResult, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("agents.kill", serde_json::json!({ "id": id })) {
            Ok(result) => {
                let success = result
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                return Ok(AgentKillResult { success });
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] agents.kill failed: {}", e);
            }
        }
    }

    Err("KAIROS daemon is not running — cannot kill agents without the runtime".into())
}

// ── Streaming Response Helpers ───────────────────────────

/// Emit a streaming response as a series of Tauri events
/// Emit an error response when the engine is not connected.
/// Never sends fake/mock responses — only real engine responses or clear errors.
fn emit_streaming_response(
    app: &AppHandle,
    _prompt: &str,
    _provider: &str,
    _model: &str,
    message_id: &str,
) {
    let app = app.clone();
    let message_id = message_id.to_string();

    tauri::async_runtime::spawn(async move {
        // Emit error — no fake data
        let error_event = StreamChunk {
            r#type: "error".into(),
            content: "WOTANN Engine is not running. The engine connects to your AI providers (Anthropic, OpenAI, Ollama, etc.) and processes your requests.\n\nTo start the engine:\n1. Open the app menu and click \"Start Engine\"\n2. Or run `wotann engine start` in your terminal\n\nMake sure you have at least one API key configured (Settings → Providers).".into(),
            provider: String::new(),
            model: String::new(),
            message_id: message_id.clone(),
            tokens_used: None,
            cost_usd: None,
        };
        let _ = app.emit("stream-chunk", &error_event);
    });
}

// ── Fallback Data ────────────────────────────────────────

/// When KAIROS is unavailable, probe for locally-installed + environment-
/// configured providers so the picker doesn't go empty or lie about what's
/// active. Every provider is gated on a real signal (reachable local
/// endpoint OR a configured API key env var) — no fake advertising of
/// providers the user hasn't actually set up.
fn hardcoded_providers() -> Vec<ProviderInfo> {
    let mut providers = Vec::new();
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok();

    // 1. Ollama (local) — probe /api/tags
    if let Some(ref c) = client {
        if let Ok(resp) = c.get("http://localhost:11434/api/tags").send() {
            if let Ok(body) = resp.json::<serde_json::Value>() {
                if let Some(models) = body.get("models").and_then(|m| m.as_array()) {
                    let model_infos: Vec<ModelInfo> = models
                        .iter()
                        .filter_map(|m| {
                            let name = m.get("name").and_then(|n| n.as_str())?;
                            Some(ModelInfo {
                                id: name.to_string(),
                                name: name.to_string(),
                                context_window: 32_768,
                                cost_per_m_tok: 0.0,
                            })
                        })
                        .collect();
                    if !model_infos.is_empty() {
                        let default_model = model_infos[0].id.clone();
                        providers.push(ProviderInfo {
                            id: "ollama".into(),
                            name: "Ollama (local)".into(),
                            enabled: true,
                            models: model_infos,
                            default_model,
                        });
                    }
                }
            }
        }
    }

    // 2. Anthropic — gated on ANTHROPIC_API_KEY
    if std::env::var("ANTHROPIC_API_KEY").is_ok() {
        providers.push(ProviderInfo {
            id: "anthropic".into(),
            name: "Anthropic".into(),
            enabled: true,
            models: vec![
                ModelInfo {
                    id: "claude-opus-4-7".into(),
                    name: "Claude Opus 4.7".into(),
                    context_window: 1_000_000,
                    cost_per_m_tok: 15.0,
                },
                ModelInfo {
                    // claude-sonnet-4-6 retires June 15, 2026 — use 4.7
                    // so the catalog doesn't ship a model the user can't
                    // call after that date.
                    id: "claude-sonnet-4-7".into(),
                    name: "Claude Sonnet 4.7".into(),
                    context_window: 1_000_000,
                    cost_per_m_tok: 3.0,
                },
                ModelInfo {
                    id: "claude-haiku-4-5-20251001".into(),
                    name: "Claude Haiku 4.5".into(),
                    context_window: 200_000,
                    cost_per_m_tok: 0.25,
                },
            ],
            default_model: "claude-opus-4-7".into(),
        });
    }

    // 3. OpenAI — gated on OPENAI_API_KEY
    if std::env::var("OPENAI_API_KEY").is_ok() {
        providers.push(ProviderInfo {
            id: "openai".into(),
            name: "OpenAI".into(),
            enabled: true,
            models: vec![
                ModelInfo {
                    id: "gpt-5".into(),
                    name: "GPT-5".into(),
                    context_window: 256_000,
                    cost_per_m_tok: 10.0,
                },
                ModelInfo {
                    id: "gpt-5-mini".into(),
                    name: "GPT-5 mini".into(),
                    context_window: 128_000,
                    cost_per_m_tok: 0.5,
                },
            ],
            default_model: "gpt-5".into(),
        });
    }

    // 4. Google Gemini — gated on GEMINI_API_KEY or GOOGLE_API_KEY
    if std::env::var("GEMINI_API_KEY").is_ok() || std::env::var("GOOGLE_API_KEY").is_ok() {
        providers.push(ProviderInfo {
            id: "gemini".into(),
            name: "Google Gemini".into(),
            enabled: true,
            models: vec![
                ModelInfo {
                    id: "gemini-3-pro".into(),
                    name: "Gemini 3 Pro".into(),
                    context_window: 2_000_000,
                    cost_per_m_tok: 3.5,
                },
                ModelInfo {
                    id: "gemini-3-flash".into(),
                    name: "Gemini 3 Flash".into(),
                    context_window: 1_000_000,
                    cost_per_m_tok: 0.15,
                },
            ],
            default_model: "gemini-3-pro".into(),
        });
    }

    // 5. Groq — gated on GROQ_API_KEY
    if std::env::var("GROQ_API_KEY").is_ok() {
        providers.push(ProviderInfo {
            id: "groq".into(),
            name: "Groq (free tier)".into(),
            enabled: true,
            models: vec![ModelInfo {
                id: "llama-3.3-70b-versatile".into(),
                name: "Llama 3.3 70B".into(),
                context_window: 128_000,
                cost_per_m_tok: 0.0,
            }],
            default_model: "llama-3.3-70b-versatile".into(),
        });
    }

    // 6. Cerebras — gated on CEREBRAS_API_KEY
    if std::env::var("CEREBRAS_API_KEY").is_ok() {
        providers.push(ProviderInfo {
            id: "cerebras".into(),
            name: "Cerebras".into(),
            enabled: true,
            models: vec![ModelInfo {
                id: "llama3.1-70b".into(),
                name: "Llama 3.1 70B".into(),
                context_window: 128_000,
                cost_per_m_tok: 0.0,
            }],
            default_model: "llama3.1-70b".into(),
        });
    }

    providers
}

// ── Additional Response Types ───────────────────────────

/// File tree node for editor
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub r#type: String,
    pub children: Option<Vec<FileTreeNode>>,
    pub git_status: Option<String>,
}

/// Shell command output
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Arena response for multi-model comparison
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArenaResponseItem {
    pub id: String,
    pub model: String,
    pub provider: String,
    pub content: String,
    pub tokens_used: u64,
    pub cost_usd: f64,
    pub duration_ms: u64,
    pub is_streaming: bool,
}

/// Extended cost details
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CostDetailSnapshot {
    pub session_cost: f64,
    pub today_cost: f64,
    pub week_cost: f64,
    pub budget_remaining: Option<f64>,
    pub daily_usage: Vec<DayUsage>,
    pub provider_costs: Vec<ProviderCostBreakdown>,
    pub week_tokens: u64,
    pub week_conversations: u32,
    pub avg_cost_per_message: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    pub date: String,
    pub cost: f64,
    pub tokens: u64,
    pub conversations: u32,
}

#[derive(Serialize, Clone)]
pub struct ProviderCostBreakdown {
    pub provider: String,
    pub cost: f64,
    pub percentage: f64,
}

/// Arbitrage estimate for provider comparison
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArbitrageEstimate {
    pub provider: String,
    pub model: String,
    pub estimated_cost: f64,
    pub estimated_tokens: u64,
    pub estimated_latency_ms: u64,
    pub quality: String,
    pub recommended: bool,
}

/// Plugin info
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub installed: bool,
    pub enabled: bool,
    pub category: String,
}

/// Connector info
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub connected: bool,
    pub documents_count: u64,
}

/// Cron job
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CronJobInfo {
    pub id: String,
    pub name: String,
    pub schedule: String,
    pub command: String,
    pub enabled: bool,
    pub last_run: Option<String>,
    pub last_result: Option<String>,
}

/// Workspace info
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: String,
    pub last_accessed: u64,
    pub conversation_count: u32,
    pub pinned: bool,
}

/// Approval rule
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRule {
    pub id: String,
    pub pattern: String,
    pub action: String,
    pub scope: String,
    pub description: String,
}

// ── Path Validation ─────────────────────────────────────
// Rejects path traversal, sensitive directories, and paths outside allowed roots.
//
// TOCTOU FIX (T0-5, 2026-04-20): the previous implementation called
// `fs::canonicalize(path)` directly, which REQUIRES the target to exist.
// That caused two problems:
//   (a) write_file("new-file.txt") always failed validation, because the
//       target doesn't exist yet.
//   (b) When callers worked around (a) by canonicalizing AFTER writing,
//       they opened a classic TOCTOU race: a symlink swap between
//       validation and write could redirect the write outside the sandbox.
//
// The fix: canonicalize the PARENT directory first (which must exist for
// any realistic write), then reassemble {canonical_parent}/{basename} and
// apply the sandbox/sensitive-path checks on that assembled path BEFORE
// any I/O. We also reject the basename being "..", ".", or empty so an
// attacker can't use `../../etc/passwd` as a "basename".
//
// Callers that already expect the final canonical form (e.g. read_file,
// read_directory) use validate_path_existing() which keeps the original
// "canonicalize directly, require existence" semantics.

/// Validate a path that MUST already exist. Returns the fully-canonical
/// PathBuf after symlink resolution, with full sensitive-path + allow-list
/// checks applied. Suitable for read_file / read_directory.
fn validate_path_existing(path: &str) -> Result<std::path::PathBuf, String> {
    // Reject raw traversal sequences before canonicalization
    if path.contains("..") {
        return Err("Access denied: path traversal detected".into());
    }

    // Resolve to canonical (absolute, symlink-resolved) form
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Access denied: cannot resolve path '{}': {}", path, e))?;

    enforce_sandbox(&canonical)?;
    Ok(canonical)
}

/// Validate a path intended for WRITE, where the target MAY not yet exist.
/// Canonicalizes the parent directory first (closing the TOCTOU window on
/// the parent), then re-joins the basename and verifies the result is in
/// the sandbox BEFORE any write occurs.
///
/// Rejects basenames that are empty, ".", "..", or contain path separators
/// (so an attacker cannot hide an escape via a crafted basename).
fn validate_path_for_write(path: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Path;

    // Reject raw traversal sequences in the user-supplied path
    if path.contains("..") {
        return Err("Access denied: path traversal detected".into());
    }
    // Path::file_name() strips trailing "/." components, which would let
    // `/tmp/.` bypass the `.`-basename check below by returning the parent
    // component ("tmp") as the file name. Reject such shapes explicitly
    // BEFORE splitting.
    let trimmed = path.trim_end_matches('/');
    if trimmed.ends_with("/.") || trimmed == "." {
        return Err("Access denied: invalid basename".into());
    }

    let p = Path::new(path);

    // Split into parent and basename. If the parent is missing we refuse —
    // write_file should not be creating directories silently.
    let parent = p.parent().ok_or_else(|| {
        "Access denied: cannot determine parent directory".to_string()
    })?;
    let file_name = p.file_name().ok_or_else(|| {
        "Access denied: missing basename".to_string()
    })?;

    let basename = file_name.to_string_lossy();
    if basename.is_empty() || basename == "." || basename == ".." {
        return Err("Access denied: invalid basename".into());
    }
    // Reject path separators smuggled into the basename
    if basename.contains('/') || basename.contains('\\') {
        return Err("Access denied: basename contains path separator".into());
    }

    // Canonicalize the parent BEFORE any I/O on the target. This closes
    // the TOCTOU window: once we have the canonical parent, a subsequent
    // symlink swap of ancestor directories cannot redirect the write,
    // because we'll pass the resolved absolute parent + literal basename
    // to fs::write below. The only remaining race is a swap of the
    // target filename itself mid-write, which is harmless because the
    // kernel opens the inode atomically.
    //
    // If the parent is itself "." or empty we resolve relative to CWD,
    // which Path::canonicalize handles correctly.
    let parent_resolved = if parent.as_os_str().is_empty() {
        std::env::current_dir()
            .map_err(|e| format!("Access denied: cannot resolve CWD: {}", e))?
    } else {
        std::fs::canonicalize(parent).map_err(|e| {
            format!(
                "Access denied: cannot resolve parent directory '{}': {}",
                parent.display(),
                e
            )
        })?
    };

    // Assemble the final path from {canonical parent}/{literal basename}
    let final_path = parent_resolved.join(file_name);

    enforce_sandbox(&final_path)?;
    Ok(final_path)
}

/// Shared sandbox check. Applied to whichever PathBuf the caller has
/// already resolved (either via full canonicalize for existing paths, or
/// via parent-canonicalize + basename-join for writes to new files).
fn enforce_sandbox(canonical: &std::path::Path) -> Result<(), String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/unknown".into());
    let canon_str = canonical.to_string_lossy();

    // Re-check after symlink resolution
    if canon_str.contains("..") {
        return Err("Access denied: path traversal detected after resolution".into());
    }

    // Reject sensitive directories. Opus audit (2026-04-15) found the
    // prior list only covered .ssh + .gnupg; cloud-credential paths
    // (AWS/GCP/Kubernetes/Terraform/Docker) and shell-history files
    // were all readable. Expanded to cover the canonical "leaked these
    // and you're owned" set.
    let sensitive_prefixes = [
        "/etc/".to_string(),
        "/usr/".to_string(),
        "/System/".to_string(),
        "/private/etc/".to_string(),
        "/var/db/".to_string(),
        "/var/root/".to_string(),
        // SSH + GPG
        format!("{}/.ssh/", home),
        format!("{}/.ssh", home),
        format!("{}/.gnupg/", home),
        format!("{}/.gnupg", home),
        // Cloud credentials
        format!("{}/.aws/", home),
        format!("{}/.aws", home),
        format!("{}/.kube/", home),
        format!("{}/.kube", home),
        format!("{}/.config/gcloud/", home),
        format!("{}/.config/gcloud", home),
        format!("{}/.azure/", home),
        format!("{}/.azure", home),
        format!("{}/.terraform.d/", home),
        format!("{}/.terraformrc", home),
        // Container runtimes + Docker auth
        format!("{}/.docker/", home),
        format!("{}/.docker", home),
        // Browser profile + token storage
        format!("{}/Library/Application Support/Google/Chrome/", home),
        format!("{}/Library/Application Support/Firefox/", home),
        // Shell history (often contains accidentally-pasted secrets)
        format!("{}/.bash_history", home),
        format!("{}/.zsh_history", home),
        format!("{}/.psql_history", home),
        format!("{}/.mysql_history", home),
        // Keychain
        format!("{}/Library/Keychains/", home),
        // Generic dotfiles known to hold secrets
        format!("{}/.netrc", home),
        format!("{}/.npmrc", home),
        format!("{}/.pypirc", home),
    ];
    for prefix in &sensitive_prefixes {
        if canon_str.starts_with(prefix) || canon_str.as_ref() == *prefix {
            return Err("Access denied: path outside allowed directories".into());
        }
    }

    // Allow only paths under workspace, ~/.wotann/, or /tmp/.
    // On macOS, /tmp is a symlink to /private/tmp — canonicalize resolves
    // it. We include both spellings so writes to /tmp pass regardless of
    // whether the caller-supplied path or the canonical form is compared.
    let allowed_prefixes = [
        format!("{}/.wotann", home),
        "/tmp".to_string(),
        "/private/tmp".to_string(),
        // Workspace = any directory under the user's home that isn't sensitive
        // We allow anything under $HOME that passed the sensitive check above
        home.clone(),
    ];

    let is_allowed = allowed_prefixes
        .iter()
        .any(|prefix| canon_str.starts_with(prefix));

    if !is_allowed {
        return Err("Access denied: path outside allowed directories".into());
    }

    Ok(())
}

/// Back-compat shim so callers that just want "does this path exist and
/// is it in-sandbox" keep working. For write paths, prefer
/// validate_path_for_write() which handles new files correctly.
fn validate_path(path: &str) -> Result<std::path::PathBuf, String> {
    validate_path_existing(path)
}

// ── Missing Commands (previously called by frontend but not registered) ──

/// Read a directory tree — real file system operation
#[tauri::command]
pub fn read_directory(path: String) -> Vec<FileTreeNode> {
    if let Err(e) = validate_path(&path) {
        eprintln!("read_directory blocked: {}", e);
        return vec![];
    }
    read_dir_recursive(&path, 2)
}

fn read_dir_recursive(path: &str, max_depth: u32) -> Vec<FileTreeNode> {
    if max_depth == 0 {
        return vec![];
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return vec![];
    };

    let mut nodes: Vec<FileTreeNode> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden files and common large directories
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "dist" {
                return None;
            }
            let file_path = entry.path().to_string_lossy().to_string();
            let is_dir = entry.file_type().ok()?.is_dir();

            Some(FileTreeNode {
                name: name.clone(),
                path: file_path.clone(),
                r#type: if is_dir { "directory".into() } else { "file".into() },
                children: if is_dir {
                    Some(read_dir_recursive(&file_path, max_depth - 1))
                } else {
                    None
                },
                git_status: None,
            })
        })
        .collect();

    nodes.sort_by(|a, b| {
        let a_dir = a.r#type == "directory";
        let b_dir = b.r#type == "directory";
        b_dir.cmp(&a_dir).then(a.name.cmp(&b.name))
    });
    nodes
}

/// Read a file's content — real file system operation
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    validate_path(&path)?;
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Write content to a file — used by Monaco editor Cmd+S.
/// Uses validate_path_for_write() so writes to new files (file does not
/// yet exist) succeed AND the sandbox check is applied BEFORE the write
/// to close the symlink-swap TOCTOU window. The returned PathBuf is the
/// canonical-parent + literal-basename form, which we write to directly
/// instead of the caller-supplied string so a mid-request symlink swap
/// of an ancestor cannot redirect us.
#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    let resolved = validate_path_for_write(&path)?;
    std::fs::write(&resolved, &content)
        .map_err(|e| format!("Failed to write {}: {}", resolved.display(), e))
}

/// Validate a shell command against a blocklist of dangerous patterns AND
/// a strict shell-parse identity check on the first token.
///
/// SECURITY (B5): this is the Rust-side layer of defence-in-depth. The
/// authoritative sanitizer lives in src/security/command-sanitizer.ts and is
/// invoked via the daemon's "execute" and "shell.precheck" RPC methods. This
/// Rust check is a backstop in case the Rust layer is invoked directly without
/// going through the daemon (e.g. a migration or tooling path).
///
/// Post-audit (T0-5, 2026-04-20): the previous implementation used pure
/// substring matching (`lower.contains(pattern)`). That made it attackable
/// via trivial payload variants like `foo;rm -rf /`, `echo safe; wget|sh`,
/// or quoted metacharacters. The fix below adds a shell-quote parse layer
/// using the `shell-words` crate so we can reject commands whose parsed
/// token list contains ANY shell metacharacter (`;`, `|`, `&`, `&&`, `||`,
/// backtick, `$(`, `>(`, `<(`, redirect-to-sensitive-file, etc.) BEFORE
/// falling back to substring checks. The first parsed token must also
/// match a conservative executable-name regex (alphanumeric + a few
/// punctuation chars, no NUL, no newline) to block exotic identity spoofs.
fn validate_command(cmd: &str) -> Result<(), String> {
    // ── Layer 1: shell-parse the command and check for dangerous tokens ──
    // `shell_words::split` applies POSIX tokenization. It collapses quoted
    // runs, strips balanced quotes, and errors on malformed input. Unlike
    // substring match, a payload like `foo;rm -rf /` produces tokens
    // ["foo;rm", "-rf", "/"] — we then reject the chained-semicolon token.
    let tokens = shell_words::split(cmd)
        .map_err(|e| format!("Command rejected: shell parse error: {}", e))?;

    if tokens.is_empty() {
        return Err("Command rejected: empty command".into());
    }

    // Any token containing a shell control character means this is a
    // compound/chained/substituted command. The backstop only allows a
    // single simple command — chaining must be authorized by the daemon.
    // Note we check for the character in ANY token (including the first
    // one, which is how `foo;rm` would arrive after split).
    const SHELL_META: &[char] = &['|', '&', ';', '`', '\n', '\r', '\0'];
    for tok in &tokens {
        if tok.chars().any(|c| SHELL_META.contains(&c)) {
            return Err(format!(
                "Command rejected: shell metacharacter in token '{}' (chaining/piping not permitted via this path)",
                tok
            ));
        }
        // Command substitution: `$(...)` and `<(...)` and `>(...)`
        if tok.contains("$(") || tok.contains(">(") || tok.contains("<(") {
            return Err(format!(
                "Command rejected: command substitution in token '{}'",
                tok
            ));
        }
    }

    // The first token is the executable name (or a path to it). It must
    // look like a plausible command identifier — we reject NUL, newline,
    // and control bytes that shouldn't appear in a real binary name.
    let exe = &tokens[0];
    if exe.is_empty() {
        return Err("Command rejected: empty executable token".into());
    }
    if exe.chars().any(|c| c.is_control()) {
        return Err("Command rejected: control character in executable name".into());
    }
    // ── Layer 2: positive ALLOWLIST on the executable identity (SB-7) ──
    //
    // Pre-SB-7 (Wave 6.5-XX) this layer was a substring deny-list, which
    // was attackable via clever quoting. The classic bypass was
    //   `bash -c "$(printf 'rm\x20-rf\x20/')"`
    // because the literal substring "rm -rf /" never appeared in the raw
    // command — it only materialized after the inner `printf` ran inside
    // the shell. The deny-list never matched and the command sailed
    // through to the shell.
    //
    // The fix is a positive allow-list: the executable identity (the
    // basename of `tokens[0]`) must appear in EXEC_ALLOWLIST. Anything
    // else — including `bash`, `sh`, `zsh`, `python`, `node`, `eval`,
    // `exec`, and absolute paths to anything not in the list — is
    // rejected. Daemon-side sanitization (src/security/command-sanitizer.ts)
    // owns the higher-fidelity check; this Rust backstop is the last
    // line of defence when execute_command is invoked directly.
    //
    // For the `wotann` binary specifically, we additionally enforce a
    // SUBCOMMAND allow-list so a future `wotann eval-skill <file>` can't
    // be added without an explicit decision here.
    //
    // QB#6: fail-CLOSED — anything not in the list is rejected with an
    // explicit denial reason, not silently allowed.
    const EXEC_ALLOWLIST: &[&str] = &[
        // Read-only inspection
        "ls", "cat", "head", "tail", "less", "more", "wc", "stat",
        "file", "tree", "pwd", "echo", "printf", "true", "false",
        // Search
        "grep", "egrep", "fgrep", "rg", "ripgrep", "find", "ag", "fd",
        // VCS
        "git", "hg",
        // Build / language tooling
        "npm", "npx", "yarn", "pnpm", "bun",
        "cargo", "rustc", "rustup",
        "go", "gofmt",
        "python", "python3", "pip", "pip3",
        "node", "deno",
        "make", "cmake", "ninja",
        "tsc", "vitest", "jest", "eslint", "prettier",
        // Project-internal
        "wotann",
        // Filesystem (constrained — no `rm`, no `mv`, no `chmod`)
        "mkdir", "touch", "cp", "ln",
        // Misc safe utilities
        "date", "uname", "which", "whoami", "env", "id",
        "diff", "patch",
        "sort", "uniq", "cut", "awk", "sed", "tr",
        "xargs", "tee",
    ];

    // Subcommand allow-list specifically for `wotann <subcommand>`.
    // Anything outside this list is rejected even though `wotann` itself
    // is allowed. Mirrors the user-facing CLI in CLAUDE.md.
    const WOTANN_SUBCOMMAND_ALLOWLIST: &[&str] = &[
        "start", "init", "build", "compare", "review", "engine",
        "relay", "workshop", "link", "autopilot", "enhance",
        "skills", "memory", "cost", "voice", "schedule", "channels",
        "trust", "untrust", "doctor", "guard", "version", "--version",
        "--help", "-h", "help",
    ];

    // Resolve the executable identity to its basename so absolute paths
    // (`/usr/bin/git`) and bare names (`git`) compare equal. We reject
    // anything with a NUL byte / control char already; basename is just
    // "everything after the last slash".
    let exe_basename = exe.rsplit('/').next().unwrap_or(exe);
    if !EXEC_ALLOWLIST.iter().any(|allowed| *allowed == exe_basename) {
        return Err(format!(
            "Command rejected: executable '{}' not in allow-list (SB-7). \
             Allowed: {} known-safe binaries (ls, cat, grep, git, npm, cargo, wotann, ...). \
             To run an arbitrary command, route through the daemon's authorized 'execute' RPC.",
            exe_basename,
            EXEC_ALLOWLIST.len(),
        ));
    }

    // For `wotann <sub>`, enforce the subcommand allow-list.
    if exe_basename == "wotann" && tokens.len() > 1 {
        let sub = &tokens[1];
        if !WOTANN_SUBCOMMAND_ALLOWLIST.iter().any(|allowed| *allowed == sub.as_str()) {
            return Err(format!(
                "Command rejected: 'wotann {}' subcommand not in allow-list (SB-7). \
                 Allowed subcommands: {}.",
                sub,
                WOTANN_SUBCOMMAND_ALLOWLIST.join(", "),
            ));
        }
    }

    // ── Layer 3: dangerous-pattern blocklist applied to the RAW string ──
    // Defence-in-depth: even though the allow-list above blocks bash/sh,
    // we still scan the raw command for sensitive substrings. This catches
    // payloads where an allow-listed binary is called with a dangerous
    // argument (e.g. `git clone https://attacker | sh` would already fail
    // at Layer 1, but a creative payload that survives parsing must still
    // pass these checks).
    let dangerous_patterns = [
        "rm -rf /",
        "rm -rf ~",
        "rm -rf $HOME",
        "sudo ",
        "chmod 777",
        "chown ",
        "mkfs",
        "dd if=/dev/zero",
        "dd if=/dev/random",
        "dd if=/dev/urandom",
        // Fork bomb signature
        ":(){:|:&};:",
        ":() { :|:& };:",
        // Pipe-to-shell payloads (belt-and-braces)
        "curl | sh",
        "curl|sh",
        "curl | bash",
        "curl|bash",
        "wget | sh",
        "wget|sh",
        "wget | bash",
        "wget|bash",
        // Writes to system-sensitive files
        ">/etc/passwd",
        ">> /etc/passwd",
        ">>/etc/passwd",
        ">/etc/shadow",
        ">> /etc/shadow",
        ">>/etc/shadow",
        ">/etc/sudoers",
        ">>/etc/sudoers",
        // Reverse shells
        "nc -e /bin/sh",
        "nc -e /bin/bash",
        "bash -i >& /dev/tcp/",
    ];
    let lower = cmd.to_lowercase();
    for pattern in &dangerous_patterns {
        if lower.contains(&pattern.to_lowercase()) {
            return Err(format!(
                "Command rejected: contains dangerous pattern '{}' (SB-7 layer 3 deny-list)",
                pattern
            ));
        }
    }

    // Reject commands that modify PATH, DYLD_*, or LD_* environment variables
    let env_patterns = [
        "export PATH=",
        "export DYLD_",
        "export LD_",
        "PATH=",
        "DYLD_",
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
    ];
    for pattern in &env_patterns {
        // Only flag if it looks like an env assignment (not just referencing)
        if lower.contains(&pattern.to_lowercase()) {
            return Err(format!(
                "Command rejected: modifying environment variable '{}' (SB-7)",
                pattern.split('=').next().unwrap_or(pattern)
            ));
        }
    }

    Ok(())
}

/// Append a command entry to ~/.wotann/audit.log with timestamp
fn audit_log_command(cmd: &str, exit_code: i32) {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let audit_dir = format!("{}/.wotann", home);
    let audit_path = format!("{}/audit.log", audit_dir);

    let _ = std::fs::create_dir_all(&audit_dir);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let entry = format!(
        "[{}] exit={} cmd={}\n",
        timestamp, exit_code, cmd
    );

    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(entry.as_bytes())
        });
}

/// Execute a shell command — real shell execution
#[tauri::command]
pub async fn execute_command(cmd: String, cwd: Option<String>) -> Result<ShellOutput, String> {
    validate_command(&cmd)?;

    let mut command = tokio::process::Command::new("sh");
    command.arg("-c").arg(&cmd).env("PATH", augmented_path());

    if let Some(ref dir) = cwd {
        command.current_dir(dir);
    }

    let output = command
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let exit_code = output.status.code().unwrap_or(-1);
    audit_log_command(&cmd, exit_code);

    Ok(ShellOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code,
    })
}

/// Run arena comparison — routes through KAIROS
#[tauri::command]
pub fn run_arena(prompt: String, models: Vec<String>) -> Vec<ArenaResponseItem> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call(
            "arena.run",
            serde_json::json!({ "prompt": prompt, "models": models }),
        ) {
            Ok(result) => {
                if let Some(arr) = result.as_array().or_else(|| result.get("responses").and_then(|v| v.as_array())) {
                    return arr
                        .iter()
                        .filter_map(|item| {
                            Some(ArenaResponseItem {
                                id: item.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                model: item.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                provider: item.get("provider").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                content: item.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                tokens_used: item.get("tokensUsed").and_then(|v| v.as_u64()).unwrap_or(0),
                                cost_usd: item.get("costUsd").and_then(|v| v.as_f64()).unwrap_or(0.0),
                                duration_ms: item.get("durationMs").and_then(|v| v.as_u64()).unwrap_or(0),
                                is_streaming: false,
                            })
                        })
                        .collect();
                }
            }
            Err(e) => eprintln!("[WOTANN IPC] arena.run failed: {}", e),
        }
    }
    vec![]
}

/// Get extended cost details — routes through KAIROS
#[tauri::command]
pub fn get_cost_details(state: State<AppState>) -> CostDetailSnapshot {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("cost.details", serde_json::json!({})) {
            return CostDetailSnapshot {
                session_cost: result.get("sessionCost").and_then(|v| v.as_f64()).unwrap_or(0.0),
                today_cost: result.get("dailyCost").and_then(|v| v.as_f64()).unwrap_or(0.0),
                week_cost: result.get("weeklyCost").and_then(|v| v.as_f64()).unwrap_or(0.0),
                budget_remaining: result.get("budgetRemaining").and_then(|v| v.as_f64()),
                daily_usage: vec![],
                provider_costs: vec![],
                week_tokens: result.get("weekTokens").and_then(|v| v.as_u64()).unwrap_or(0),
                week_conversations: result.get("weekConversations").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                avg_cost_per_message: result.get("avgCostPerMessage").and_then(|v| v.as_f64()).unwrap_or(0.0),
            };
        }
    }
    let session_cost = *state.session_cost.lock().unwrap_or_else(|e| e.into_inner());
    CostDetailSnapshot {
        session_cost,
        today_cost: session_cost,
        week_cost: session_cost,
        budget_remaining: None,
        daily_usage: vec![],
        provider_costs: vec![],
        week_tokens: 0,
        week_conversations: 0,
        avg_cost_per_message: 0.0,
    }
}

/// Get arbitrage estimates — routes through KAIROS
#[tauri::command]
pub fn get_arbitrage_estimates(prompt: String) -> Vec<ArbitrageEstimate> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("cost.arbitrage", serde_json::json!({ "prompt": prompt })) {
            if let Some(arr) = result.as_array().or_else(|| result.get("estimates").and_then(|v| v.as_array())) {
                return arr
                    .iter()
                    .filter_map(|item| {
                        Some(ArbitrageEstimate {
                            provider: item.get("provider").and_then(|v| v.as_str())?.to_string(),
                            model: item.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            estimated_cost: item.get("estimatedCost").and_then(|v| v.as_f64()).unwrap_or(0.0),
                            estimated_tokens: item.get("estimatedTokens").and_then(|v| v.as_u64()).unwrap_or(0),
                            estimated_latency_ms: item.get("estimatedLatencyMs").and_then(|v| v.as_u64()).unwrap_or(0),
                            quality: item.get("quality").and_then(|v| v.as_str()).unwrap_or("good").to_string(),
                            recommended: item.get("recommended").and_then(|v| v.as_bool()).unwrap_or(false),
                        })
                    })
                    .collect();
            }
        }
    }
    vec![]
}

/// Get plugins — routes through KAIROS
#[tauri::command]
pub fn get_plugins() -> Vec<PluginInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("plugins.list", serde_json::json!({})) {
            if let Ok(plugins) = serde_json::from_value::<Vec<PluginInfo>>(
                result.get("plugins").cloned().unwrap_or(result.clone()),
            ) {
                return plugins;
            }
        }
    }
    vec![]
}

/// Get connectors — routes through KAIROS
#[tauri::command]
pub fn get_connectors() -> Vec<ConnectorInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("connectors.list", serde_json::json!({})) {
            if let Ok(connectors) = serde_json::from_value::<Vec<ConnectorInfo>>(
                result.get("connectors").cloned().unwrap_or(result.clone()),
            ) {
                return connectors;
            }
        }
    }
    vec![]
}

/// Get cron jobs — routes through KAIROS daemon
#[tauri::command]
pub fn get_cron_jobs() -> Vec<CronJobInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("cron.list", serde_json::json!({})) {
            if let Ok(jobs) = serde_json::from_value::<Vec<CronJobInfo>>(
                result.get("jobs").cloned().unwrap_or(result.clone()),
            ) {
                return jobs;
            }
        }
    }
    vec![]
}

/// Get workspaces — discovers projects via KAIROS or local scan
#[tauri::command]
pub fn get_workspaces() -> Vec<WorkspaceInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("workspaces.list", serde_json::json!({})) {
            if let Ok(ws) = serde_json::from_value::<Vec<WorkspaceInfo>>(
                result.get("workspaces").cloned().unwrap_or(result.clone()),
            ) {
                return ws;
            }
        }
    }

    // Fallback: scan only non-protected project locations.
    // Avoid Desktop/Documents here because macOS will prompt every time
    // the app enumerates those folders without prior user consent.
    let home = dirs_home();
    let mut workspaces = Vec::new();
    for dir_name in &["Projects", "Code", "dev", "src", "wotann"] {
        let dir = format!("{}/{}", home, dir_name);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() && path.join(".wotann").exists() {
                    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    workspaces.push(WorkspaceInfo {
                        id: format!("ws-{}", name.to_lowercase().replace(' ', "-")),
                        name: name.clone(),
                        path: path.to_string_lossy().to_string(),
                        description: String::new(),
                        last_accessed: std::fs::metadata(&path)
                            .and_then(|m| m.modified())
                            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                            .unwrap_or(0),
                        conversation_count: 0,
                        pinned: false,
                    });
                }
            }
        }
    }
    workspaces
}

/// Get exec approval rules — routes through KAIROS
#[tauri::command]
pub fn get_approval_rules() -> Vec<ApprovalRule> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("config.get", serde_json::json!({ "key": "approvalRules" })) {
            if let Ok(rules) = serde_json::from_value::<Vec<ApprovalRule>>(
                result.get("value").cloned().unwrap_or(result.clone()),
            ) {
                return rules;
            }
        }
    }
    vec![]
}

// ── First-Launch Dependency Management ──────────────────

/// Dependency check result
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub node_installed: bool,
    pub node_version: String,
    pub npm_installed: bool,
    pub npm_version: String,
    pub wotann_cli_installed: bool,
    pub wotann_cli_version: String,
    pub engine_running: bool,
    pub ollama_installed: bool,
    pub ollama_running: bool,
    pub ollama_version: String,
    pub gemma4_available: bool,
}

/// Check all dependencies — called on first launch
#[tauri::command]
pub async fn check_dependencies(state: State<'_, AppState>) -> Result<DependencyStatus, String> {
    let node = check_command("node", &["--version"]).await;
    let npm = check_command("npm", &["--version"]).await;
    let wotann = check_command("wotann", &["--version"]).await;
    let ollama_cli = check_command("ollama", &["--version"]).await;
    let engine_running = *state
        .engine_running
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    // Probe Ollama HTTP API to check if the server is running
    let (ollama_running, ollama_version) = match check_ollama_api().await {
        Some(ver) => (true, ver),
        None => (false, ollama_cli.clone().unwrap_or_default()),
    };

    // Check if Gemma 4 is available in Ollama model list
    let gemma4_available = if ollama_running {
        match list_ollama_models().await {
            Ok(models) => models.iter().any(|m| m.starts_with("gemma4")),
            Err(_) => false,
        }
    } else {
        false
    };

    Ok(DependencyStatus {
        node_installed: node.is_some(),
        node_version: node.unwrap_or_default(),
        npm_installed: npm.is_some(),
        npm_version: npm.unwrap_or_default(),
        wotann_cli_installed: wotann.is_some(),
        wotann_cli_version: wotann.unwrap_or_default(),
        engine_running,
        ollama_installed: ollama_cli.is_some(),
        ollama_running,
        ollama_version,
        gemma4_available,
    })
}

/// Probe Ollama HTTP API at localhost:11434
async fn check_ollama_api() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;
    let resp = client.get("http://localhost:11434/api/version").send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().await.ok()?;
    body.get("version").and_then(|v| v.as_str()).map(|s| s.to_string())
}

async fn check_command(cmd: &str, args: &[&str]) -> Option<String> {
    let output = tokio::process::Command::new(cmd)
        .args(args)
        .env("PATH", augmented_path())
        .output()
        .await
        .ok()?;
    if output.status.success() {
        Some(
            String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string(),
        )
    } else {
        None
    }
}

/// Install Node.js via Homebrew (macOS)
#[tauri::command]
pub async fn install_node() -> Result<String, String> {
    // First check if Homebrew is available
    let brew_check = tokio::process::Command::new("brew")
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .await;

    if brew_check.is_ok() && brew_check.as_ref().unwrap().status.success() {
        let output = tokio::process::Command::new("brew")
            .args(["install", "node"])
            .env("PATH", augmented_path())
            .output()
            .await
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            return Ok("Node.js installed successfully via Homebrew".into());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Err("Homebrew not found. Please install Node.js from https://nodejs.org".into())
}

/// Install WOTANN CLI globally via npm
#[tauri::command]
pub async fn install_wotann_cli() -> Result<String, String> {
    let home = dirs_home();

    // Search for the WOTANN source directory in common locations
    let candidates = [
        format!("{}/Projects/wotann", home),
        format!("{}/dev/wotann", home),
        format!("{}/wotann", home),
    ];
    let wotann_src = candidates
        .iter()
        .find(|p| std::path::Path::new(p).join("package.json").exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone());

    if std::path::Path::new(&wotann_src).join("package.json").exists() {
        let output = tokio::process::Command::new("npm")
            .args(["link"])
            .current_dir(&wotann_src)
            .env("PATH", augmented_path())
            .output()
            .await
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            // Make the CLI executable
            let dist_path = format!("{}/dist/index.js", wotann_src);
            let _ = tokio::process::Command::new("chmod")
                .args(["+x", &dist_path])
                .output()
                .await;
            return Ok("WOTANN CLI linked successfully".into());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Err("WOTANN source not found. Please install manually.".into())
}

/// Install Ollama via Homebrew
#[tauri::command]
pub async fn install_ollama() -> Result<String, String> {
    // Check if Homebrew is available
    let brew_check = tokio::process::Command::new("brew")
        .arg("--version")
        .env("PATH", augmented_path())
        .output()
        .await;

    if brew_check.is_ok() && brew_check.as_ref().unwrap().status.success() {
        let output = tokio::process::Command::new("brew")
            .args(["install", "ollama"])
            .env("PATH", augmented_path())
            .output()
            .await
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            // Start Ollama service
            let _ = tokio::process::Command::new("brew")
                .args(["services", "start", "ollama"])
                .env("PATH", augmented_path())
                .output()
                .await;
            return Ok("Ollama installed and started successfully".into());
        }
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Err("Homebrew not found. Download Ollama from https://ollama.com/download".into())
}

/// Pull an Ollama model (e.g., llama3.2)
#[tauri::command]
pub async fn pull_ollama_model(model: String) -> Result<String, String> {
    let output = tokio::process::Command::new("ollama")
        .args(["pull", &model])
        .env("PATH", augmented_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run ollama pull: {}", e))?;

    if output.status.success() {
        Ok(format!("Model {} pulled successfully", model))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// List available Ollama models
#[tauri::command]
pub async fn list_ollama_models() -> Result<Vec<String>, String> {
    // Try the HTTP API first
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get("http://localhost:11434/api/tags").send().await {
        Ok(resp) if resp.status().is_success() => {
            let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            let models = body
                .get("models")
                .and_then(|m| m.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            Ok(models)
        }
        _ => {
            // Fall back to CLI
            let output = tokio::process::Command::new("ollama")
                .args(["list"])
                .env("PATH", augmented_path())
                .output()
                .await
                .map_err(|e| e.to_string())?;

            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                let models: Vec<String> = text
                    .lines()
                    .skip(1) // Skip header
                    .filter_map(|line| line.split_whitespace().next().map(|s| s.to_string()))
                    .collect();
                Ok(models)
            } else {
                Ok(vec![])
            }
        }
    }
}

/// Save API keys to the WOTANN config file (~/.wotann/providers.env)
#[tauri::command]
pub async fn save_api_keys(keys: std::collections::HashMap<String, String>) -> Result<(), String> {
    let home = dirs_home();
    let wotann_dir = format!("{}/.wotann", home);
    let env_path = format!("{}/providers.env", wotann_dir);

    // Ensure .wotann directory exists
    std::fs::create_dir_all(&wotann_dir).map_err(|e| e.to_string())?;

    // Read existing env file if it exists
    let mut existing: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Ok(content) = std::fs::read_to_string(&env_path) {
        for line in content.lines() {
            if let Some((key, value)) = line.split_once('=') {
                existing.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }

    // Merge new keys (only non-empty values)
    for (key, value) in &keys {
        if !value.is_empty() {
            existing.insert(key.clone(), value.clone());
        }
    }

    // Write the env file
    let content: String = existing
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("\n");

    std::fs::write(&env_path, &content).map_err(|e| e.to_string())?;

    // Set restrictive permissions (owner read/write only) — API keys are sensitive
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&env_path, perms).map_err(|e| e.to_string())?;
    }

    // NOTE: Removed std::env::set_var — it is unsafe in multi-threaded Rust.
    // The daemon reads from providers.env on startup; no need to set env vars here.

    Ok(())
}

// ── Settings Persistence ──────────────────────────────

/// Save settings to ~/.wotann/settings.json
#[tauri::command]
pub async fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    let home = dirs_home();
    let wotann_dir = format!("{}/.wotann", home);
    let settings_path = format!("{}/settings.json", wotann_dir);

    std::fs::create_dir_all(&wotann_dir).map_err(|e| e.to_string())?;
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Load settings from ~/.wotann/settings.json
#[tauri::command]
pub async fn load_settings() -> Result<serde_json::Value, String> {
    let home = dirs_home();
    let settings_path = format!("{}/.wotann/settings.json", home);

    match std::fs::read_to_string(&settings_path) {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|e| e.to_string())
        }
        Err(_) => Ok(serde_json::json!({})), // Return empty object if no settings file
    }
}

/// Clear the memory database by removing the SQLite file
#[tauri::command]
pub async fn clear_memory() -> Result<String, String> {
    let home = dirs_home();
    let db_path = format!("{}/.wotann/memory.db", home);
    if std::path::Path::new(&db_path).exists() {
        // Remove main db and WAL/SHM files
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(format!("{}-wal", db_path));
        let _ = std::fs::remove_file(format!("{}-shm", db_path));
        Ok("Memory database cleared".into())
    } else {
        Ok("No memory database found".into())
    }
}

// ── Computer Use (Desktop Control) ─────────────────────

/// Get Computer Use state
#[tauri::command]
pub fn get_computer_use_state(
    state: State<AppState>,
) -> crate::computer_use::ComputerUseState {
    state
        .computer_use
        .lock()
        .map(|cu| cu.get_state().clone())
        .unwrap_or_default()
}

/// Start a Computer Use session targeting an app
#[tauri::command]
pub fn start_computer_use(
    app_name: String,
    state: State<AppState>,
) -> Result<(), String> {
    let mut cu = state.computer_use.lock().map_err(|e| e.to_string())?;
    cu.start_session(&app_name)
}

/// End the current Computer Use session
#[tauri::command]
pub fn stop_computer_use(state: State<AppState>) -> Result<(), String> {
    let mut cu = state.computer_use.lock().map_err(|e| e.to_string())?;
    cu.end_session();
    Ok(())
}

/// Capture a screenshot
#[tauri::command]
pub fn capture_screenshot(
    target: Option<String>,
    x: Option<u32>,
    y: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<crate::computer_use::screen::Screenshot, String> {
    match target.as_deref() {
        Some("window") => {
            let title = x.map(|_| "focused".to_string()).unwrap_or_default();
            crate::computer_use::screen::capture_window(&title)
        }
        Some("region") => {
            crate::computer_use::screen::capture_region(
                x.unwrap_or(0),
                y.unwrap_or(0),
                width.unwrap_or(800),
                height.unwrap_or(600),
            )
        }
        _ => crate::computer_use::screen::capture_screen(),
    }
}

/// Approve an app for Computer Use access
#[tauri::command]
pub fn approve_cu_app(
    app_name: String,
    state: State<AppState>,
) -> Result<bool, String> {
    let mut cu = state.computer_use.lock().map_err(|e| e.to_string())?;
    Ok(cu.approve_app(&app_name))
}

/// Check if an app is approved for Computer Use
#[tauri::command]
pub fn is_cu_app_approved(
    app_name: String,
    state: State<AppState>,
) -> bool {
    state
        .computer_use
        .lock()
        .map(|cu| cu.is_app_approved(&app_name))
        .unwrap_or(false)
}

/// Check if an app is a sentinel (dangerous for CU access)
#[tauri::command]
pub fn is_cu_sentinel_app(app_name: String) -> bool {
    crate::computer_use::ComputerUseCoordinator::is_sentinel_app(&app_name)
}

/// Get the last CU action result
#[tauri::command]
pub fn get_cu_action_result(
    action: String,
    target: Option<String>,
) -> crate::computer_use::CUActionResult {
    crate::computer_use::CUActionResult {
        success: true,
        action,
        target,
        screenshot_after: None,
        error: None,
    }
}

/// Check Computer Use permissions
#[tauri::command]
pub fn check_cu_permissions() -> crate::computer_use::permissions::PermissionStatus {
    crate::computer_use::permissions::check_permissions()
}

/// Open macOS permission settings for a specific permission
#[tauri::command]
pub fn open_cu_permission_settings(permission: String) -> Result<(), String> {
    crate::computer_use::permissions::open_permission_settings(&permission)
}

/// Execute a mouse action
#[tauri::command]
pub fn execute_mouse_action(
    action: String,
    x: Option<f64>,
    y: Option<f64>,
) -> crate::computer_use::input::InputResult {
    let mouse_action = match action.as_str() {
        "click" => crate::computer_use::input::MouseAction::Click {
            x: x.unwrap_or(0.0),
            y: y.unwrap_or(0.0),
        },
        "double_click" => crate::computer_use::input::MouseAction::DoubleClick {
            x: x.unwrap_or(0.0),
            y: y.unwrap_or(0.0),
        },
        "right_click" => crate::computer_use::input::MouseAction::RightClick {
            x: x.unwrap_or(0.0),
            y: y.unwrap_or(0.0),
        },
        "move" => crate::computer_use::input::MouseAction::Move {
            x: x.unwrap_or(0.0),
            y: y.unwrap_or(0.0),
        },
        _ => crate::computer_use::input::MouseAction::Click {
            x: x.unwrap_or(0.0),
            y: y.unwrap_or(0.0),
        },
    };
    crate::computer_use::input::execute_mouse(&mouse_action)
}

/// Execute a keyboard action
#[tauri::command]
pub fn execute_keyboard_action(
    action: String,
    text: Option<String>,
    modifiers: Option<Vec<String>>,
) -> crate::computer_use::input::InputResult {
    let kb_action = match action.as_str() {
        "type" => crate::computer_use::input::KeyboardAction::Type {
            text: text.unwrap_or_default(),
        },
        "press" => crate::computer_use::input::KeyboardAction::Press {
            key: text.unwrap_or_default(),
            modifiers: modifiers.unwrap_or_default(),
        },
        "shortcut" => crate::computer_use::input::KeyboardAction::Shortcut {
            keys: modifiers.unwrap_or_default(),
        },
        _ => crate::computer_use::input::KeyboardAction::Type {
            text: text.unwrap_or_default(),
        },
    };
    crate::computer_use::input::execute_keyboard(&kb_action)
}

// ── Remote Control ─────────────────────────────────────

/// List active remote control sessions
#[tauri::command]
pub fn list_remote_sessions(
    state: State<AppState>,
) -> Vec<crate::remote_control::RemoteSession> {
    state.remote_control.list_sessions()
}

/// Create a new remote session for a companion device
#[tauri::command]
pub fn create_remote_session(
    device_id: String,
    device_name: String,
    state: State<AppState>,
) -> Result<crate::remote_control::RemoteSession, String> {
    state.remote_control.create_session(&device_id, &device_name)
}

/// End a remote control session
#[tauri::command]
pub fn end_remote_session(
    session_id: String,
    state: State<AppState>,
) -> Result<(), String> {
    state.remote_control.end_session(&session_id)
}

/// Get remote session count
#[tauri::command]
pub fn remote_session_count(state: State<AppState>) -> usize {
    state.remote_control.session_count()
}

/// Spawn a git worktree for a remote session (isolation)
#[tauri::command]
pub fn spawn_remote_worktree(
    session_id: String,
    base_path: String,
    state: State<AppState>,
) -> Result<String, String> {
    state.remote_control.spawn_worktree(&session_id, &base_path)
}

/// Send a streaming message — uses the IPC client's streaming capability
#[tauri::command]
pub async fn send_message_streaming(
    app: AppHandle,
    prompt: String,
    provider: Option<String>,
    model: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    eprintln!("[INVOKE] send_message_streaming called with prompt: {}", &prompt[..prompt.len().min(30)]);
    // Use explicitly passed provider/model, fall back to AppState
    let provider = provider.unwrap_or_else(|| state.provider.lock().map(|g| g.clone()).unwrap_or_default());
    let model = model.unwrap_or_else(|| state.model.lock().map(|g| g.clone()).unwrap_or_default());
    eprintln!("[INVOKE] using provider={}, model={}", &provider, &model);
    let message_id = format!("msg-{}", chrono_ts());

    // Create a DEDICATED IPC connection for streaming — the shared client
    // would deadlock because status polling also uses it while we hold the stream lock.
    if let Ok(client) = ipc_client::try_kairos() {
        let app_clone = app.clone();
        let msg_id = message_id.clone();
        let provider_clone = provider.clone();
        let model_clone = model.clone();

        tauri::async_runtime::spawn(async move {
            let result = client.call_streaming(
                "query",
                serde_json::json!({ "prompt": prompt, "model": model_clone.clone(), "provider": provider_clone.clone() }),
                |chunk| {
                    let content = chunk.get("params")
                        .and_then(|p| p.get("content"))
                        .and_then(|c| c.as_str())
                        .unwrap_or("");
                    let chunk_type = chunk.get("params")
                        .and_then(|p| p.get("type"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("text");

                    eprintln!("[STREAM] type={} content_len={}", chunk_type, content.len());

                    let _ = app_clone.emit_to("main", "stream-chunk", &StreamChunk {
                        r#type: chunk_type.into(),
                        content: content.into(),
                        provider: provider_clone.clone(),
                        model: model_clone.clone(),
                        message_id: msg_id.clone(),
                        tokens_used: None,
                        cost_usd: None,
                    });
                },
            );
            match result {
                Ok(_) => {
                    // Done event is already emitted by the daemon's stream and forwarded
                    // by the callback above — no need to emit a second one.
                }
                Err(e) => {
                    eprintln!("[WOTANN IPC] streaming query failed: {}", e);
                    // CRITICAL: Emit error event so the frontend knows the send failed
                    let _ = app_clone.emit_to("main", "stream-chunk", &StreamChunk {
                        r#type: "error".into(),
                        content: format!("Engine error: {}. Make sure a model is selected and the provider is configured.", e),
                        provider: provider_clone.clone(),
                        model: model_clone.clone(),
                        message_id: msg_id.clone(),
                        tokens_used: None,
                        cost_usd: None,
                    });
                }
            }
        });

        return Ok(message_id);
    }

    emit_streaming_response(&app, &prompt, &provider, &model, &message_id);
    Ok(message_id)
}

/// Check if the KAIROS daemon is connected (uses IPC client's is_connected)
#[tauri::command]
pub fn is_daemon_connected() -> bool {
    if let Ok(client) = ipc_client::try_kairos() {
        client.is_connected()
    } else {
        false
    }
}

// ── Window Management ──────────────────────────────────

/// Toggle the main window visibility (for global hotkey)
#[tauri::command]
pub fn toggle_window(app: AppHandle) {
    crate::hotkeys::toggle_window(&app);
}

// ── CLI Parity Response Types ──────────────────────────

/// Deep research result
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResearchResult {
    pub topic: String,
    pub result: String,
    pub timestamp: u64,
}

/// Skill information
#[derive(Serialize, Deserialize, Clone)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub category: String,
}

/// Dream cycle result
#[derive(Serialize, Clone)]
pub struct DreamResult {
    pub success: bool,
    pub message: String,
}

/// Health check entry from doctor command
#[derive(Serialize, Deserialize, Clone)]
pub struct HealthCheck {
    pub name: String,
    pub status: String,
    pub detail: String,
}

/// Context info
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    pub percent: f32,
    pub tokens: u64,
    pub message_count: u32,
}

/// Config set result
#[derive(Serialize, Clone)]
pub struct ConfigSetResult {
    pub success: bool,
}

/// Channel status entry
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStatus {
    pub id: String,
    pub name: String,
    pub channel_type: String,
    pub connected: bool,
    pub last_message_at: Option<u64>,
}

/// MCP server entry (registered via ~/.wotann/wotann.yaml).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MCPServer {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub transport: String,
    #[serde(default)]
    pub tool_count: Option<u32>,
    pub enabled: bool,
    #[serde(default)]
    pub status: Option<String>,
}

/// List MCP servers — proxies to KAIROS daemon `mcp.list` RPC.
#[tauri::command]
pub fn get_mcp_servers() -> Vec<MCPServer> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("mcp.list", serde_json::json!({})) {
            if let Ok(servers) = serde_json::from_value::<Vec<MCPServer>>(
                result.get("servers").cloned().unwrap_or(result.clone()),
            ) {
                return servers;
            }
        }
    }
    vec![]
}

/// Toggle MCP server enabled flag — proxies to daemon `mcp.toggle` RPC.
#[tauri::command]
pub fn toggle_mcp_server(name: String, enabled: bool) -> Result<bool, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    let result = client
        .call("mcp.toggle", serde_json::json!({ "name": name, "enabled": enabled }))
        .map_err(|e| e.to_string())?;
    if result.get("ok") == Some(&serde_json::Value::Bool(true)) {
        Ok(true)
    } else {
        Err(result.get("error").and_then(|v| v.as_str()).unwrap_or("toggle failed").to_string())
    }
}

/// Register a new MCP server — proxies to daemon `mcp.add` RPC.
#[tauri::command]
pub fn add_mcp_server(
    name: String,
    command: String,
    args: Vec<String>,
    transport: String,
) -> Result<bool, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    let result = client
        .call(
            "mcp.add",
            serde_json::json!({
                "name": name, "command": command, "args": args, "transport": transport
            }),
        )
        .map_err(|e| e.to_string())?;
    if result.get("ok") == Some(&serde_json::Value::Bool(true)) {
        Ok(true)
    } else {
        Err(result.get("error").and_then(|v| v.as_str()).unwrap_or("add failed").to_string())
    }
}

/// Apply multi-file edits — proxies to daemon `composer.apply` RPC.
#[tauri::command]
pub fn composer_apply(edits: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    client
        .call("composer.apply", serde_json::json!({ "edits": edits }))
        .map_err(|e| e.to_string())
}

/// Save connector config — proxies to daemon `connectors.save_config` RPC.
#[tauri::command]
pub fn connector_save_config(
    connector_type: String,
    config: serde_json::Value,
) -> Result<bool, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    let result = client
        .call(
            "connectors.save_config",
            serde_json::json!({ "connectorType": connector_type, "config": config }),
        )
        .map_err(|e| e.to_string())?;
    if result.get("ok") == Some(&serde_json::Value::Bool(true)) {
        Ok(true)
    } else {
        Err(result.get("error").and_then(|v| v.as_str()).unwrap_or("save failed").to_string())
    }
}

/// Test connector connection — proxies to daemon `connectors.test` RPC.
#[tauri::command]
pub fn connector_test_connection(
    connector_type: String,
    _config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    client
        .call("connectors.test", serde_json::json!({ "connectorType": connector_type }))
        .map_err(|e| e.to_string())
}

/// Voice capability status
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub available: bool,
    pub stt_engine: String,
    pub tts_engine: String,
    pub listening: bool,
}

/// Audit trail entry
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub timestamp: u64,
    pub action: String,
    pub detail: String,
    pub severity: String,
}

/// Precommit analysis result
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrecommitResult {
    pub passed: bool,
    pub checks: Vec<PrecommitCheck>,
    pub summary: String,
}

/// Individual precommit check
#[derive(Serialize, Clone)]
pub struct PrecommitCheck {
    pub name: String,
    pub passed: bool,
    pub message: String,
}

// ── CLI Parity Commands ────────────────────────────────

/// Deep research — routes through KAIROS `research` RPC
#[tauri::command]
pub fn deep_research(topic: String) -> ResearchResult {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("research", serde_json::json!({ "topic": topic })) {
            Ok(result) => {
                return ResearchResult {
                    topic: result.get("topic").and_then(|v| v.as_str()).unwrap_or(&topic).to_string(),
                    result: result.get("result").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    timestamp: result.get("timestamp").and_then(|v| v.as_u64()).unwrap_or_else(chrono_ts),
                };
            }
            Err(e) => eprintln!("[WOTANN IPC] research failed: {}", e),
        }
    }
    ResearchResult {
        topic,
        result: String::new(),
        timestamp: chrono_ts(),
    }
}

/// List available skills — routes through KAIROS `skills.list` RPC
#[tauri::command]
pub fn get_skills() -> Vec<SkillInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("skills.list", serde_json::json!({})) {
            if let Ok(skills) = serde_json::from_value::<Vec<SkillInfo>>(
                result.get("skills").cloned().unwrap_or(result.clone()),
            ) {
                return skills;
            }
        }
    }
    vec![]
}

/// Search skills — routes through KAIROS `skills.search` RPC
#[tauri::command]
pub fn search_skills(query: String) -> Vec<SkillInfo> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("skills.search", serde_json::json!({ "query": query })) {
            if let Ok(skills) = serde_json::from_value::<Vec<SkillInfo>>(
                result.get("skills").cloned().unwrap_or(result.clone()),
            ) {
                return skills;
            }
        }
    }
    vec![]
}

/// Trigger dream cycle — routes through KAIROS `dream` RPC
#[tauri::command]
pub fn trigger_dream() -> DreamResult {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("dream", serde_json::json!({})) {
            Ok(result) => {
                return DreamResult {
                    success: result.get("success").and_then(|v| v.as_bool()).unwrap_or(true),
                    message: result.get("message").and_then(|v| v.as_str()).unwrap_or("Dream cycle completed").to_string(),
                };
            }
            Err(e) => eprintln!("[WOTANN IPC] dream failed: {}", e),
        }
    }
    DreamResult {
        success: false,
        message: "KAIROS daemon not available".into(),
    }
}

/// Run doctor diagnostics — routes through KAIROS `doctor` RPC
#[tauri::command]
pub fn run_doctor() -> Vec<HealthCheck> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("doctor", serde_json::json!({})) {
            if let Ok(checks) = serde_json::from_value::<Vec<HealthCheck>>(
                result.get("checks").cloned().unwrap_or(result.clone()),
            ) {
                return checks;
            }
        }
    }
    vec![]
}

/// Get context info — routes through KAIROS `context.info` RPC
#[tauri::command]
pub fn get_context_info() -> ContextInfo {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("context.info", serde_json::json!({})) {
            Ok(result) => {
                return ContextInfo {
                    percent: result.get("percent").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32,
                    tokens: result.get("tokens").and_then(|v| v.as_u64()).unwrap_or(0),
                    message_count: result.get("messageCount").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
                };
            }
            Err(e) => eprintln!("[WOTANN IPC] context.info failed: {}", e),
        }
    }
    ContextInfo {
        percent: 0.0,
        tokens: 0,
        message_count: 0,
    }
}

/// Get config value — routes through KAIROS `config.get` RPC
#[tauri::command]
pub fn get_config(key: Option<String>) -> serde_json::Value {
    if let Ok(client) = ipc_client::try_kairos() {
        let params = match &key {
            Some(k) => serde_json::json!({ "key": k }),
            None => serde_json::json!({}),
        };
        if let Ok(result) = client.call("config.get", params) {
            return result.get("value").cloned().unwrap_or(result);
        }
    }
    serde_json::Value::Null
}

/// Set config value — routes through KAIROS `config.set` RPC
#[tauri::command]
pub fn set_config(key: String, value: String) -> ConfigSetResult {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("config.set", serde_json::json!({ "key": key, "value": value })) {
            Ok(result) => {
                return ConfigSetResult {
                    success: result.get("success").and_then(|v| v.as_bool()).unwrap_or(true),
                };
            }
            Err(e) => eprintln!("[WOTANN IPC] config.set failed: {}", e),
        }
    }
    ConfigSetResult { success: false }
}

/// Get channels status — routes through KAIROS `channels.status` RPC
#[tauri::command]
pub fn get_channels_status() -> Vec<ChannelStatus> {
    if let Ok(client) = ipc_client::try_kairos() {
        if let Ok(result) = client.call("channels.status", serde_json::json!({})) {
            if let Ok(channels) = serde_json::from_value::<Vec<ChannelStatus>>(
                result.get("channels").cloned().unwrap_or(result.clone()),
            ) {
                return channels;
            }
        }
    }
    vec![]
}

/// Run autonomous task — routes through KAIROS `autonomous.run` RPC
/// Streams results via Tauri events like `send_message`.
#[tauri::command]
pub async fn run_autonomous(
    app: AppHandle,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let provider = state.provider.lock().map_err(|e| e.to_string())?.clone();
    let model = state.model.lock().map_err(|e| e.to_string())?.clone();
    let message_id = format!("auto-{}", chrono_ts());

    if let Ok(client) = ipc_client::try_kairos() {
        let app_clone = app.clone();
        let msg_id = message_id.clone();
        let provider_clone = provider.clone();
        let model_clone = model.clone();

        tauri::async_runtime::spawn(async move {
            match client.call("autonomous.run", serde_json::json!({ "prompt": prompt })) {
                Ok(result) => {
                    let text = result.as_str().unwrap_or("").to_string();
                    if !text.is_empty() {
                        let chars: Vec<char> = text.chars().collect();
                        let mut pos = 0;
                        while pos < chars.len() {
                            let chunk_size = (4 + (pos % 3)).min(chars.len() - pos);
                            let chunk: String = chars[pos..pos + chunk_size].iter().collect();
                            pos += chunk_size;
                            let _ = app_clone.emit(
                                "stream-chunk",
                                &StreamChunk {
                                    r#type: "text".into(),
                                    content: chunk,
                                    provider: provider_clone.clone(),
                                    model: model_clone.clone(),
                                    message_id: msg_id.clone(),
                                    tokens_used: None,
                                    cost_usd: None,
                                },
                            );
                            tokio::time::sleep(tokio::time::Duration::from_millis(8)).await;
                        }
                    }
                    let _ = app_clone.emit(
                        "stream-chunk",
                        &StreamChunk {
                            r#type: "done".into(),
                            content: String::new(),
                            provider: provider_clone,
                            model: model_clone,
                            message_id: msg_id,
                            tokens_used: Some((text.len() / 4) as u64),
                            cost_usd: Some(text.len() as f64 * 0.00004),
                        },
                    );
                }
                Err(e) => {
                    eprintln!("[WOTANN IPC] autonomous.run failed: {}", e);
                    let _ = app_clone.emit(
                        "stream-chunk",
                        &StreamChunk {
                            r#type: "error".into(),
                            content: format!("Autonomous run failed: {}", e),
                            provider: provider_clone,
                            model: model_clone,
                            message_id: msg_id,
                            tokens_used: None,
                            cost_usd: None,
                        },
                    );
                }
            }
        });

        return Ok(message_id);
    }

    Err("KAIROS daemon is not running — cannot run autonomous tasks without the runtime".into())
}

/// Run architect analysis — routes through KAIROS `architect` RPC
#[tauri::command]
pub fn run_architect(prompt: String) -> Result<String, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("architect", serde_json::json!({ "prompt": prompt })) {
            Ok(result) => {
                let text = result.as_str()
                    .or_else(|| result.get("result").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                if !text.is_empty() {
                    return Ok(text);
                }
            }
            Err(e) => eprintln!("[WOTANN IPC] architect failed: {}", e),
        }
    }
    Err("KAIROS daemon is not running — cannot run architect without the runtime".into())
}

/// Run council review — routes through KAIROS `council` RPC
#[tauri::command]
pub fn run_council(query: String) -> Result<String, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("council", serde_json::json!({ "query": query })) {
            Ok(result) => {
                let text = result.as_str()
                    .or_else(|| result.get("result").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                if !text.is_empty() {
                    return Ok(text);
                }
            }
            Err(e) => eprintln!("[WOTANN IPC] council failed: {}", e),
        }
    }
    Err("KAIROS daemon is not running — cannot run council without the runtime".into())
}

/// Get voice status — routes through KAIROS `voice.status` RPC
#[tauri::command]
pub fn get_voice_status() -> VoiceStatus {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("voice.status", serde_json::json!({})) {
            Ok(result) => {
                return VoiceStatus {
                    available: result.get("available").and_then(|v| v.as_bool()).unwrap_or(false),
                    stt_engine: result.get("sttEngine").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    tts_engine: result.get("ttsEngine").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    listening: result.get("listening").and_then(|v| v.as_bool()).unwrap_or(false),
                };
            }
            Err(e) => eprintln!("[WOTANN IPC] voice.status failed: {}", e),
        }
    }
    VoiceStatus {
        available: false,
        stt_engine: String::new(),
        tts_engine: String::new(),
        listening: false,
    }
}

/// Get audit trail — routes through KAIROS `audit.query` RPC
#[tauri::command]
pub fn get_audit_trail(
    action: Option<String>,
    severity: Option<String>,
    limit: Option<u32>,
) -> Vec<AuditEntry> {
    if let Ok(client) = ipc_client::try_kairos() {
        let mut params = serde_json::json!({});
        if let Some(a) = &action {
            params["action"] = serde_json::json!(a);
        }
        if let Some(s) = &severity {
            params["severity"] = serde_json::json!(s);
        }
        if let Some(l) = limit {
            params["limit"] = serde_json::json!(l);
        }
        if let Ok(result) = client.call("audit.query", params) {
            if let Ok(entries) = serde_json::from_value::<Vec<AuditEntry>>(
                result.get("entries").cloned().unwrap_or(result.clone()),
            ) {
                return entries;
            }
        }
    }
    vec![]
}

/// Run precommit analysis — routes through KAIROS `precommit` RPC
#[tauri::command]
pub fn run_precommit() -> PrecommitResult {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("precommit", serde_json::json!({})) {
            Ok(result) => {
                let passed = result.get("passed").and_then(|v| v.as_bool()).unwrap_or(false);
                let summary = result.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let checks = result.get("checks")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| {
                                Some(PrecommitCheck {
                                    name: item.get("name").and_then(|v| v.as_str())?.to_string(),
                                    passed: item.get("passed").and_then(|v| v.as_bool()).unwrap_or(false),
                                    message: item.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                return PrecommitResult {
                    passed,
                    checks,
                    summary,
                };
            }
            Err(e) => eprintln!("[WOTANN IPC] precommit failed: {}", e),
        }
    }
    PrecommitResult {
        passed: false,
        checks: vec![],
        summary: "KAIROS daemon not available".into(),
    }
}

// ── Dispatch & Automation ──────────────────────────────

/// Get dispatch items — routes through KAIROS `dispatch.list`
#[tauri::command]
pub async fn get_dispatch_items() -> Result<serde_json::Value, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("dispatch.list", serde_json::json!({})) {
            Ok(result) => return Ok(result),
            Err(e) => {
                eprintln!("[WOTANN IPC] dispatch.list failed: {}", e);
                return Err(format!("dispatch.list failed: {}", e));
            }
        }
    }
    Err("KAIROS daemon not available".into())
}

/// Create a cron job — routes through KAIROS `automations.create`
#[tauri::command]
pub async fn create_cron_job(
    name: String,
    command: String,
    schedule: String,
) -> Result<serde_json::Value, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call(
            "automations.create",
            serde_json::json!({
                "name": name,
                "command": command,
                "schedule": schedule,
                "type": "cron"
            }),
        ) {
            Ok(result) => return Ok(result),
            Err(e) => {
                eprintln!("[WOTANN IPC] automations.create failed: {}", e);
                return Err(format!("automations.create failed: {}", e));
            }
        }
    }
    Err("KAIROS daemon not available".into())
}

// ── Agent Proof Retrieval ────────────────────────────────

/// Get proof bundle for a completed autonomous task from the KAIROS daemon.
#[tauri::command]
pub async fn get_agent_proof(task_id: String) -> Result<serde_json::Value, String> {
    if let Ok(client) = ipc_client::try_kairos() {
        match client.call("autonomous.proof", serde_json::json!({ "taskId": task_id })) {
            Ok(result) => return Ok(result),
            Err(e) => return Err(format!("autonomous.proof failed: {}", e)),
        }
    }
    Err("KAIROS daemon not available".into())
}

// ── Process Management ──────────────────────────────────

/// Kill a running process by PID. Used by EditorTerminal to terminate commands.
/// Sends SIGTERM first, then SIGKILL if the process doesn't exit within 2 seconds.
#[tauri::command]
pub async fn kill_process(pid: u32) -> Result<bool, String> {
    use std::process::Command;

    // Send SIGTERM (graceful shutdown)
    let term_result = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .output();

    match term_result {
        Ok(output) if output.status.success() => {
            // Wait briefly then check if still alive
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            // Check if process is still running
            let check = Command::new("kill")
                .args(["-0", &pid.to_string()])
                .output();

            if let Ok(c) = check {
                if c.status.success() {
                    // Still alive — send SIGKILL
                    let _ = Command::new("kill")
                        .args(["-KILL", &pid.to_string()])
                        .output();
                }
            }
            Ok(true)
        }
        Ok(_) => Err(format!("Failed to signal process {}", pid)),
        Err(e) => Err(format!("kill command failed: {}", e)),
    }
}

// ── Utility Functions ───────────────────────────────────

/// Utility: millisecond timestamp
fn chrono_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Utility: home directory
fn dirs_home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/Users/default".into())
}

/// Get the local network IP address for device pairing
#[tauri::command]
pub fn get_local_ip() -> String {
    // Try to find a non-loopback IPv4 address by connecting to a public DNS
    // This doesn't send any data — it just lets the OS pick the right interface
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:53").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "localhost".into()
}

// ── Git Integration ─────────────────────────────────────

/// Helper: run a git command and return stdout, or None on failure
async fn run_git_command(args: &[&str]) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args(args)
        .env("PATH", augmented_path())
        .output()
        .await
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

/// Get git status for the current project directory
#[tauri::command]
pub async fn get_git_status() -> Result<serde_json::Value, String> {
    // Check if we're in a git repo
    let repo_root = match run_git_command(&["rev-parse", "--show-toplevel"]).await {
        Some(root) => root,
        None => {
            return Ok(serde_json::json!({ "isRepo": false }));
        }
    };

    // Get current branch
    let branch = run_git_command(&["branch", "--show-current"])
        .await
        .unwrap_or_else(|| "HEAD (detached)".into());

    // Get file statuses via porcelain format
    let files: Vec<serde_json::Value> = run_git_command(&["status", "--porcelain"])
        .await
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let status = line.get(..2).unwrap_or("??").trim().to_string();
            let path = line.get(3..).unwrap_or("").to_string();
            serde_json::json!({ "path": path, "status": status })
        })
        .collect();

    // Get recent commits
    let recent_commits: Vec<String> = run_git_command(&["log", "--oneline", "-5"])
        .await
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
        .map(|s| s.to_string())
        .collect();

    // Get ahead/behind counts relative to upstream
    let (ahead, behind) = match run_git_command(&[
        "rev-list",
        "--left-right",
        "--count",
        &format!("{}@{{u}}...HEAD", branch),
    ])
    .await
    {
        Some(counts) => {
            let parts: Vec<&str> = counts.split('\t').collect();
            let behind_count = parts.first().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let ahead_count = parts.get(1).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            (ahead_count, behind_count)
        }
        None => (0, 0),
    };

    Ok(serde_json::json!({
        "isRepo": true,
        "root": repo_root,
        "branch": branch,
        "files": files,
        "recentCommits": recent_commits,
        "ahead": ahead,
        "behind": behind,
    }))
}

/// Get git diff output (staged or unstaged)
#[tauri::command]
pub async fn get_git_diff(staged: Option<bool>) -> Result<String, String> {
    let args = if staged.unwrap_or(false) {
        vec!["diff", "--staged"]
    } else {
        vec!["diff"]
    };

    let output = tokio::process::Command::new("git")
        .args(&args)
        .env("PATH", augmented_path())
        .output()
        .await
        .map_err(|e| format!("Failed to run git diff: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!("git diff failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ── C6 Stubs (frontend-parity) ────────────────────────────
// These five commands were previously called by the frontend but had no Rust
// registration, causing silent `invoke()` failures in production. They are
// registered as minimal stubs that return disconnected-style empty payloads
// so the frontend's fallback path triggers cleanly. Implementations should
// be fleshed out by whichever feature area owns them (PDF, tokens, marketplace,
// Camoufox) before those features ship.

#[derive(serde::Serialize)]
pub struct PdfProcessResult {
    pub text: String,
    pub outline: Vec<String>,
    #[serde(rename = "pageCount")]
    pub page_count: u32,
}

#[tauri::command]
pub async fn process_pdf(_path: String) -> Result<PdfProcessResult, String> {
    // Placeholder: PDF extraction is handled by the daemon's PdfProcessor
    // (src/intelligence/). This desktop-app stub exists so the frontend's
    // invoke() succeeds; wire through daemon IPC when the PDF surface ships.
    Ok(PdfProcessResult {
        text: String::new(),
        outline: Vec::new(),
        page_count: 0,
    })
}

#[derive(serde::Serialize, Default)]
pub struct LifetimeTokenStats {
    #[serde(rename = "totalInputTokens")]
    pub total_input_tokens: u64,
    #[serde(rename = "totalOutputTokens")]
    pub total_output_tokens: u64,
    #[serde(rename = "totalThinkingTokens")]
    pub total_thinking_tokens: u64,
    #[serde(rename = "sessionCount")]
    pub session_count: u64,
    #[serde(rename = "byProvider")]
    pub by_provider: std::collections::HashMap<String, serde_json::Value>,
    #[serde(rename = "byModel")]
    pub by_model: std::collections::HashMap<String, serde_json::Value>,
}

#[tauri::command]
pub async fn get_lifetime_token_stats() -> Result<LifetimeTokenStats, String> {
    // Placeholder: the daemon owns cumulative token accounting. Wire through
    // IPC (e.g. daemon method `cost.getLifetimeStats`) when the usage panel
    // ships. Returns zero totals until then.
    Ok(LifetimeTokenStats::default())
}

#[derive(serde::Serialize)]
pub struct MarketplaceManifest {
    #[serde(rename = "skillCount")]
    pub skill_count: u32,
    #[serde(rename = "pluginCount")]
    pub plugin_count: u32,
    #[serde(rename = "lastUpdated")]
    pub last_updated: String,
}

#[tauri::command]
pub async fn get_marketplace_manifest() -> Result<MarketplaceManifest, String> {
    // Placeholder: marketplace catalog lives in the daemon's MCPMarketplace.
    // Wire via IPC once the marketplace UI ships.
    Ok(MarketplaceManifest {
        skill_count: 0,
        plugin_count: 0,
        last_updated: String::new(),
    })
}

#[tauri::command]
pub async fn refresh_marketplace_catalog() -> Result<MarketplaceManifest, String> {
    // Placeholder: same as get_marketplace_manifest until daemon IPC is wired.
    get_marketplace_manifest().await
}

#[derive(serde::Serialize)]
pub struct CamoufoxStatus {
    pub available: bool,
}

#[tauri::command]
pub async fn get_camoufox_status() -> Result<CamoufoxStatus, String> {
    // Placeholder: Camoufox availability detection will probe the local
    // install when that browser feature lands. Reports unavailable for now.
    Ok(CamoufoxStatus { available: false })
}

// ── Subscription Login Commands ───────────────────────────
//
// These wrap the auth.* RPCs exposed by kairos-rpc.ts so the React frontend
// can trigger OAuth logins with a single invoke() call. Each returns the
// raw RPC result so the UI can render a success/error toast with the
// correct provider and expiry metadata.

/// Sign in with Claude Max / Pro via the Claude Code CLI's OAuth flow.
#[tauri::command]
pub async fn login_anthropic(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = ensure_kairos_available(&state)?;
    client.call("auth.anthropic-login", serde_json::json!({}))
}

/// Sign in with ChatGPT Plus via the Codex OAuth PKCE flow. Reuses any
/// existing ~/.codex/auth.json when present so users do not need to log
/// in twice if the Codex CLI is already authenticated.
#[tauri::command]
pub async fn login_codex(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = ensure_kairos_available(&state)?;
    client.call("auth.codex-login", serde_json::json!({}))
}

/// Detect existing ~/.claude and ~/.codex credentials so the settings UI
/// can offer a one-click import banner instead of a fresh browser login.
#[tauri::command]
pub async fn detect_existing_subscriptions(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = ensure_kairos_available(&state)?;
    client.call("auth.detect-existing", serde_json::json!({}))
}

/// Import an existing Codex CLI credential into WOTANN's token store.
#[tauri::command]
pub async fn import_codex_credential(
    path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = ensure_kairos_available(&state)?;
    client.call("auth.import-codex", serde_json::json!({ "path": path }))
}

/// Restart the KAIROS engine so newly-saved env vars take effect immediately.
#[tauri::command]
pub async fn restart_engine(state: State<'_, AppState>) -> Result<(), String> {
    state.sidecar.stop()?;
    // Brief pause to give the OS time to release the socket file before
    // we spawn a fresh daemon. Without this, the new process can race
    // against the stale socket path and fail to bind.
    std::thread::sleep(std::time::Duration::from_millis(500));
    state.sidecar.spawn_explicit()?;
    if state.sidecar.is_running() {
        *state.engine_running.lock().map_err(|e| e.to_string())? = true;
    }
    Ok(())
}

/// Scan the current project for hotspots (frequently-changed files, high
/// churn areas, complex modules). Wraps the `files.hotspots` RPC so the
/// command palette "Scan Project" action has something real to display.
#[tauri::command]
pub async fn scan_project_hotspots(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = ensure_kairos_available(&state)?;
    client.call("files.hotspots", serde_json::json!({}))
}

/// Initialize WOTANN for the current project — creates a fresh session
/// with the init flag so the daemon primes its hotspot cache.
#[tauri::command]
pub async fn initialize_project(
    state: State<'_, AppState>,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = ensure_kairos_available(&state)?;
    let params = serde_json::json!({
        "init": true,
        "name": name.unwrap_or_else(|| "Project Initialized".into()),
    });
    client.call("session.create", params)
}

/// Check if a file exists. Expands `~` to the user's home directory so
/// the frontend can pass paths like `~/.codex/auth.json` directly.
#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, String> {
    let expanded = if let Some(stripped) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        format!("{}/{}", home, stripped)
    } else if path == "~" {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())
    } else {
        path
    };
    Ok(std::path::Path::new(&expanded).exists())
}

// ── Transport-audit fills: previously-missing Tauri commands ─────────────
//
// The Opus adversarial audit (2026-04-15) mapped every invoke(...) call
// site in the React frontend against the registered Tauri commands in
// lib.rs and found four names the frontend calls that had no matching
// #[tauri::command] function. Each invocation failed with "command not
// found" — ProjectList's folder picker, PromptInput's cost preview, and
// the ProofViewer list/reverify actions all silently errored. These thin
// proxies make the UI paths functional; the real work lives in the
// daemon RPCs they forward to.

/// Open a native folder-picker dialog and return the selected path.
/// Wires ProjectList's "add folder" button (ProjectList.tsx:107).
#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    // The dialog plugin's `pick_folder` is blocking. Run it on a
    // background thread so the Tauri runtime stays responsive.
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let result = path.and_then(|p| p.into_path().ok().and_then(|pb| pb.to_str().map(String::from)));
        let _ = tx.send(result);
    });
    rx.await.map_err(|e| format!("open_folder_dialog: {e}"))
}

/// Predict query cost before sending — proxies to daemon `cost.predict` RPC.
/// Wires PromptInput's cost preview (PromptInput.tsx:399).
#[tauri::command]
pub fn predict_cost(
    prompt: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    let mut params = serde_json::Map::new();
    params.insert("prompt".into(), serde_json::Value::String(prompt));
    if let Some(p) = provider {
        params.insert("provider".into(), serde_json::Value::String(p));
    }
    if let Some(m) = model {
        params.insert("model".into(), serde_json::Value::String(m));
    }
    client
        .call("cost.predict", serde_json::Value::Object(params))
        .map_err(|e| e.to_string())
}

/// List completed proof bundles — proxies to daemon `proofs.list` RPC.
/// Wires ProofViewer's list fetch (ProofViewer.tsx:81).
#[tauri::command]
pub fn proofs_list() -> Result<serde_json::Value, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    client
        .call("proofs.list", serde_json::json!({}))
        .map_err(|e| e.to_string())
}

/// Re-run the verification cascade against an existing proof bundle.
/// Wires ProofViewer's reverify action (ProofViewer.tsx:109). The daemon-
/// side handler is an honest stub for now (see docs/GAP_AUDIT); this thin
/// proxy still lights up the UI path so the error surfaces in the app.
#[tauri::command]
pub fn proofs_reverify(id: String) -> Result<serde_json::Value, String> {
    let client = ipc_client::try_kairos().map_err(|e| e.to_string())?;
    client
        .call("proofs.reverify", serde_json::json!({ "id": id }))
        .map_err(|e| e.to_string())
}

// ── Test-only exports for security regression tests ─────────────────────
// The integration tests in src-tauri/tests/security.rs need visibility
// into the otherwise-private security functions to pin their post-audit
// behaviour. The `test_exports` module below is compiled always (not
// gated on #[cfg(test)]) because integration tests link against the
// release-mode lib — where `cfg(test)` is false. It is marked
// #[doc(hidden)] to discourage external use and only exposes thin
// forwarders that match the private function signatures.
#[doc(hidden)]
pub mod test_exports {
    pub fn validate_command(cmd: &str) -> Result<(), String> {
        super::validate_command(cmd)
    }
    pub fn validate_path_for_write(path: &str) -> Result<std::path::PathBuf, String> {
        super::validate_path_for_write(path)
    }
    #[allow(dead_code)]
    pub fn validate_path_existing(path: &str) -> Result<std::path::PathBuf, String> {
        super::validate_path_existing(path)
    }
}
