# Self-Hosted Runner Setup — WOTANN CI

## Why

GitHub Actions' hosted Ubuntu runners were pre-empting WOTANN's test shard 1 mid-vitest (observed 2026-04-19: `The runner has received a shutdown signal` ~6–16 seconds into the job, with no preceding test failure). The `nick-fields/retry@v3` wrapper couldn't recover because the entire runner process was being killed by GitHub's infrastructure.

Moving the test job to a self-hosted runner on Gabriel's laptop eliminates this failure class. Typecheck + Build + Desktop typecheck stay on GH-hosted runners (those pass reliably in under a minute — no pre-emption window).

## One-time setup (Gabriel's laptop, ~4 min)

Paste these four commands into your terminal. The token and download URL come from `https://github.com/gabrielvuksani/wotann/settings/actions/runners/new`.

```bash
# 1. Create a runner work directory (anywhere outside ~/Desktop/agent-harness/)
mkdir -p ~/actions-runner && cd ~/actions-runner

# 2. Download the latest runner (check the URL on the GitHub settings page;
#    the version number and OS vary — copy the full download + tar command
#    from the GitHub "Download" step).
curl -o actions-runner-osx-arm64-2.321.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.321.0/actions-runner-osx-arm64-2.321.0.tar.gz
tar xzf ./actions-runner-osx-arm64-2.321.0.tar.gz

# 3. Register with the repo (replace TOKEN with the one from the GitHub settings page).
./config.sh --url https://github.com/gabrielvuksani/wotann --token <REGISTRATION_TOKEN> \
  --labels self-hosted,linux --unattended --replace

# 4. Start the runner in the foreground (use `./svc.sh install && ./svc.sh start`
#    to run as a launchd service instead).
./run.sh
```

**Note on the `linux` label**: the CI YAML uses `runs-on: [self-hosted, linux]` as a compatibility hint for future Linux workers, but a macOS runner with the `linux` label in its registration set will still pick up these jobs. If you'd prefer pure host-OS honesty, change the label set in `config.sh` to `self-hosted,macos` and update `.github/workflows/ci.yml` line 57 to match.

## What stays on GH-hosted

| Job | Runner |
|---|---|
| `typecheck-build` (ubuntu + macos) | `ubuntu-latest`, `macos-latest` |
| `desktop-typecheck` | `ubuntu-latest` |
| `test` (shard 1/2, 2/2) | **self-hosted** |

## Keeping the runner healthy

- The runner is a long-lived process — close your terminal and the runner dies (unless you used `svc.sh install`).
- If the laptop sleeps, jobs queue until the runner reconnects.
- Update the runner monthly with `./config.sh remove --token <TOKEN>` + re-download + re-register.
- Watch `~/actions-runner/_diag/Runner_*.log` for crash traces.

## Troubleshooting

| Symptom | Fix |
|---|---|
| CI hangs at `Waiting for a runner to pick up this job…` | Runner is offline. Run `./run.sh` or wake the laptop. |
| Test shard fails with `ENOSPC` / disk full | `npm cache clean --force && rm -rf ~/actions-runner/_work/_temp/*` |
| Runner shows "offline" in GitHub settings after sleep | Restart with `./run.sh`; GitHub reconnects within ~30 s. |
| Jobs fail with `npm ci` cache miss | Pre-populate: `cd ~/actions-runner/_work/wotann/wotann && npm ci` once. |

## Removing the runner (if you stop using self-hosted)

```bash
cd ~/actions-runner
./config.sh remove --token <REMOVAL_TOKEN>  # from GitHub settings > runner > remove
```

Then in `.github/workflows/ci.yml` revert the `test` job's `runs-on` to `ubuntu-latest` and restore the matrix OS row.
