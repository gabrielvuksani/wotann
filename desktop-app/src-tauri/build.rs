// SB-16 (V9 Wave 6.9 / W6.9 AI) — Tauri auto-updater configuration scaffold.
//
// USER ACTION REQUIRED before shipping a signed release:
//
//   1) Generate a signing key pair (one-time, store the private key safely):
//
//          tauri signer generate -w ~/.tauri/wotann.key
//
//      The command prints the matching PUBLIC key. Replace the
//      `TODO-USER-ACTION-GENERATE-VIA-tauri-signer-generate` value in
//      `tauri.conf.json` -> `plugins.updater.pubkey` with that public
//      key string. The private key NEVER lands in the repo.
//
//   2) Sign each release artifact with the private key. Tauri's
//      `tauri build` invokes the signer when `TAURI_PRIVATE_KEY` is
//      set in the environment; the CI release pipeline injects it at
//      build time.
//
//   3) Publish the produced `latest.json` (Tauri's update manifest) to
//      the GitHub release alongside the binary so the configured
//      endpoint returns a usable feed.
//
// Endpoint: https://api.github.com/repos/gabrielvuksani/wotann/releases/latest
// Dialog mode: enabled (user is prompted before each download). Set
// `dialog: false` only after a UX review — silent updates still need an
// explicit user opt-in surface.

fn main() {
    tauri_build::build()
}
