// WOTANN Desktop — Daemon lifecycle management
// Manages the KAIROS daemon as a background service.
// Strategy: check socket → start via launchctl or direct spawn → wait for socket

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::commands::augmented_path;

const SOCKET_NAME: &str = "kairos.sock";
const DAEMON_LABEL: &str = "com.wotann.daemon";

/// Manages the KAIROS daemon lifecycle
pub struct SidecarManager {
    child: Mutex<Option<Child>>,
}

impl SidecarManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    /// Get the WOTANN home directory (~/.wotann)
    fn wotann_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home).join(".wotann")
    }

    /// Get the daemon socket path
    fn socket_path() -> PathBuf {
        Self::wotann_dir().join(SOCKET_NAME)
    }

    fn configured_source_dir() -> Option<PathBuf> {
        if let Ok(path) = std::env::var("WOTANN_SOURCE_DIR") {
            let candidate = PathBuf::from(path);
            if candidate.join("package.json").exists() {
                return Some(candidate);
            }
        }

        let config_path = Self::wotann_dir().join("source-dir");
        let path = std::fs::read_to_string(config_path).ok()?;
        let candidate = PathBuf::from(path.trim());
        candidate.join("package.json").exists().then_some(candidate)
    }

    /// Check whether a path falls inside a macOS TCC-protected folder.
    fn is_tcc_protected(path: &Path) -> bool {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.is_empty() { return false; }
        let protected = ["Desktop", "Documents", "Downloads"];
        protected.iter().any(|dir| {
            path.starts_with(PathBuf::from(&home).join(dir))
        })
    }

    fn persist_source_dir(path: &Path) -> Result<(), String> {
        let wotann_dir = Self::wotann_dir();
        std::fs::create_dir_all(&wotann_dir).map_err(|e| e.to_string())?;
        std::fs::write(wotann_dir.join("source-dir"), path.display().to_string())
            .map_err(|e| e.to_string())
    }

    /// SB-N3 fix: locate the daemon bundled into the Tauri .app/.dmg via
    /// `bundle.resources` in `tauri.conf.json`. The companion script
    /// `desktop-app/scripts/bundle-daemon-for-tauri.mjs` populates a
    /// `wotann-runtime/` dir before each Tauri build; Tauri's bundler
    /// places it at `Contents/Resources/wotann-runtime/` on macOS.
    /// Without this, end-user DMG installs have no daemon source on disk
    /// and `source_dir()` falls through to "WOTANN source not found".
    fn bundled_runtime_dir() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        // macOS: WOTANN.app/Contents/MacOS/WOTANN -> WOTANN.app/Contents/Resources/wotann-runtime
        let macos_path = exe
            .parent()  // Contents/MacOS
            .and_then(|p| p.parent())  // Contents
            .map(|p| p.join("Resources").join("wotann-runtime"));
        if let Some(p) = macos_path.as_ref() {
            if p.join("dist/daemon/start.js").exists() && p.join("package.json").exists() {
                return Some(p.clone());
            }
        }
        // Linux/Windows: bundled resources usually sit alongside the exe
        let neighbor = exe.parent().map(|p| p.join("wotann-runtime"));
        if let Some(p) = neighbor.as_ref() {
            if p.join("dist/daemon/start.js").exists() && p.join("package.json").exists() {
                return Some(p.clone());
            }
        }
        None
    }

    /// Resolve the WOTANN source directory.
    ///
    /// Auto-start avoids probing macOS privacy-protected folders like Desktop.
    /// Explicit install/setup flows can opt into broader discovery.
    fn source_dir(include_protected_dirs: bool) -> Option<PathBuf> {
        // SB-N3 fix: prefer the daemon bundled with the .app/.dmg over any
        // external source. A user's local checkout (if any) may be stale or
        // mismatched with the running desktop binary; the bundled daemon is
        // the version the .dmg was built against.
        if let Some(path) = Self::bundled_runtime_dir() {
            return Some(path);
        }
        if let Some(path) = Self::configured_source_dir() {
            return Some(path);
        }

        // Walk up from the running binary's own path looking for the wotann
        // package.json. This covers dev/cargo-run from anywhere, packaged
        // .app installs, and users who cloned the repo to non-default
        // locations — all without needing WOTANN_SOURCE_DIR to be set.
        // Only walks inside the user's home tree and respects TCC rules
        // when include_protected_dirs is false.
        if let Ok(exe) = std::env::current_exe() {
            let mut cur = exe.as_path();
            while let Some(parent) = cur.parent() {
                let candidate = parent.join("package.json");
                if candidate.exists() {
                    // Found a package.json; check it's the wotann one
                    if let Ok(raw) = std::fs::read_to_string(&candidate) {
                        if raw.contains("\"wotann\"") || raw.contains("wotann-desktop") {
                            if include_protected_dirs || !Self::is_tcc_protected(parent) {
                                return Some(parent.to_path_buf());
                            }
                        }
                    }
                }
                cur = parent;
            }
        }

        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let mut candidates = vec![
            PathBuf::from(&home).join("Projects/wotann"),
            PathBuf::from(&home).join("Code/wotann"),
            PathBuf::from(&home).join("dev/wotann"),
            PathBuf::from(&home).join("src/wotann"),
            PathBuf::from(&home).join("wotann"),
        ];

        if include_protected_dirs {
            candidates.push(PathBuf::from(&home).join("Desktop/agent-harness/wotann"));
        }

        candidates
            .into_iter()
            .find(|path| path.join("package.json").exists())
    }

    /// Check if the daemon is running by verifying the socket is responsive.
    /// Cleans up stale socket files if the daemon has crashed.
    pub fn is_daemon_running() -> bool {
        Self::is_daemon_healthy()
    }

    /// Spawn the daemon — tries launchctl first, falls back to direct spawn
    pub fn spawn(&self) -> Result<(), String> {
        self.spawn_with_policy(false)
    }

    /// Spawn the daemon for an explicit user action.
    /// This may use a configured or discovered source directory in a
    /// privacy-protected folder and remembers it for future explicit starts.
    pub fn spawn_explicit(&self) -> Result<(), String> {
        self.spawn_with_policy(true)
    }

    fn spawn_with_policy(&self, allow_protected_source: bool) -> Result<(), String> {
        // Clear stale socket file first — prior daemon may have been SIGKILLed
        // without cleanup, leaving a zombie inode that confuses is_daemon_healthy()
        // and blocks connect() attempts from the RPC layer.
        if Self::socket_path().exists() && !Self::is_daemon_healthy() {
            let _ = std::fs::remove_file(Self::socket_path());
            println!("Cleared stale KAIROS socket file");
        }

        // If socket already exists AND a daemon is actually listening, skip spawn
        if Self::is_daemon_running() {
            println!("KAIROS daemon already running (socket exists)");
            return Ok(());
        }

        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok(());
        }

        // Try launchctl first (if plist installed)
        let plist_path = Self::launchd_plist_path();
        if plist_path.exists() {
            println!("Starting KAIROS daemon via launchctl...");
            let output = Command::new("launchctl")
                .args(["start", DAEMON_LABEL])
                .envs(std::env::vars())
                .env("PATH", augmented_path())
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    // Wait for socket with exponential backoff
                    if Self::wait_for_socket(Duration::from_secs(5)) {
                        println!("KAIROS daemon started via launchctl");
                        return Ok(());
                    }
                }
            }
            println!("launchctl start failed, falling back to direct spawn");
        }

        // Direct spawn fallback
        let Some(wotann_dir) = Self::source_dir(allow_protected_source) else {
            return Err(
                "KAIROS source is not configured for auto-start. Install the daemon service or set WOTANN_SOURCE_DIR."
                    .into(),
            );
        };

        // Block auto-start from probing TCC-protected paths
        if !allow_protected_source && Self::is_tcc_protected(&wotann_dir) {
            return Err(
                "WOTANN source is in a macOS-protected folder (Desktop/Documents/Downloads). \
                 Move to ~/Projects/wotann or set WOTANN_SOURCE_DIR.".into()
            );
        }

        if allow_protected_source {
            let _ = Self::persist_source_dir(&wotann_dir);
        }
        // Prefer source when running from a local checkout so the desktop app
        // uses the latest daemon code even if root dist/ is stale.
        let entry = if wotann_dir.join("src/daemon/start.ts").exists() {
            "src/daemon/start.ts".to_string()
        } else if wotann_dir.join("dist/daemon/start.js").exists() {
            "dist/daemon/start.js".to_string()
        } else {
            return Err(format!(
                "WOTANN source not found at {}. Install WOTANN or set up the daemon.",
                wotann_dir.display()
            ));
        };

        // Prefer compiled JS via node (production). Fall back to tsx for dev.
        // For .ts files: try npx tsx (tsx is rarely globally installed)
        let (runner, runner_args): (&str, Vec<String>) = if entry.ends_with(".ts") {
            // Check if tsx exists directly, otherwise use npx
            let tsx_exists = Command::new("which")
                .arg("tsx")
                .env("PATH", augmented_path())
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if tsx_exists {
                ("tsx", vec![entry.clone()])
            } else {
                ("npx", vec!["tsx".into(), entry.clone()])
            }
        } else {
            ("node", vec![entry.clone()])
        };

        let mut cmd = Command::new(runner);
        cmd.args(&runner_args);

        let result = cmd
            .current_dir(&wotann_dir)
            .envs(std::env::vars())
            .env("PATH", augmented_path())
            .stdin(Stdio::null())
            // Discard stdout/stderr instead of piping — piping without
            // a reader fills the 64KB pipe buffer during startup logging
            // and then every subsequent console.log() in the TS daemon
            // blocks the process forever, preventing it from ever binding
            // the socket. If daemon diagnostics are needed, tee them to
            // ~/.wotann/daemon.log from inside the daemon itself.
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();

        match result {
            Ok(child) => {
                println!("KAIROS daemon spawned directly (PID: {})", child.id());
                *guard = Some(child);

                // Wait for socket. Cold-start via `npx tsx src/daemon/start.ts`
                // commonly takes 15-25s because tsx has to JIT-transform ~200
                // TypeScript modules, initialize the runtime (providers, memory,
                // hooks, sandbox), THEN bind the socket. The prior 5s timeout
                // caused spurious "standalone mode" even on successful spawns.
                drop(guard); // Release lock before waiting
                if Self::wait_for_socket(Duration::from_secs(30)) {
                    println!("KAIROS daemon ready (socket created)");
                } else {
                    println!(
                        "KAIROS daemon spawned but socket not yet available after 30s — watchdog will retry"
                    );
                }
                Ok(())
            }
            Err(e) => Err(format!("Failed to start daemon: {}", e)),
        }
    }

    /// Wait for the daemon socket to appear with exponential backoff
    fn wait_for_socket(timeout: Duration) -> bool {
        let start = Instant::now();
        let mut delay = Duration::from_millis(100);

        while start.elapsed() < timeout {
            if Self::socket_path().exists() {
                return true;
            }
            std::thread::sleep(delay);
            delay = (delay * 2).min(Duration::from_millis(500));
        }
        false
    }

    /// Start a background watchdog that monitors daemon health and auto-restarts.
    ///
    /// Behaviour:
    ///   - Polls every 5s (was 15s — faster recovery on cold start).
    ///   - Tracks the previous "healthy" state so we log transitions
    ///     ("came online" / "disappeared") instead of spamming on every check.
    ///   - When the daemon is unhealthy, attempts a respawn. Back-off up to
    ///     60s between respawn attempts so we don't hammer the TS runtime
    ///     if it's in a persistent crash loop.
    pub fn start_watchdog(&self) {
        std::thread::spawn(|| {
            println!("KAIROS watchdog started (checking every 5s)");
            let mut was_healthy = false;
            // Initial grace period: the initial app-launch spawn kicks the
            // TS daemon which typically needs 20-45s to bind its socket
            // (tsx JIT + runtime init). If the watchdog fires inside this
            // window it will double-spawn. Seed last_spawn_attempt to
            // "just now" so the first respawn isn't allowed until the
            // back-off has passed.
            let mut last_spawn_attempt = Instant::now();
            // Higher starting failure count → longer initial back-off
            // (60s) so we give the initial spawn ample time to finish
            // booting before any respawn is considered.
            let mut consecutive_failures = 3u32;
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let healthy = Self::is_daemon_healthy();

                match (was_healthy, healthy) {
                    (false, true) => {
                        println!("[WATCHDOG] Daemon came online");
                        consecutive_failures = 0;
                    }
                    (true, false) => {
                        println!("[WATCHDOG] Socket disappeared — daemon may have crashed");
                    }
                    _ => {}
                }
                was_healthy = healthy;

                if healthy {
                    continue;
                }

                // Back-off: respawn at most every (5s * 2^failures) up to 60s.
                let backoff = Duration::from_secs(
                    (5u64).saturating_mul(1u64 << consecutive_failures.min(4)),
                )
                .min(Duration::from_secs(60));
                if last_spawn_attempt.elapsed() < backoff {
                    continue;
                }

                println!(
                    "[WATCHDOG] Daemon unhealthy — attempting respawn (attempt #{})",
                    consecutive_failures + 1
                );
                let manager = SidecarManager::new();
                match manager.spawn() {
                    Ok(()) => {
                        last_spawn_attempt = Instant::now();
                        // Don't reset consecutive_failures here — the next health
                        // check will decide whether the spawn actually worked.
                    }
                    Err(e) => {
                        eprintln!("[WATCHDOG] Respawn failed: {}", e);
                        last_spawn_attempt = Instant::now();
                        consecutive_failures = consecutive_failures.saturating_add(1);
                    }
                }
            }
        });
    }

    /// Check if the daemon is healthy (socket exists AND responds to ping).
    /// Used by is_daemon_running() for accurate daemon status.
    pub fn is_daemon_healthy() -> bool {
        if !Self::socket_path().exists() {
            return false;
        }
        // Quick socket connection test
        match std::os::unix::net::UnixStream::connect(Self::socket_path()) {
            Ok(_) => true,
            Err(_) => {
                // Socket exists but can't connect — stale socket
                let _ = std::fs::remove_file(Self::socket_path());
                false
            }
        }
    }

    /// Get the launchd plist path
    fn launchd_plist_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home)
            .join("Library/LaunchAgents")
            .join(format!("{}.plist", DAEMON_LABEL))
    }

    /// Install the launchd plist for always-on daemon
    pub fn install_launchd(&self) -> Result<String, String> {
        let Some(wotann_dir) = Self::source_dir(true) else {
            return Err(
                "WOTANN source not found. Set WOTANN_SOURCE_DIR or install from a non-protected folder."
                    .into(),
            );
        };
        let _ = Self::persist_source_dir(&wotann_dir);
        let entry = if wotann_dir.join("dist/daemon/index.js").exists() {
            wotann_dir.join("dist/daemon/index.js")
        } else {
            return Err("WOTANN daemon entry point not found. Run 'npm run build' first.".into());
        };

        let log_dir = Self::wotann_dir().join("logs");
        std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

        // Whitelist of provider/channel env keys that should survive into a
        // launchd-managed daemon. Keeps the plist small, avoids leaking user
        // shell locals, and ensures OAuth tokens and API keys the terminal
        // can see are also visible to the auto-launched daemon.
        const PROVIDER_ENV_KEYS: &[&str] = &[
            "ANTHROPIC_API_KEY",
            "OPENAI_API_KEY",
            "GOOGLE_API_KEY",
            "GEMINI_API_KEY",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "CODEX_API_KEY",
            "GROQ_API_KEY",
            "CEREBRAS_API_KEY",
            "MISTRAL_API_KEY",
            "DEEPSEEK_API_KEY",
            "PERPLEXITY_API_KEY",
            "XAI_API_KEY",
            "TOGETHER_API_KEY",
            "FIREWORKS_API_KEY",
            "SAMBANOVA_API_KEY",
            "OPENROUTER_API_KEY",
            "HUGGINGFACE_API_KEY",
            "AZURE_OPENAI_API_KEY",
            "AZURE_OPENAI_ENDPOINT",
            "AWS_BEDROCK_REGION",
            "AWS_BEDROCK_ACCESS_KEY",
            "GOOGLE_VERTEX_PROJECT",
            "OLLAMA_HOST",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "SUPABASE_URL",
            "SUPABASE_ANON_KEY",
        ];

        fn xml_escape(s: &str) -> String {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        }

        let mut env_entries = String::new();
        env_entries.push_str("        <key>PATH</key>\n");
        env_entries.push_str(
            "        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>\n",
        );
        for (key, value) in std::env::vars() {
            if PROVIDER_ENV_KEYS.iter().any(|k| *k == key) && !value.is_empty() {
                env_entries.push_str(&format!(
                    "        <key>{}</key>\n        <string>{}</string>\n",
                    xml_escape(&key),
                    xml_escape(&value),
                ));
            }
        }

        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>node</string>
        <string>--experimental-specifier-resolution=node</string>
        <string>{entry}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{workdir}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>{log_dir}/daemon-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>{log_dir}/daemon-stderr.log</string>
    <key>EnvironmentVariables</key>
    <dict>
{env_entries}    </dict>
</dict>
</plist>"#,
            label = DAEMON_LABEL,
            entry = entry.display(),
            workdir = wotann_dir.display(),
            log_dir = log_dir.display(),
            env_entries = env_entries,
        );

        let plist_path = Self::launchd_plist_path();
        let plist_dir = plist_path.parent().unwrap();
        std::fs::create_dir_all(plist_dir).map_err(|e| e.to_string())?;
        std::fs::write(&plist_path, plist_content).map_err(|e| e.to_string())?;

        // V9 Wave 6-RR (SB-6): the plist EnvironmentVariables block can
        // hold up to 27 cleartext API keys (provider config). Default
        // umask leaves the file at mode 0o644 — Spotlight indexes it,
        // every local user can read it. Tighten to 0o600 (owner-only)
        // immediately after write. macOS-only path, so unix-style perms
        // are always available.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            if let Err(e) = std::fs::set_permissions(&plist_path, perms) {
                // Non-fatal: log but continue. The plist still works,
                // it's just world-readable. We surface the failure in
                // the install result so the desktop UI can warn the
                // user, but we do not refuse the install.
                eprintln!(
                    "[wotann] WARN: chmod 0o600 on plist failed (file is world-readable): {}",
                    e
                );
            }
        }

        // Load the plist
        let output = Command::new("launchctl")
            .args(["load", "-w", &plist_path.to_string_lossy()])
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            Ok(format!("Daemon installed as launchd service: {}", DAEMON_LABEL))
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("Failed to load plist: {}", stderr))
        }
    }

    /// Stop the daemon
    pub fn stop(&self) -> Result<(), String> {
        // Try launchctl stop first
        let _ = Command::new("launchctl")
            .args(["stop", DAEMON_LABEL])
            .output();

        // Also kill any directly spawned child
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }

        // Clean up socket
        let _ = std::fs::remove_file(Self::socket_path());

        println!("KAIROS daemon stopped");
        Ok(())
    }

    /// Check if the daemon is running (socket exists OR child process alive)
    pub fn is_running(&self) -> bool {
        // Check socket first (works for launchd-managed daemon)
        if Self::is_daemon_running() {
            return true;
        }

        // Check direct child process
        let mut guard = match self.child.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    // Process exited
                    guard.take();
                    false
                }
                Ok(None) => true, // Still running
                Err(_) => {
                    guard.take();
                    false
                }
            },
            None => false,
        }
    }
}

impl Drop for SidecarManager {
    fn drop(&mut self) {
        // Only kill directly spawned children, not launchd-managed daemons
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}
