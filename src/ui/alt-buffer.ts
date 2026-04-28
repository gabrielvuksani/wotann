/**
 * Alt-buffer mode — Claude Code `/tui fullscreen` parity.
 *
 * Switches the terminal into the alternate screen buffer (the same
 * buffer `vim`/`htop`/`less` use) so the TUI gets the entire viewport
 * for itself and the user's scrollback is preserved untouched. When
 * the TUI exits — gracefully OR via crash — the terminal returns to
 * the main buffer with whatever was on screen before WOTANN started.
 *
 * Why ship this:
 *   - Flicker-free streaming. The Ink renderer only repaints the
 *     visible viewport instead of constantly scrolling new content
 *     into the user's terminal history.
 *   - Fixed input pinned at the bottom — the prompt never scrolls
 *     away as the chat grows. Same UX everyone gets used to in
 *     Claude Code's `/tui fullscreen`.
 *   - No accidental scrollback pollution. Long sessions that emit
 *     hundreds of streamed tokens don't drown the user's tmux
 *     scrollback or shell history.
 *
 * Tradeoffs:
 *   - Cmd+F / tmux search inside Ink content stops working because
 *     the content lives in the alt buffer. Users can hit `[` (TODO:
 *     wire) or run `/save` to dump the conversation back to main
 *     buffer when they need to grep.
 *   - Terminal mouse selection still works (we don't enable mouse
 *     capture mode — that's a separate xterm setting).
 *
 * Activation:
 *   - `--fullscreen` CLI flag, OR
 *   - `WOTANN_FULLSCREEN=1` env var.
 *
 *   Default OFF because some terminal multiplexers / non-xterm
 *   terminals handle the alt-buffer escape sequences imperfectly.
 *   The opt-in lets power users enable it explicitly.
 *
 * Crash safety:
 *   register{ExitHandlers} hooks SIGINT, SIGTERM, SIGHUP,
 *   `process.exit`, AND `uncaughtException`/`unhandledRejection` so
 *   a crashed WOTANN never leaves the user staring at an alt-buffer
 *   they can't escape (which forces them to `reset` the terminal).
 */

const ENTER_ALT_BUFFER = "[?1049h";
const EXIT_ALT_BUFFER = "[?1049l";
const SHOW_CURSOR = "[?25h";

interface AltBufferState {
  active: boolean;
  installed: boolean;
}

const state: AltBufferState = {
  active: false,
  installed: false,
};

/**
 * Decide whether to enter alt-buffer mode this session.
 *
 * Resolution order (last wins):
 *   1. Default: ON (matches Claude Code `/tui fullscreen`).
 *   2. `WOTANN_FULLSCREEN=0` / `=false` env override → OFF.
 *   3. CLI flag (`--fullscreen` / `--no-fullscreen`) → explicit override.
 *
 * The cliFlag arg is the resolved boolean from Commander after
 * `--fullscreen` / `--no-fullscreen` parsing. Pass `true` when the
 * caller has no flag input (e.g. `wotann resume`) so the env var
 * still gets a chance to opt out.
 */
export function isAltBufferRequested(cliFlag: boolean): boolean {
  const envValue = process.env["WOTANN_FULLSCREEN"];
  if (envValue === "0" || envValue === "false") return false;
  return cliFlag;
}

/**
 * Switch into the alternate screen buffer. Idempotent — calling twice
 * is a no-op (we don't want a stack of escape sequences).
 *
 * Returns false when the terminal is non-TTY (piped output, CI) so
 * callers can short-circuit cleanly. There's no point entering alt
 * buffer in a CI log capture.
 */
export function enterAltBuffer(): boolean {
  if (state.active) return true;
  if (!process.stdout.isTTY) return false;
  process.stdout.write(ENTER_ALT_BUFFER);
  state.active = true;
  registerExitHandlers();
  return true;
}

/**
 * Switch back to the main screen buffer. Idempotent.
 *
 * Always re-shows the cursor in case some upstream code hid it (Ink
 * does this during certain render passes).
 */
export function exitAltBuffer(): void {
  if (!state.active) return;
  if (!process.stdout.isTTY) {
    state.active = false;
    return;
  }
  process.stdout.write(EXIT_ALT_BUFFER);
  process.stdout.write(SHOW_CURSOR);
  state.active = false;
}

/**
 * Wire signal + crash handlers exactly once per process so a
 * terminated/crashed WOTANN always restores the main buffer. Without
 * this, a `kill -INT` on the daemon leaves the terminal stuck on the
 * alt-buffer Ink frame and the user has to `reset` to recover.
 */
function registerExitHandlers(): void {
  if (state.installed) return;
  state.installed = true;

  const onExit = () => {
    exitAltBuffer();
  };

  // Normal termination paths. We use { once: true } NOT to re-fire
  // exitAltBuffer if the same signal arrives twice during shutdown
  // (which would emit two cursor shows + two main-buffer toggles —
  // mostly harmless but noisy in tmux session logs).
  process.once("exit", onExit);
  process.once("SIGINT", () => {
    onExit();
    // Forward SIGINT to default handler so the process actually dies.
    // Without this, swallowing the signal here would leave WOTANN
    // running with its event loop empty.
    process.kill(process.pid, "SIGINT");
  });
  process.once("SIGTERM", () => {
    onExit();
    process.kill(process.pid, "SIGTERM");
  });
  process.once("SIGHUP", () => {
    onExit();
    process.kill(process.pid, "SIGHUP");
  });

  // Crash paths. We DON'T re-throw because Ink already prints the
  // error to stderr; our job here is just to make sure the terminal
  // is sane before the user sees it.
  process.once("uncaughtException", (err) => {
    onExit();
    process.stderr.write(`[wotann] uncaught exception: ${String(err)}\n`);
    process.exit(1);
  });
  process.once("unhandledRejection", (reason) => {
    onExit();
    process.stderr.write(`[wotann] unhandled rejection: ${String(reason)}\n`);
    process.exit(1);
  });
}
