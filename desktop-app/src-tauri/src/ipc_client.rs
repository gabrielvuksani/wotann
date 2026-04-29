// WOTANN Desktop — IPC Client for KAIROS daemon
// Connects to the daemon's Unix Domain Socket for real runtime access

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

/// JSON-RPC request
#[derive(Serialize)]
struct RPCRequest {
    jsonrpc: &'static str,
    method: String,
    params: serde_json::Value,
    id: u64,
}

/// JSON-RPC response
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
pub struct RPCResponse {
    pub result: Option<serde_json::Value>,
    pub error: Option<RPCError>,
    pub id: u64,
}

/// JSON-RPC error
#[derive(Deserialize, Debug)]
pub struct RPCError {
    pub code: i32,
    pub message: String,
}

/// Client for communicating with the KAIROS daemon via Unix Domain Socket
pub struct KairosClient {
    stream: Mutex<Option<UnixStream>>,
    request_counter: Mutex<u64>,
}

impl KairosClient {
    pub fn new() -> Self {
        Self {
            stream: Mutex::new(None),
            request_counter: Mutex::new(0),
        }
    }

    /// Get the daemon socket path
    fn socket_path() -> PathBuf {
        // Use HOME if set; fall back to /var/tmp (not /tmp) to avoid placing the
        // socket in a world-writable directory where it could be hijacked.
        let home = std::env::var("HOME").unwrap_or_else(|_| "/var/tmp".into());
        PathBuf::from(home).join(".wotann").join("kairos.sock")
    }

    /// Path to the daemon's session-token file. Mirrors
    /// `resolveWotannHomeSubdir("session-token.json")` from the TS side.
    fn session_token_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/var/tmp".into());
        PathBuf::from(home).join(".wotann").join("session-token.json")
    }

    /// Read the session token the daemon wrote at startup. Mirrors
    /// `readSessionToken()` in `src/daemon/kairos-ipc.ts:125-127`.
    /// Returns None on ENOENT / parse failure / wrong shape so the caller
    /// can decide whether the request must be rejected (auth-required) or
    /// allowed through (`ping`/`keepalive`).
    fn read_session_token() -> Option<String> {
        let path = Self::session_token_path();
        let raw = std::fs::read_to_string(&path).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
        let token = parsed.get("token")?.as_str()?;
        if token.len() < 32 {
            return None;
        }
        Some(token.to_string())
    }

    /// Check if the daemon is running (socket file exists)
    pub fn is_daemon_running() -> bool {
        Self::socket_path().exists()
    }

    /// Connect to the KAIROS daemon with retry logic.
    /// Tries once, does not block startup on failure.
    pub fn connect(&self) -> Result<(), String> {
        let path = Self::socket_path();
        if !path.exists() {
            return Err("KAIROS daemon not running (socket not found)".into());
        }

        match Self::try_connect(&path) {
            Ok(stream) => {
                *self.stream.lock().map_err(|e| {
                    eprintln!("[WOTANN IPC] Lock error during connect: {}", e);
                    e.to_string()
                })? = Some(stream);
                Ok(())
            }
            Err(e) => {
                eprintln!("[WOTANN IPC] Connection failed: {}", e);
                Err(e)
            }
        }
    }

    /// Single connection attempt with timeout
    fn try_connect(path: &PathBuf) -> Result<UnixStream, String> {
        let stream = UnixStream::connect(path)
            .map_err(|e| format!("Failed to connect to KAIROS: {}", e))?;

        // 120s read timeout — model inference can take 30-60s on first query
        // (cold Ollama cache + large system prompt). 30s was too aggressive.
        stream
            .set_read_timeout(Some(Duration::from_secs(120)))
            .map_err(|e| format!("Failed to set read timeout: {}", e))?;

        stream
            .set_write_timeout(Some(Duration::from_secs(10)))
            .map_err(|e| format!("Failed to set write timeout: {}", e))?;

        Ok(stream)
    }

    /// Generate the next request ID
    fn next_id(&self) -> Result<u64, String> {
        let mut counter = self.request_counter.lock().map_err(|e| {
            eprintln!("[WOTANN IPC] Lock error on request counter: {}", e);
            e.to_string()
        })?;
        *counter += 1;
        Ok(*counter)
    }

    /// Send a JSON-RPC request and wait for a single response
    pub fn call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let mut guard = self.stream.lock().map_err(|e| {
            eprintln!("[WOTANN IPC] Lock error on stream: {}", e);
            e.to_string()
        })?;
        let stream = guard
            .as_mut()
            .ok_or_else(|| "Not connected to KAIROS daemon".to_string())?;

        let id = self.next_id()?;

        let request = RPCRequest {
            jsonrpc: "2.0",
            method: method.to_string(),
            params,
            id,
        };

        let mut payload = serde_json::to_string(&request)
            .map_err(|e| format!("[WOTANN IPC] Failed to serialize request: {}", e))?;
        payload.push('\n');

        stream
            .write_all(payload.as_bytes())
            .map_err(|e| format!("[WOTANN IPC] Failed to send request: {}", e))?;
        stream
            .flush()
            .map_err(|e| format!("[WOTANN IPC] Failed to flush: {}", e))?;

        // Read response (newline-delimited JSON)
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| format!("[WOTANN IPC] Failed to read response: {}", e))?;

        if line.trim().is_empty() {
            return Err("[WOTANN IPC] Empty response from daemon".into());
        }

        let response: RPCResponse = serde_json::from_str(line.trim())
            .map_err(|e| format!("[WOTANN IPC] Failed to parse response: {}", e))?;

        if let Some(error) = response.error {
            return Err(format!(
                "[WOTANN IPC] RPC error {}: {}",
                error.code, error.message
            ));
        }

        Ok(response.result.unwrap_or(serde_json::Value::Null))
    }

    /// Send a JSON-RPC request and read streaming newline-delimited JSON responses.
    /// Reads lines until a message with `{"params":{"type":"done"}}` is received.
    /// Each parsed JSON chunk is passed to the `on_chunk` callback.
    pub fn call_streaming(
        &self,
        method: &str,
        params: serde_json::Value,
        on_chunk: impl Fn(serde_json::Value),
    ) -> Result<(), String> {
        let mut guard = self.stream.lock().map_err(|e| {
            eprintln!("[WOTANN IPC] Lock error on stream (streaming): {}", e);
            e.to_string()
        })?;
        let stream = guard
            .as_mut()
            .ok_or_else(|| "Not connected to KAIROS daemon".to_string())?;

        let id = self.next_id()?;

        // Mirror the auth injection from `call`. Streaming methods are
        // never on the unauth allowlist, so this is unconditional.
        let mut params = params;
        if let Some(token) = Self::read_session_token() {
            if !params.is_object() {
                params = serde_json::json!({});
            }
            if let Some(obj) = params.as_object_mut() {
                if !obj.contains_key("authToken") {
                    obj.insert(
                        "authToken".to_string(),
                        serde_json::Value::String(token),
                    );
                }
            }
        }

        let request = RPCRequest {
            jsonrpc: "2.0",
            method: method.to_string(),
            params,
            id,
        };

        let mut payload = serde_json::to_string(&request)
            .map_err(|e| format!("[WOTANN IPC] Failed to serialize streaming request: {}", e))?;
        payload.push('\n');

        stream
            .write_all(payload.as_bytes())
            .map_err(|e| format!("[WOTANN IPC] Failed to send streaming request: {}", e))?;
        stream
            .flush()
            .map_err(|e| format!("[WOTANN IPC] Failed to flush streaming request: {}", e))?;

        // Read newline-delimited JSON lines until we get a "done" message
        let mut reader = BufReader::new(stream);
        loop {
            let mut line = String::new();
            let bytes_read = reader
                .read_line(&mut line)
                .map_err(|e| format!("[WOTANN IPC] Failed to read streaming line: {}", e))?;

            // EOF — daemon closed the connection
            if bytes_read == 0 {
                eprintln!("[WOTANN IPC] Stream ended unexpectedly (EOF)");
                break;
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let value: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[WOTANN IPC] Failed to parse streaming chunk: {}", e);
                    continue;
                }
            };

            // Check for the done sentinel: {"params":{"type":"done"}} at any nesting level
            let is_done = value
                .get("params")
                .and_then(|p| p.get("type"))
                .and_then(|t| t.as_str())
                .map(|t| t == "done")
                .unwrap_or(false);

            on_chunk(value);

            if is_done {
                break;
            }
        }

        Ok(())
    }

    /// Disconnect from the daemon
    pub fn disconnect(&self) {
        if let Ok(mut guard) = self.stream.lock() {
            *guard = None;
        }
    }

    /// Check if currently connected
    pub fn is_connected(&self) -> bool {
        self.stream
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }
}

impl Drop for KairosClient {
    fn drop(&mut self) {
        self.disconnect();
    }
}

/// Attempt to connect to the KAIROS daemon. Returns the client on success.
/// Does not block or retry — returns Err immediately if the daemon is unavailable.
/// Logs errors with `[WOTANN IPC]` prefix.
pub fn try_kairos() -> Result<KairosClient, String> {
    if !KairosClient::is_daemon_running() {
        return Err("[WOTANN IPC] Daemon not running".into());
    }
    let client = KairosClient::new();
    client.connect()?;
    Ok(client)
}
