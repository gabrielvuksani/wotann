// WOTANN Remote Control — Phone drives desktop sessions
//
// Architecture:
// - iOS connects via CompanionServer WebSocket
// - Remote control commands are forwarded to this module
// - Each remote session gets its own git worktree for isolation
// - Supports up to 32 concurrent remote sessions

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;

/// A remote control session from a companion device
#[derive(Serialize, Clone)]
pub struct RemoteSession {
    pub id: String,
    pub device_id: String,
    pub device_name: String,
    pub worktree_path: Option<String>,
    pub created_at: u64,
    pub messages_exchanged: u64,
    pub status: SessionStatus,
}

#[derive(Serialize, Clone)]
#[allow(dead_code)]
pub enum SessionStatus {
    Active,
    Idle,
    Disconnected,
}

/// Manages all active remote control sessions
pub struct RemoteControlServer {
    sessions: Mutex<HashMap<String, RemoteSession>>,
    max_sessions: usize,
}

impl RemoteControlServer {
    pub fn new(max_sessions: usize) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            max_sessions,
        }
    }

    /// Create a new remote session for a companion device
    pub fn create_session(&self, device_id: &str, device_name: &str) -> Result<RemoteSession, String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;

        if sessions.len() >= self.max_sessions {
            return Err(format!("Maximum {} concurrent sessions reached", self.max_sessions));
        }

        let session = RemoteSession {
            id: format!("rs-{}", crypto_random_hex()),
            device_id: device_id.to_string(),
            device_name: device_name.to_string(),
            worktree_path: None,
            created_at: chrono_ts(),
            messages_exchanged: 0,
            status: SessionStatus::Active,
        };

        sessions.insert(session.id.clone(), session.clone());
        Ok(session)
    }

    /// End a remote session and clean up its worktree
    pub fn end_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;

        if let Some(session) = sessions.get_mut(session_id) {
            session.status = SessionStatus::Disconnected;
            // Clean up git worktree if one was created
            if let Some(ref path) = session.worktree_path {
                let _ = std::process::Command::new("git")
                    .args(["worktree", "remove", "--force", path])
                    .output();
            }
        }

        sessions.remove(session_id);
        Ok(())
    }

    /// List all active sessions
    pub fn list_sessions(&self) -> Vec<RemoteSession> {
        self.sessions
            .lock()
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Get session count
    pub fn session_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|s| s.len())
            .unwrap_or(0)
    }

    /// Spawn a git worktree for session isolation
    pub fn spawn_worktree(&self, session_id: &str, base_path: &str) -> Result<String, String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get_mut(session_id)
            .ok_or_else(|| "Session not found".to_string())?;

        let worktree_path = format!("{}/worktrees/{}", base_path, session_id);

        let output = std::process::Command::new("git")
            .args(["worktree", "add", &worktree_path, "-b", &format!("remote/{}", session_id)])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }

        session.worktree_path = Some(worktree_path.clone());
        Ok(worktree_path)
    }
}

impl Default for RemoteControlServer {
    fn default() -> Self {
        Self::new(32)
    }
}

fn chrono_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Generate a cryptographically random hex string for session IDs.
/// Reads 16 bytes from /dev/urandom (always available on macOS/Linux).
/// Falls back to timestamp + process ID if /dev/urandom is unavailable.
fn crypto_random_hex() -> String {
    use std::io::Read;
    let mut buf = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() {
            return buf.iter().map(|b| format!("{:02x}", b)).collect();
        }
    }
    // Fallback: combine timestamp, PID, and thread ID for uniqueness
    let ts = chrono_ts();
    let pid = std::process::id();
    format!("{:016x}{:08x}", ts, pid)
}
