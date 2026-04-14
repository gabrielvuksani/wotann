// WOTANN Computer Use — Desktop Control via macOS Accessibility API
//
// Gives the AI agent the ability to see and control the desktop:
// - Screen capture via ScreenCaptureKit
// - Mouse/keyboard control via CGEvent
// - App management via Accessibility API
// - Per-app approval system with sentinel warnings

pub mod screen;
pub mod input;
pub mod permissions;

use serde::Serialize;

// ── CU Audit Trail ──────────────────────────────────────
// Writes Computer Use events to ~/.wotann/cu-audit.log

fn cu_audit_log(event: &str, details: &str) {
    // Use HOME if set; fall back to /var/tmp (not /tmp) to avoid world-readable audit logs.
    // /var/tmp has sticky bit but is less permissive than /tmp for persistent data.
    let home = std::env::var("HOME").unwrap_or_else(|_| "/var/tmp".into());
    let audit_dir = format!("{}/.wotann", home);
    let audit_path = format!("{}/cu-audit.log", audit_dir);

    let _ = std::fs::create_dir_all(&audit_dir);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let entry = format!("[{}] {} {}\n", timestamp, event, details);

    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(entry.as_bytes())
        });
}

/// Current state of the Computer Use system
#[derive(Serialize, Clone, Default)]
pub struct ComputerUseState {
    /// Whether CU is currently active
    pub active: bool,
    /// Which app is currently being controlled
    pub target_app: Option<String>,
    /// Apps approved for CU access
    pub approved_apps: Vec<String>,
    /// Whether screen recording permission is granted
    pub screen_permission: bool,
    /// Whether accessibility permission is granted
    pub accessibility_permission: bool,
    /// Machine-wide lock — only one CU session at a time
    pub locked: bool,
}

/// Result of a Computer Use action
#[derive(Serialize, Clone)]
pub struct CUActionResult {
    pub success: bool,
    pub action: String,
    pub target: Option<String>,
    pub screenshot_after: Option<Vec<u8>>,
    pub error: Option<String>,
}

/// Coordinator for all Computer Use operations
pub struct ComputerUseCoordinator {
    state: ComputerUseState,
}

impl ComputerUseCoordinator {
    pub fn new() -> Self {
        Self {
            state: ComputerUseState::default(),
        }
    }

    /// Start a Computer Use session with the specified app
    pub fn start_session(&mut self, app_name: &str) -> Result<(), String> {
        if self.state.locked {
            return Err("Another Computer Use session is active".into());
        }
        if !self.state.screen_permission {
            return Err("Screen recording permission not granted. Go to System Settings > Privacy & Security > Screen Recording".into());
        }
        if !self.state.accessibility_permission {
            return Err("Accessibility permission not granted. Go to System Settings > Privacy & Security > Accessibility".into());
        }
        self.state.active = true;
        self.state.locked = true;
        self.state.target_app = Some(app_name.to_string());
        cu_audit_log("SESSION_START", &format!("app={}", app_name));
        Ok(())
    }

    /// End the current Computer Use session
    pub fn end_session(&mut self) {
        let app_name = self.state.target_app.clone().unwrap_or_else(|| "unknown".into());
        self.state.active = false;
        self.state.locked = false;
        self.state.target_app = None;
        cu_audit_log("SESSION_END", &format!("app={}", app_name));
    }

    /// Approve an app for Computer Use access
    pub fn approve_app(&mut self, app_name: &str) -> bool {
        if !self.state.approved_apps.contains(&app_name.to_string()) {
            self.state.approved_apps.push(app_name.to_string());
            cu_audit_log("APP_APPROVED", &format!("app={}", app_name));
            true
        } else {
            false
        }
    }

    /// Check if an app is approved
    pub fn is_app_approved(&self, app_name: &str) -> bool {
        self.state.approved_apps.iter().any(|a| a == app_name)
    }

    /// Check if the target app is a sentinel (shell/filesystem/settings access)
    pub fn is_sentinel_app(app_name: &str) -> bool {
        let sentinel_apps = [
            "Terminal", "iTerm", "Warp", "kitty", "Alacritty",
            "System Settings", "System Preferences",
            "Finder", "Activity Monitor",
        ];
        sentinel_apps.iter().any(|s| app_name.contains(s))
    }

    /// Get the current state
    pub fn get_state(&self) -> &ComputerUseState {
        &self.state
    }
}
