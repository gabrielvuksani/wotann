## wotann-runtime/ — Tauri-bundled daemon (SB-N3)

This directory is auto-populated by `desktop-app/scripts/bundle-daemon-for-tauri.mjs`
during `tauri build`. It contains a snapshot of the compiled WOTANN daemon
(`dist/`) plus a slim `package.json` so the bundled .app/.dmg can spawn the
daemon without requiring the user to clone the repo.

The contents (everything except this README and `.gitkeep`) are gitignored
because they're build artifacts. Tauri's bundle resource glob picks up
everything here at build time and copies it into `Contents/Resources/wotann-runtime/`
on macOS.

DO NOT delete this directory or the README/.gitkeep stubs — Tauri's bundler
fails compile-time if the resource glob path is empty. Stubs ensure the glob
always matches at least one file.
