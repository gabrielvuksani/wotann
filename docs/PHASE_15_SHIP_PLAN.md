# Phase 15 Ship v0.4.0 — Plan + Checklist

**Target**: 2026-06-30 (Anthropic Claude Apps GA).
**Today**: 2026-04-19 → ~72 days runway.

## Shipped this session (foundation)

| Artifact | Status | Notes |
|---|---|---|
| `scripts/release/install.sh` | ✅ | curl|sh installer — OS/arch detect, sha256 verify, atomic install |
| `scripts/release/build-all.sh` | 🟡 stub | Orchestrator; needs node-sea or bun compile wiring |
| `.github/workflows/release.yml` | 🟡 stub | Matrix build + draft GitHub Release + npm publish gate |

## Shipping checklist — critical path

### Week 1 (Apr 20-26): Packaging
- [ ] Wire node `--experimental-sea-config` OR Bun `--compile` in `build-all.sh`
- [ ] Produce real single-binaries for 5 targets (macos-x64, macos-arm64, linux-x64, linux-arm64, windows-x64)
- [ ] End-to-end smoke: download artifact on a clean VM, run `wotann --version`
- [ ] Write `Formula/wotann.rb` for the Homebrew tap repo
- [ ] Decide: separate homebrew-wotann repo OR GitHub-hosted formula?

### Week 2 (Apr 27 - May 3): Distribution
- [ ] Register `wotann.com` DNS (done?) → point to Vercel/CF Pages
- [ ] Build marketing page: hero + install commands + feature matrix
- [ ] Install commands: `brew install gabrielvuksani/wotann/wotann`, `curl -fsSL wotann.com/install.sh | bash`, `npm install -g wotann`
- [ ] npm publish pipeline: validate `main` dist field, test `npm install -g wotann && wotann --version` in a fresh container

### Week 3 (May 4-10): Platform installers
- [ ] macOS DMG: requires Apple Developer ID cert (free tier doesn't sign → user must right-click-open) — decision: ship signed OR unsigned with gatekeeper instructions
- [ ] Windows EXE/MSI: needs Windows code-signing cert ($300/year for EV). Alternative: unsigned + SmartScreen bypass instructions
- [ ] Linux: AppImage (trivial, ships a single file), DEB (apt), RPM (yum/dnf). Use `jdeploy` or `appimage-builder`

### Week 4 (May 11-17): Leaderboard + benchmarks
- [ ] Run WOTANN-Free tier full benchmark suite: TerminalBench, SWE-bench Verified, Aider Polyglot, code-eval set
- [ ] Run WOTANN-Sonnet tier (≤$5 cap enforced via `BudgetEnforcer`)
- [ ] Publish raw reports + scored benchmarks to `wotann.com/bench`
- [ ] Two-tier comparison chart (free vs sonnet)
- [ ] Honesty footnote: data contamination status per benchmark

### Week 5-10 (May 18 - June 28): Polish + launch prep
- [ ] Docs site (VitePress or similar) — how-to guides, API reference
- [ ] `wotann init` wizard for first-run onboarding
- [ ] Installation QA across 10+ user-environments (volunteer beta)
- [ ] Crash telemetry opt-in (respect DNT)
- [ ] Privacy policy + terms (wotann.com/legal)

### Launch day (June 30)
- [ ] `git tag v0.4.0 && git push --tags` → release workflow runs
- [ ] Announce: Hacker News, Twitter, r/LocalLLaMA, r/programming
- [ ] Monitor issues + be responsive for the first 24h

## Deferred (v0.5.0+)

- Signing infrastructure (Apple Developer ID, Windows EV cert)
- Windows MSI full installer (not just EXE)
- Homebrew CASK for macOS DMG (not just CLI formula)
- Linux snap + flatpak packages
- Gatekeeper-friendly macOS notarization
- macOS universal binary (arm64 + x64 fat)

## Risk register

1. **npm publish timing**: if we publish a broken 0.4.0 before bench data lands, we can't un-publish (npm forbids re-use of version numbers). Mitigation: `npm publish --tag next` first, promote to `latest` after validation.
2. **Brand protection**: verify `wotann` + `wotann.com` not trademarked elsewhere. Quick USPTO search before launch.
3. **Contamination disclosure**: HumanEval+ and MBPP+ overlap with common LLM training data. Footnote EVERY benchmark with contamination risk color-coding.
4. **Self-hosted runner reliability**: CI depends on Gabriel's laptop staying online. Before GA, either (a) set up a Linux VM on Hetzner as backup runner OR (b) return to hosted runners with a different flakiness-mitigation strategy.

## Definition of Done (v0.4.0)

- [ ] `brew install gabrielvuksani/wotann/wotann` installs and runs
- [ ] `curl -fsSL wotann.com/install.sh | bash` installs and runs
- [ ] `npm install -g wotann && wotann --version` works
- [ ] DMG installs on a fresh macOS with gatekeeper warning
- [ ] AppImage runs on Ubuntu 22.04 clean install
- [ ] `wotann.com` loads with install commands + feature list
- [ ] `wotann.com/bench` has actual WOTANN-Free + WOTANN-Sonnet numbers on ≥3 benchmarks
