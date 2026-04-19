#!/usr/bin/env python3
"""
Camoufox persistent driver — JSON-RPC over stdin/stdout.

Boots the Camoufox stealth browser (or the Playwright Chromium fallback)
ONCE and event-loops on stdin, reading newline-delimited JSON-RPC
requests. Each response is written as a single newline-terminated JSON
object on stdout.

Wire format (one JSON object per line):

    request  = { "id": str, "method": str, "params": { ... } }
    response = { "id": str, "result": <json> }                 # success
    response = { "id": str, "error": { "message": str } }      # failure
    banner   = { "ready": true, "backend": "camoufox"|"playwright"|"stub" }

Supported methods:
    launch      — start the browser if not already started
    navigate    — { url }                  -> { url, title }
    click       — { selector }             -> { clicked: true }
    type        — { selector, text }       -> { typed: true }
    evaluate    — { expression }           -> { value: <json> }
    screenshot  — { path }                 -> { path }
    snapshot    — { }                      -> { text, html }
    close       — { }                      -> { closed: true } and exits

IMPORTANT: all diagnostic output (logs, warnings, tracebacks) goes to
stderr. Stdout is reserved for the RPC response channel. A single stray
print() on stdout will break the parent TS client.

STUB MODE: when neither camoufox nor playwright is importable, the
driver boots in stub mode. It accepts the same RPC surface but returns
canned values. This lets the TS test suite exercise the protocol on
machines that don't have either package installed (CI runners, first
clone, etc.). Set WOTANN_CAMOUFOX_REAL=1 in the parent to refuse the
stub path.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any, Callable, Dict, Optional


# ── Backend selection ────────────────────────────────────────────────
#
# We prefer Camoufox, then fall back to Playwright/Chromium, then fall
# back to a stub that returns canned values for the RPC surface. The
# choice is made ONCE at startup and announced in the ready banner.

BACKEND = "stub"
_camoufox_mgr = None
_pw_mgr = None
_browser = None
_page = None


def _err(msg: str) -> None:
    """Log to stderr — stdout is reserved for RPC responses."""
    print(f"[camoufox-driver] {msg}", file=sys.stderr, flush=True)


def _detect_backend() -> str:
    """Return the name of the first available backend."""
    demand_real = os.environ.get("WOTANN_CAMOUFOX_REAL", "").strip() in {"1", "true", "yes"}

    try:
        import camoufox  # noqa: F401
        return "camoufox"
    except Exception as exc:  # pragma: no cover — import-time fallback
        _err(f"camoufox import failed: {exc!r}")

    try:
        import playwright  # noqa: F401
        return "playwright"
    except Exception as exc:  # pragma: no cover — import-time fallback
        _err(f"playwright import failed: {exc!r}")

    if demand_real:
        raise RuntimeError(
            "WOTANN_CAMOUFOX_REAL=1 but neither camoufox nor playwright is installed"
        )

    return "stub"


# ── Real-browser bootstrapping ───────────────────────────────────────


def _launch_camoufox(params: Dict[str, Any]) -> Dict[str, Any]:
    global _camoufox_mgr, _browser, _page
    from camoufox.sync_api import Camoufox  # type: ignore

    headless = bool(params.get("headless", True))
    humanize = bool(params.get("humanize", True))

    _camoufox_mgr = Camoufox(headless=headless, humanize=humanize)
    _browser = _camoufox_mgr.__enter__()
    _page = _browser.new_page()
    return {"launched": True, "backend": "camoufox"}


def _launch_playwright(params: Dict[str, Any]) -> Dict[str, Any]:
    global _pw_mgr, _browser, _page
    from playwright.sync_api import sync_playwright  # type: ignore

    headless = bool(params.get("headless", True))
    _pw_mgr = sync_playwright().__enter__()
    _browser = _pw_mgr.chromium.launch(headless=headless)
    _page = _browser.new_page()
    return {"launched": True, "backend": "playwright"}


# ── Stub backend ─────────────────────────────────────────────────────
#
# Keeps state only in local dicts. Exists so the TS-side RPC protocol
# can be exercised without either Python browser package.


class _StubPage:
    def __init__(self) -> None:
        self.url = ""
        self._title = ""
        self._text = ""
        self._last_selector = ""
        self._last_typed = ""

    def goto(self, url: str, timeout: int = 30_000) -> None:
        del timeout  # unused in stub
        self.url = url
        self._title = f"[stub] {url}"
        self._text = f"stub content for {url}"

    def title(self) -> str:
        return self._title

    def click(self, selector: str) -> None:
        self._last_selector = selector

    def fill(self, selector: str, text: str) -> None:
        self._last_selector = selector
        self._last_typed = text

    def evaluate(self, expression: str) -> Any:
        # Echo the expression string so tests can assert round-trip.
        return {"stub_evaluated": expression}

    def screenshot(self, path: str) -> None:
        # Emit a tiny PNG so downstream checks can assert existence.
        with open(path, "wb") as fh:
            fh.write(
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
                b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
                b"\x1f\x15\xc4\x89\x00\x00\x00\rIDAT\x08\x99c\xf8\xff"
                b"\xff?\x00\x05\xfe\x02\xfe\xa3P\xf4\x00\x00\x00\x00"
                b"IEND\xaeB`\x82"
            )

    def inner_text(self, _selector: str) -> str:
        return self._text

    def content(self) -> str:
        return f"<html><body>{self._text}</body></html>"


# ── Unified handlers (works against either real page or stub) ────────


def _require_page() -> Any:
    if _page is None:
        raise RuntimeError("browser not launched — call `launch` first")
    return _page


def handle_launch(params: Dict[str, Any]) -> Dict[str, Any]:
    global _browser, _page
    if _page is not None:
        return {"launched": True, "backend": BACKEND, "already": True}

    if BACKEND == "camoufox":
        return _launch_camoufox(params)
    if BACKEND == "playwright":
        return _launch_playwright(params)

    _browser = object()
    _page = _StubPage()
    return {"launched": True, "backend": "stub"}


def handle_navigate(params: Dict[str, Any]) -> Dict[str, Any]:
    page = _require_page()
    url = str(params.get("url", ""))
    timeout = int(params.get("timeout", 30_000))
    page.goto(url, timeout=timeout)
    return {"url": url, "title": page.title()}


def handle_click(params: Dict[str, Any]) -> Dict[str, Any]:
    page = _require_page()
    selector = str(params.get("selector", ""))
    page.click(selector)
    return {"clicked": True, "selector": selector}


def handle_type(params: Dict[str, Any]) -> Dict[str, Any]:
    page = _require_page()
    selector = str(params.get("selector", ""))
    text = str(params.get("text", ""))
    page.fill(selector, text)
    return {"typed": True, "selector": selector}


def handle_evaluate(params: Dict[str, Any]) -> Dict[str, Any]:
    page = _require_page()
    expression = str(params.get("expression", ""))
    value = page.evaluate(expression)
    # Ensure the value is JSON-serialisable.
    try:
        json.dumps(value)
    except TypeError:
        value = repr(value)
    return {"value": value}


def handle_screenshot(params: Dict[str, Any]) -> Dict[str, Any]:
    page = _require_page()
    path = str(params.get("path", ""))
    if not path:
        raise ValueError("screenshot requires a `path` param")
    page.screenshot(path=path)
    return {"path": path}


def handle_snapshot(_params: Dict[str, Any]) -> Dict[str, Any]:
    page = _require_page()
    try:
        text = page.inner_text("body")
    except Exception:  # pragma: no cover — page may have no body
        text = ""
    try:
        html = page.content()
    except Exception:  # pragma: no cover — stub path
        html = ""
    return {"text": text, "html": html}


def handle_close(_params: Dict[str, Any]) -> Dict[str, Any]:
    global _browser, _page, _camoufox_mgr, _pw_mgr
    if BACKEND == "camoufox" and _camoufox_mgr is not None:
        try:
            _camoufox_mgr.__exit__(None, None, None)
        except Exception as exc:  # pragma: no cover — teardown best-effort
            _err(f"camoufox teardown failed: {exc!r}")
    if BACKEND == "playwright" and _pw_mgr is not None:
        try:
            if _browser is not None and hasattr(_browser, "close"):
                _browser.close()
        except Exception as exc:  # pragma: no cover — teardown best-effort
            _err(f"playwright browser close failed: {exc!r}")
        try:
            _pw_mgr.__exit__(None, None, None)
        except Exception as exc:  # pragma: no cover — teardown best-effort
            _err(f"playwright teardown failed: {exc!r}")
    _camoufox_mgr = None
    _pw_mgr = None
    _browser = None
    _page = None
    return {"closed": True}


HANDLERS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {
    "launch": handle_launch,
    "navigate": handle_navigate,
    "click": handle_click,
    "type": handle_type,
    "evaluate": handle_evaluate,
    "screenshot": handle_screenshot,
    "snapshot": handle_snapshot,
    "close": handle_close,
}


# ── Main event loop ──────────────────────────────────────────────────


def _emit(obj: Dict[str, Any]) -> None:
    """Write one RPC response as a single newline-terminated JSON line."""
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main() -> int:
    global BACKEND
    try:
        BACKEND = _detect_backend()
    except Exception as exc:
        _err(f"backend detection failed: {exc!r}")
        _emit({"ready": False, "error": {"message": str(exc)}})
        return 1

    _emit({"ready": True, "backend": BACKEND})
    _err(f"ready backend={BACKEND} pid={os.getpid()}")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit({"id": None, "error": {"message": f"bad json: {exc}"}})
            continue

        req_id = req.get("id")
        method = req.get("method", "")
        params = req.get("params") or {}

        handler = HANDLERS.get(method)
        if handler is None:
            _emit({"id": req_id, "error": {"message": f"unknown method: {method}"}})
            continue

        try:
            result = handler(params)
            _emit({"id": req_id, "result": result})
            if method == "close":
                return 0
        except Exception as exc:
            _err(f"{method} failed: {exc!r}\n{traceback.format_exc()}")
            _emit({"id": req_id, "error": {"message": f"{type(exc).__name__}: {exc}"}})

    return 0


if __name__ == "__main__":
    sys.exit(main())
