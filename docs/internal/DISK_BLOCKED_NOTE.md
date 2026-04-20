# Disk-blocked note — 2026-04-20

During deep-audit execution the task-output directory `/private/tmp/claude-501/...` filled up.
Every Bash call now returns `ENOSPC: no space left on device` when Claude Code tries to create its per-call output file.

User intervention needed to unblock:

```bash
# Safe cleanup — only removes task output files older than 1 hour
find /private/tmp/claude-501 -name "*.output" -mmin +60 -delete

# Or full session-temp wipe (safe: only our current session)
rm -rf /private/tmp/claude-501/-Users-gabrielvuksani-Desktop-agent-harness/*/tasks/*.output
```

Once run, tool calls will work again.
