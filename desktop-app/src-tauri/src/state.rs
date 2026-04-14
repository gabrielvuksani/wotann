// WOTANN Desktop — Tauri managed state
// Holds the app state: sidecar handle, connection status, session data

use crate::computer_use::ComputerUseCoordinator;
use crate::remote_control::RemoteControlServer;
use crate::sidecar::SidecarManager;
use std::sync::Mutex;

/// Application state managed by Tauri
pub struct AppState {
    /// WOTANN Engine sidecar process manager
    pub sidecar: SidecarManager,
    /// Whether the WOTANN Engine sidecar is running
    pub engine_running: Mutex<bool>,
    /// Current provider name
    pub provider: Mutex<String>,
    /// Current model identifier
    pub model: Mutex<String>,
    /// Current session ID
    pub session_id: Mutex<String>,
    /// Accumulated session cost
    pub session_cost: Mutex<f64>,
    /// Total tokens used this session
    pub total_tokens: Mutex<u64>,
    /// Computer Use coordinator (Desktop Control)
    pub computer_use: Mutex<ComputerUseCoordinator>,
    /// Remote control server for companion devices
    pub remote_control: RemoteControlServer,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            sidecar: SidecarManager::new(),
            engine_running: Mutex::new(false),
            provider: Mutex::new("anthropic".into()),
            model: Mutex::new("claude-opus-4-6".into()),
            session_id: Mutex::new(format!(
                "session-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
            )),
            session_cost: Mutex::new(0.0),
            total_tokens: Mutex::new(0),
            computer_use: Mutex::new(ComputerUseCoordinator::new()),
            remote_control: RemoteControlServer::default(),
        }
    }
}
