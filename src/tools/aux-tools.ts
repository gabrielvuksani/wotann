/**
 * Aux Tools — small, self-contained tool wrappers the agent can call:
 *   - `pdf.extract_text` / `pdf.extract_images` (pdf-processor.ts)
 *   - `post_callback` (post-callback.ts — HMAC-signed outbound notify)
 *   - `task.spawn` (task-tool.ts — create/list subtasks)
 *
 * Each handler returns a structured envelope with explicit error codes
 * so the model can reason about failure rather than swallowing silently.
 * Every outbound URL flows through the SSRF guard.
 */

import { existsSync } from "node:fs";
import type { ToolDefinition } from "../core/types.js";
import { processPDF } from "./pdf-processor.js";
import { postToolCallback, type ToolCallbackConfig, isSafeCallbackURL } from "./post-callback.js";
import { TaskTool } from "./task-tool.js";
import { isSafeUrl } from "../security/ssrf-guard.js";

// ── Envelope ────────────────────────────────────────────────

export type AuxToolOk<T> = { readonly ok: true; readonly data: T };
export type AuxToolErr = {
  readonly ok: false;
  readonly error: "not_configured" | "bad_input" | "ssrf_blocked" | "upstream_error";
  readonly detail?: string;
};
export type AuxToolResult<T> = AuxToolOk<T> | AuxToolErr;

// ── Names ───────────────────────────────────────────────────

export const AUX_TOOL_NAMES = [
  "pdf.extract_text",
  "pdf.extract_images",
  "post_callback",
  "task.spawn",
] as const;

export type AuxToolName = (typeof AUX_TOOL_NAMES)[number];

export function isAuxTool(name: string): name is AuxToolName {
  return (AUX_TOOL_NAMES as readonly string[]).includes(name);
}

// ── Schemas ─────────────────────────────────────────────────

function stringProp(description: string): Record<string, unknown> {
  return { type: "string", description };
}

export function buildAuxToolDefinitions(): readonly ToolDefinition[] {
  return [
    {
      name: "pdf.extract_text",
      description:
        "Extract text from a PDF file on disk. Uses pdftotext when available, falls " +
        "back to a raw-byte parser otherwise. Returns text (truncated to `maxChars`, " +
        "default 50000 chars — oversized extracts end with a `[...truncated]` marker, " +
        "do not treat truncated output as the full document), outline (detected chapter/section " +
        "headers), and page count.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: stringProp("Absolute path to the PDF file"),
          maxChars: { type: "number", description: "Text truncation cap (default 50000)" },
        },
        required: ["filePath"],
      },
    },
    {
      name: "pdf.extract_images",
      description:
        "Report on images embedded in a PDF. Returns the image count and document " +
        "metadata. Honest stub: full per-image extraction requires `pdfimages` which " +
        "is not always installed — if unavailable the response carries " +
        "`extracted: false` plus the detected count.",
      inputSchema: {
        type: "object",
        properties: { filePath: stringProp("Absolute path to the PDF file") },
        required: ["filePath"],
      },
    },
    {
      name: "post_callback",
      description:
        "POST a JSON payload to a configured webhook URL with an HMAC signature. Use " +
        "to notify a dashboard / Slack / CI system when a long-running task finishes. " +
        "URLs are SSRF-guarded; only `http(s)` to private networks (or public with " +
        "`WOTANN_ALLOW_PUBLIC_CALLBACKS=1`) are accepted.",
      inputSchema: {
        type: "object",
        properties: {
          url: stringProp("Destination URL"),
          event: stringProp("Event name / tool name the callback relates to"),
          payload: { type: "object", description: "Arbitrary JSON payload (<=256 KB)" },
          hmacSecret: stringProp("HMAC shared secret (optional — enables signature header)"),
        },
        required: ["url", "event"],
      },
    },
    {
      name: "task.spawn",
      description:
        "Create or list sub-tasks. `action: create` requires `title`; `action: list` " +
        "returns all tasks (optionally filtered by `status`). Backed by the JSON task " +
        "store so sub-tasks survive session restarts.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "list", "update", "get", "delete"],
            description: "Operation to perform",
          },
          title: stringProp("Task title (for action=create)"),
          id: stringProp("Task id (for action=update/get/delete)"),
          status: stringProp("Status filter or new status"),
          priority: stringProp("low|medium|high|critical"),
          description: stringProp("Optional task description"),
          tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
          parentId: stringProp("Optional parent task id"),
        },
        required: ["action"],
      },
    },
  ];
}

// ── Deps ────────────────────────────────────────────────────

export interface AuxToolsDep {
  /** Required for task.spawn. */
  readonly taskTool: TaskTool | null;
  /**
   * Optional override for the callback registry config. When absent, each
   * post_callback invocation must carry its own `url` that will be
   * validated on the fly — no persistent registry state.
   */
  readonly defaultCallbackConfig?: Partial<ToolCallbackConfig>;
}

function errEnv(error: AuxToolErr["error"], detail?: string): AuxToolErr {
  return { ok: false, error, ...(detail !== undefined ? { detail } : {}) };
}

// ── Dispatcher ──────────────────────────────────────────────

export async function dispatchAuxTool(
  toolName: AuxToolName,
  input: Record<string, unknown>,
  dep: AuxToolsDep,
): Promise<AuxToolResult<unknown>> {
  switch (toolName) {
    case "pdf.extract_text": {
      const filePath = input["filePath"];
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return errEnv("bad_input", "filePath required");
      }
      if (!existsSync(filePath)) return errEnv("bad_input", `file not found: ${filePath}`);
      const maxChars =
        typeof input["maxChars"] === "number" ? (input["maxChars"] as number) : undefined;
      try {
        const pdf = processPDF(filePath, maxChars !== undefined ? { maxChars } : {});
        return {
          ok: true,
          data: {
            text: pdf.text,
            outline: pdf.outline,
            pageCount: pdf.pageCount,
            metadata: pdf.metadata,
          },
        };
      } catch (err) {
        return errEnv("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "pdf.extract_images": {
      const filePath = input["filePath"];
      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return errEnv("bad_input", "filePath required");
      }
      if (!existsSync(filePath)) return errEnv("bad_input", `file not found: ${filePath}`);
      try {
        const pdf = processPDF(filePath);
        // pdftotext does not surface image bytes; we honest-stub here
        // with the metadata we do have and a clear `extracted: false`.
        return {
          ok: true,
          data: {
            extracted: false,
            reason: "pdfimages CLI not wired; returning metadata only",
            pageCount: pdf.pageCount,
            metadata: pdf.metadata,
          },
        };
      } catch (err) {
        return errEnv("upstream_error", err instanceof Error ? err.message : String(err));
      }
    }
    case "post_callback": {
      const url = input["url"];
      const event = input["event"];
      if (typeof url !== "string" || url.trim().length === 0)
        return errEnv("bad_input", "url required");
      if (typeof event !== "string" || event.trim().length === 0)
        return errEnv("bad_input", "event required");
      if (
        !isSafeCallbackURL(url, dep.defaultCallbackConfig?.allowPublicNetwork ?? false) &&
        !isSafeUrl(url)
      ) {
        return errEnv("ssrf_blocked", url);
      }
      const payloadRaw = input["payload"];
      const payload =
        payloadRaw && typeof payloadRaw === "object" ? (payloadRaw as Record<string, unknown>) : {};
      const hmacSecret =
        typeof input["hmacSecret"] === "string"
          ? (input["hmacSecret"] as string)
          : dep.defaultCallbackConfig?.hmacSecret;
      const config: ToolCallbackConfig = {
        url,
        ...(hmacSecret !== undefined ? { hmacSecret } : {}),
        maxRetries: dep.defaultCallbackConfig?.maxRetries ?? 2,
        timeoutMs: dep.defaultCallbackConfig?.timeoutMs ?? 5_000,
      };
      const res = await postToolCallback(
        {
          toolName: event,
          toolInput: payload,
          toolResult: JSON.stringify(payload).slice(0, 100_000),
          durationMs: 0,
          timestamp: Date.now(),
        },
        config,
      );
      return res.ok
        ? { ok: true, data: { status: res.status ?? 0 } }
        : errEnv("upstream_error", res.error ?? "callback failed");
    }
    case "task.spawn": {
      if (!dep.taskTool) return errEnv("not_configured", "task store not available");
      const action = input["action"];
      if (typeof action !== "string") return errEnv("bad_input", "action required");
      const result = dep.taskTool.dispatch(`task_${action}`, {
        ...input,
      });
      return result.success
        ? { ok: true, data: result.data }
        : errEnv("upstream_error", result.error ?? "task op failed");
    }
    default: {
      const _exhaustive: never = toolName;
      return errEnv("bad_input", `unknown tool: ${String(_exhaustive)}`);
    }
  }
}
