#!/usr/bin/env python3
"""
WOTANN agent bridge for TerminalBench.

This is the minimal Python shim that the upstream `tb run` TerminalBench
CLI imports (or invokes-as-script) as its "agent". It forwards each task
to the WOTANN daemon over the `wotann` CLI's stdio-streaming query path
and reports results back to `tb` in the contract it expects.

Two invocation modes are supported:

  1. Library import (`AbstractInstalledAgent` subclass). When the user
     has `terminal-bench` pip-installed, `tb run --agent wotann_tb:Agent`
     (or similar) imports `WotannTBAgent` from this file and drives the
     tmux session itself — we only need to implement `perform_task`.

  2. Script invocation (`python tb_agent.py <task-json>`). When the
     TerminalBench CLI doesn't accept an import-path form, it can shell
     out to this file directly. We read a task JSON on stdin and write
     a result JSON on stdout.

Both paths invoke WOTANN the same way: `wotann query --stream --json`
with the task prompt on stdin. All diagnostics go to stderr so stdout
remains a clean JSON-lines channel (matching the convention set by
camoufox-driver.py).

This module is DELIBERATELY optional. If `terminal-bench` is not
installed, only the script-invocation path is usable. Importing this
file never raises if the upstream library is missing — `AbstractInstalledAgent`
is stubbed to `object` in that case so static tooling still parses.

WIRING GUARANTEES:
- `wotann` CLI must be on PATH (install with `npm link` or `npm install -g`).
- `WOTANN_TB_RUN_ID` env var is propagated from the parent harness for
  trajectory correlation.
- No API keys are handled here — WOTANN's own provider layer owns them.
- This script NEVER calls a model provider directly. It's a pure adapter.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any

# Graceful import of the upstream base class. When `terminal-bench` is not
# installed, we fall back to `object` so this file still imports and the
# script-invocation path (see __main__) works standalone.
try:
    from terminal_bench.agents.abstract_installed_agent import (  # type: ignore
        AbstractInstalledAgent,
    )

    _TB_INSTALLED = True
except Exception:  # noqa: BLE001 — deliberate broad catch for optional dep
    AbstractInstalledAgent = object  # type: ignore[assignment,misc]
    _TB_INSTALLED = False


# ── Diagnostic logging (stderr only) ─────────────────────────────────


def _log(msg: str) -> None:
    """Emit a single-line diagnostic to stderr. Stdout is reserved for
    the RPC / result channel so the parent harness can parse cleanly."""
    print(f"[tb_agent] {msg}", file=sys.stderr, flush=True)


# ── WOTANN query driver ──────────────────────────────────────────────


def _wotann_query(prompt: str, *, model: str = "opus-4.7", timeout_s: int = 1800) -> dict[str, Any]:
    """Invoke the WOTANN CLI for a single task prompt.

    Returns a dict with at minimum {completed: bool, transcript: list[str]}.
    On failure (missing CLI, non-zero exit, timeout) returns a failure dict
    with `error` populated — never raises.

    The `wotann query --json --stream` contract emits newline-delimited
    JSON events; we collect them into a single aggregated result.
    """
    cmd = [
        "wotann",
        "query",
        "--stream",
        "--json",
        "--model",
        model,
        # No --prompt flag: the prompt goes on stdin to avoid arg-length limits.
    ]
    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except FileNotFoundError:
        return {
            "completed": False,
            "transcript": [],
            "error": "wotann CLI not on PATH (install via `npm link` in repo root)",
            "duration_ms": int((time.monotonic() - t0) * 1000),
        }
    except subprocess.TimeoutExpired:
        return {
            "completed": False,
            "transcript": [],
            "error": f"wotann query timeout after {timeout_s}s",
            "duration_ms": timeout_s * 1000,
        }

    duration_ms = int((time.monotonic() - t0) * 1000)
    transcript: list[str] = []
    completed = proc.returncode == 0

    for raw in proc.stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Non-JSON line (likely human-readable progress) — preserve as plain text.
            transcript.append(line)
            continue
        if isinstance(event, dict):
            text = event.get("text") or event.get("content")
            if isinstance(text, str):
                transcript.append(text)

    result: dict[str, Any] = {
        "completed": completed,
        "transcript": transcript,
        "duration_ms": duration_ms,
    }
    if not completed:
        result["error"] = f"wotann exit={proc.returncode}; stderr={proc.stderr[:500]}"
    return result


# ── AbstractInstalledAgent subclass (library path) ───────────────────


class WotannTBAgent(AbstractInstalledAgent):  # type: ignore[misc]
    """TerminalBench agent backed by the WOTANN CLI.

    Only usable when `terminal-bench` is pip-installed — in that case the
    upstream harness imports this class, constructs it with kwargs from
    `tb run`, and calls `perform_task(instruction, session)` per task.

    When `terminal-bench` is not installed this class still exists but
    subclasses `object`, so `perform_task` is callable directly as a
    plain function (used by the script-mode __main__ below).
    """

    def __init__(self, model: str = "opus-4.7", **kwargs: Any) -> None:
        if _TB_INSTALLED:
            super().__init__(**kwargs)  # type: ignore[call-arg]
        self.model = model

    @property
    def name(self) -> str:
        return "wotann"

    def perform_task(self, instruction: str, session: Any = None) -> dict[str, Any]:
        """Drive a single TerminalBench task to completion.

        When called from within `tb run` the `session` parameter exposes
        tmux controls; we currently IGNORE session and delegate the full
        task to WOTANN's own agent loop (which opens its own shells via
        the sandbox layer). This is the minimal plumbing — richer
        tmux-coordinated execution lands in P1-B1/P1-B2 (env bootstrap +
        native tool calling).
        """
        run_id = os.environ.get("WOTANN_TB_RUN_ID", "no-run-id")
        _log(f"perform_task run_id={run_id} model={self.model} bytes={len(instruction)}")
        result = _wotann_query(instruction, model=self.model)
        _log(f"perform_task done completed={result.get('completed')} duration_ms={result.get('duration_ms')}")
        return result


# ── Script entrypoint ────────────────────────────────────────────────


def _script_main() -> int:
    """Stdin → stdout adapter for `python tb_agent.py` invocation.

    Expected stdin JSON shape:
      {"task_id": "...", "prompt": "...", "model": "..."}

    Emits on stdout:
      {"task_id": "...", "completed": bool, "score": 0|1,
       "duration_ms": int, "transcript": [str, ...], "error"?: str}
    """
    try:
        payload_raw = sys.stdin.read()
        payload = json.loads(payload_raw) if payload_raw.strip() else {}
    except json.JSONDecodeError as e:
        sys.stdout.write(json.dumps({"error": f"invalid stdin JSON: {e}"}) + "\n")
        return 2

    if not isinstance(payload, dict):
        sys.stdout.write(json.dumps({"error": "stdin must be a JSON object"}) + "\n")
        return 2

    task_id = payload.get("task_id", "unknown")
    prompt = payload.get("prompt", "")
    model = payload.get("model", "opus-4.7")
    if not isinstance(prompt, str) or not prompt:
        sys.stdout.write(
            json.dumps({"task_id": task_id, "error": "missing or empty 'prompt'"}) + "\n"
        )
        return 2

    result = _wotann_query(prompt, model=model)
    out = {
        "task_id": task_id,
        "completed": bool(result.get("completed")),
        "score": 1 if result.get("completed") else 0,
        "duration_ms": int(result.get("duration_ms", 0)),
        "transcript": result.get("transcript", []),
    }
    if "error" in result:
        out["error"] = result["error"]
    sys.stdout.write(json.dumps(out) + "\n")
    return 0 if result.get("completed") else 1


if __name__ == "__main__":
    sys.exit(_script_main())
