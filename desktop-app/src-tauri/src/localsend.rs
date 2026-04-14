// WOTANN LocalSend — P2P File Sharing via LocalSend Protocol v2.1
//
// Implements the LocalSend discovery and file transfer protocol so WOTANN
// appears as a standard LocalSend peer on the local network. Any LocalSend
// app (desktop or mobile) can discover WOTANN and share files with it.
//
// Protocol details:
// - UDP multicast discovery on 224.0.0.167:53317
// - REST API over HTTPS for file transfer (server-side TLS is TODO)
// - Peer announcements use MulticastDto JSON format

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ── Constants ────────────────────────────────────────────

const MULTICAST_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 167);
const MULTICAST_PORT: u16 = 53317;
const PROTOCOL_VERSION: &str = "2.1";
const DEVICE_ALIAS: &str = "WOTANN Desktop";
const ANNOUNCE_INTERVAL: Duration = Duration::from_secs(5);
const RECEIVE_TIMEOUT: Duration = Duration::from_secs(2);

// ── Global Service Singleton ─────────────────────────────

/// Module-level singleton so Tauri commands can access the service
/// without requiring a field on AppState (which is owned by state.rs).
static SERVICE: OnceLock<LocalSendService> = OnceLock::new();

fn get_service() -> &'static LocalSendService {
    SERVICE.get_or_init(LocalSendService::new)
}

// ── Types ────────────────────────────────────────────────

/// A discovered LocalSend peer on the network
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendPeer {
    /// Unique fingerprint (hex-encoded hash of device identity)
    pub fingerprint: String,
    /// Human-readable device name
    pub alias: String,
    /// Protocol version (e.g. "2.1")
    pub version: String,
    /// Device model description
    pub device_model: Option<String>,
    /// Device type: desktop, mobile, web, headless, server
    pub device_type: String,
    /// Port the peer listens on for file transfers
    pub port: u16,
    /// Protocol: "https" or "http"
    pub protocol: String,
    /// Whether this is an announcement (true) or a response (false)
    pub announce: bool,
    /// IP address of the peer (populated from UDP source)
    #[serde(skip_deserializing)]
    pub ip: String,
    /// Timestamp when peer was last seen (epoch millis)
    #[serde(skip_deserializing)]
    pub last_seen: u64,
}

/// Multicast announcement DTO matching LocalSend protocol v2.1
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MulticastDto {
    alias: String,
    version: String,
    device_model: String,
    device_type: String,
    fingerprint: String,
    port: u16,
    protocol: String,
    announce: bool,
}

/// An incoming file transfer request from a peer
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IncomingTransfer {
    /// Unique request ID for this transfer
    pub request_id: String,
    /// Fingerprint of the sending peer
    pub sender_fingerprint: String,
    /// Human-readable sender name
    pub sender_alias: String,
    /// Files being offered
    pub files: Vec<TransferFile>,
    /// When this request was received (epoch millis)
    pub received_at: u64,
}

/// A file within a transfer request
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TransferFile {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    pub file_type: String,
    pub preview: Option<String>,
}

/// Response from a prepare-upload request
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PrepareUploadResponse {
    session_id: String,
    files: HashMap<String, String>,
}

// ── LocalSend Service ────────────────────────────────────

/// Core service managing LocalSend discovery and transfers.
/// Thread-safe — all mutable state behind Arc<Mutex<_>>.
pub struct LocalSendService {
    /// Our device fingerprint (stable across sessions)
    fingerprint: String,
    /// Discovered peers on the network
    peers: Arc<Mutex<HashMap<String, LocalSendPeer>>>,
    /// Incoming transfer requests awaiting acceptance
    incoming_transfers: Arc<Mutex<HashMap<String, IncomingTransfer>>>,
    /// Whether discovery is currently running
    running: Arc<Mutex<bool>>,
}

impl LocalSendService {
    /// Create a new LocalSendService with a deterministic device fingerprint
    fn new() -> Self {
        let fingerprint = generate_device_fingerprint();
        Self {
            fingerprint,
            peers: Arc::new(Mutex::new(HashMap::new())),
            incoming_transfers: Arc::new(Mutex::new(HashMap::new())),
            running: Arc::new(Mutex::new(false)),
        }
    }

    /// Start multicast discovery — joins the multicast group, listens for
    /// peer announcements, and periodically sends our own announcement.
    /// Spawns background threads for listening and announcing.
    fn start_discovery(&self) -> Result<(), String> {
        {
            let mut running = self.running.lock().map_err(|e| e.to_string())?;
            if *running {
                return Ok(()); // Already running
            }
            *running = true;
        }

        // Spawn the listener thread
        let peers = Arc::clone(&self.peers);
        let running = Arc::clone(&self.running);
        std::thread::spawn(move || {
            if let Err(e) = run_listener(peers, running) {
                eprintln!("[LocalSend] Listener error: {}", e);
            }
        });

        // Spawn the announcer thread
        let fingerprint = self.fingerprint.clone();
        let running = Arc::clone(&self.running);
        std::thread::spawn(move || {
            if let Err(e) = run_announcer(fingerprint, running) {
                eprintln!("[LocalSend] Announcer error: {}", e);
            }
        });

        println!(
            "[LocalSend] Discovery started on {}:{}",
            MULTICAST_GROUP, MULTICAST_PORT
        );
        Ok(())
    }

    /// Stop discovery and signal background threads to exit
    fn stop_discovery(&self) -> Result<(), String> {
        let mut running = self.running.lock().map_err(|e| e.to_string())?;
        *running = false;
        println!("[LocalSend] Discovery stopped");
        Ok(())
    }

    /// Send a single multicast announcement immediately
    #[allow(dead_code)]
    fn announce(&self) -> Result<(), String> {
        send_announcement(&self.fingerprint)
    }

    /// Return all discovered peers, pruning any not seen in the last 30 seconds
    fn get_discovered_devices(&self) -> Vec<LocalSendPeer> {
        let now = epoch_millis();
        let stale_threshold = 30_000; // 30 seconds

        let mut peers = self.peers.lock().unwrap_or_else(|e| e.into_inner());

        // Prune stale peers
        peers.retain(|_, peer| now - peer.last_seen < stale_threshold);

        peers.values().cloned().collect()
    }

    /// Get the device fingerprint
    fn fingerprint(&self) -> &str {
        &self.fingerprint
    }

    /// Register an incoming transfer request (called when a peer POSTs to our API)
    #[allow(dead_code)]
    fn register_incoming_transfer(&self, transfer: IncomingTransfer) {
        if let Ok(mut transfers) = self.incoming_transfers.lock() {
            transfers.insert(transfer.request_id.clone(), transfer);
        }
    }

    /// Accept an incoming transfer by request ID
    fn accept_transfer(&self, request_id: &str) -> Result<IncomingTransfer, String> {
        let mut transfers = self.incoming_transfers.lock().map_err(|e| e.to_string())?;
        transfers.remove(request_id).ok_or_else(|| {
            format!(
                "Transfer request '{}' not found or already handled",
                request_id
            )
        })
    }

    /// List pending incoming transfers
    fn pending_transfers(&self) -> Vec<IncomingTransfer> {
        self.incoming_transfers
            .lock()
            .map(|t| t.values().cloned().collect())
            .unwrap_or_default()
    }
}

// ── Discovery Background Workers ─────────────────────────

/// Listener thread: binds to multicast port, receives peer announcements
fn run_listener(
    peers: Arc<Mutex<HashMap<String, LocalSendPeer>>>,
    running: Arc<Mutex<bool>>,
) -> Result<(), String> {
    let bind_addr = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, MULTICAST_PORT);
    let socket = UdpSocket::bind(bind_addr).map_err(|e| {
        format!(
            "Failed to bind UDP socket on port {}: {}",
            MULTICAST_PORT, e
        )
    })?;

    // Join the multicast group on all interfaces
    socket
        .join_multicast_v4(&MULTICAST_GROUP, &Ipv4Addr::UNSPECIFIED)
        .map_err(|e| format!("Failed to join multicast group {}: {}", MULTICAST_GROUP, e))?;

    // Non-blocking with timeout so we can check the running flag
    socket
        .set_read_timeout(Some(RECEIVE_TIMEOUT))
        .map_err(|e| format!("Failed to set read timeout: {}", e))?;

    let mut buf = [0u8; 4096];

    loop {
        // Check if we should stop
        if let Ok(r) = running.lock() {
            if !*r {
                break;
            }
        }

        match socket.recv_from(&mut buf) {
            Ok((len, src)) => {
                let data = &buf[..len];
                if let Ok(text) = std::str::from_utf8(data) {
                    if let Ok(mut peer) = serde_json::from_str::<LocalSendPeer>(text) {
                        peer.ip = src.ip().to_string();
                        peer.last_seen = epoch_millis();

                        if let Ok(mut peers) = peers.lock() {
                            peers.insert(peer.fingerprint.clone(), peer);
                        }
                    }
                    // Silently ignore non-LocalSend UDP packets
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // Timeout — loop back and check running flag
                continue;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                continue;
            }
            Err(e) => {
                eprintln!("[LocalSend] Receive error: {}", e);
                // Brief pause before retrying on unexpected errors
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }

    // Leave multicast group on cleanup
    let _ = socket.leave_multicast_v4(&MULTICAST_GROUP, &Ipv4Addr::UNSPECIFIED);
    Ok(())
}

/// Announcer thread: periodically broadcasts our presence to the multicast group
fn run_announcer(fingerprint: String, running: Arc<Mutex<bool>>) -> Result<(), String> {
    loop {
        if let Ok(r) = running.lock() {
            if !*r {
                break;
            }
        }

        if let Err(e) = send_announcement(&fingerprint) {
            eprintln!("[LocalSend] Announce error: {}", e);
        }

        std::thread::sleep(ANNOUNCE_INTERVAL);
    }
    Ok(())
}

/// Send a single multicast announcement
fn send_announcement(fingerprint: &str) -> Result<(), String> {
    let dto = MulticastDto {
        alias: DEVICE_ALIAS.to_string(),
        version: PROTOCOL_VERSION.to_string(),
        device_model: "desktop".to_string(),
        device_type: "desktop".to_string(),
        fingerprint: fingerprint.to_string(),
        port: MULTICAST_PORT,
        protocol: "https".to_string(),
        announce: true,
    };

    let json = serde_json::to_string(&dto).map_err(|e| format!("JSON serialize error: {}", e))?;

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Failed to create UDP socket for announce: {}", e))?;

    let dest = SocketAddrV4::new(MULTICAST_GROUP, MULTICAST_PORT);
    socket
        .send_to(json.as_bytes(), dest)
        .map_err(|e| format!("Failed to send multicast announcement: {}", e))?;

    Ok(())
}

// ── Tauri Commands ───────────────────────────────────────

/// Discover LocalSend peers on the local network.
/// Starts discovery if not already running and returns currently known peers.
#[tauri::command]
pub async fn discover_localsend_devices() -> Result<Vec<LocalSendPeer>, String> {
    let service = get_service();
    service.start_discovery()?;
    Ok(service.get_discovered_devices())
}

/// Send a file to a LocalSend peer.
///
/// Performs the two-step LocalSend upload flow:
/// 1. POST /api/localsend/v2/prepare-upload -- negotiate the transfer
/// 2. POST /api/localsend/v2/upload -- send file data per accepted file token
#[tauri::command]
pub async fn send_file_localsend(
    peer_id: String,
    file_path: String,
) -> Result<String, String> {
    let service = get_service();

    // Resolve the peer from our discovered devices
    let peer = service
        .get_discovered_devices()
        .into_iter()
        .find(|p| p.fingerprint == peer_id)
        .ok_or_else(|| format!("Peer '{}' not found in discovered devices", peer_id))?;

    // Read the file
    let path = std::path::Path::new(&file_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Cannot read file '{}': {}", file_path, e))?;
    let file_size = metadata.len();
    let file_bytes =
        std::fs::read(path).map_err(|e| format!("Cannot read file '{}': {}", file_path, e))?;

    // Guess MIME type from extension
    let file_type = guess_mime_type(&file_name);

    // File ID for this transfer
    let file_id = format!("file-{}", epoch_millis());

    // Step 1: Prepare upload
    let base_url = format!("{}://{}:{}", peer.protocol, peer.ip, peer.port);
    let prepare_url = format!("{}/api/localsend/v2/prepare-upload", base_url);

    let prepare_body = serde_json::json!({
        "info": {
            "alias": DEVICE_ALIAS,
            "version": PROTOCOL_VERSION,
            "deviceModel": "desktop",
            "deviceType": "desktop",
            "fingerprint": service.fingerprint(),
        },
        "files": {
            &file_id: {
                "id": file_id,
                "fileName": file_name,
                "size": file_size,
                "fileType": file_type,
                "preview": serde_json::Value::Null,
            }
        }
    });

    let client = build_http_client()?;

    let prepare_resp = client
        .post(&prepare_url)
        .json(&prepare_body)
        .send()
        .await
        .map_err(|e| format!("prepare-upload request failed: {}", e))?;

    if !prepare_resp.status().is_success() {
        let status = prepare_resp.status();
        let body = prepare_resp.text().await.unwrap_or_default();
        return Err(format!(
            "prepare-upload rejected (HTTP {}): {}",
            status, body
        ));
    }

    let prepare_result: PrepareUploadResponse = prepare_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse prepare-upload response: {}", e))?;

    // Step 2: Upload each accepted file
    let token = prepare_result
        .files
        .get(&file_id)
        .ok_or_else(|| "Peer did not accept the file".to_string())?;

    let upload_url = format!(
        "{}/api/localsend/v2/upload?sessionId={}&fileId={}&token={}",
        base_url, prepare_result.session_id, file_id, token
    );

    let upload_resp = client
        .post(&upload_url)
        .header("Content-Type", "application/octet-stream")
        .body(file_bytes)
        .send()
        .await
        .map_err(|e| format!("upload request failed: {}", e))?;

    if !upload_resp.status().is_success() {
        let status = upload_resp.status();
        let body = upload_resp.text().await.unwrap_or_default();
        return Err(format!("Upload failed (HTTP {}): {}", status, body));
    }

    Ok(format!(
        "File '{}' sent to '{}' successfully",
        file_name, peer.alias
    ))
}

/// Accept an incoming LocalSend file transfer request
#[tauri::command]
pub async fn accept_localsend_transfer(
    request_id: String,
) -> Result<IncomingTransfer, String> {
    let service = get_service();
    service.accept_transfer(&request_id)
}

/// Get all pending incoming transfer requests
#[tauri::command]
pub async fn get_localsend_transfers() -> Result<Vec<IncomingTransfer>, String> {
    let service = get_service();
    Ok(service.pending_transfers())
}

/// Stop LocalSend discovery
#[tauri::command]
pub async fn stop_localsend_discovery() -> Result<(), String> {
    let service = get_service();
    service.stop_discovery()
}

// ── Helpers ──────────────────────────────────────────────

/// Generate a deterministic device fingerprint from hostname.
/// Uses FNV-1a to produce a 64-char hex fingerprint (256-bit) without
/// requiring the sha2 crate. Chains 4 rounds of FNV-1a-64 with different
/// round numbers mixed in for avalanche distribution.
fn generate_device_fingerprint() -> String {
    let hostname = std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "wotann-desktop".to_string());

    let seed = format!("wotann-localsend-{}", hostname);

    // FNV-1a hash producing 64 hex chars (256-bit fingerprint)
    // Chain 4 rounds of FNV-1a-64 with different round indices
    let mut parts = Vec::with_capacity(4);
    for i in 0u8..4 {
        let mut hash: u64 = 0xcbf29ce484222325; // FNV offset basis
        for byte in seed.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3); // FNV prime
        }
        // Mix in the round number for uniqueness across parts
        hash ^= i as u64;
        hash = hash.wrapping_mul(0x100000001b3);
        parts.push(format!("{:016x}", hash));
    }

    parts.join("")
}

/// Build an HTTP client that accepts self-signed TLS certificates.
/// LocalSend peers use self-signed certs for HTTPS.
fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// Guess a MIME type from a file extension
fn guess_mime_type(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        "ts" => "application/typescript",
        "json" => "application/json",
        "xml" => "application/xml",
        "rs" => "text/x-rust",
        "py" => "text/x-python",
        "rb" => "text/x-ruby",
        "go" => "text/x-go",
        "swift" => "text/x-swift",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "mov" => "video/quicktime",
        "doc" | "docx" => "application/msword",
        "xls" | "xlsx" => "application/vnd.ms-excel",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Get current epoch time in milliseconds
fn epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── TODO ─────────────────────────────────────────────────
//
// TLS Server Endpoint:
// The LocalSend protocol requires an HTTPS server for receiving files.
// This needs self-signed TLS certificate generation (rcgen crate) and
// an async HTTPS listener (e.g., hyper + rustls). For now, file
// receiving is handled by accepting transfer metadata and storing it
// in incoming_transfers. The actual HTTPS server for receiving file
// bytes should be implemented when rcgen/rustls are added as dependencies.
