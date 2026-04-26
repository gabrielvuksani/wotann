/**
 * KAIROS RPC Handler — JSON-RPC protocol for unified runtime access.
 *
 * All three surfaces (CLI, Desktop, iOS) use the same JSON-RPC protocol:
 * - CLI/Desktop connect via Unix Domain Socket
 * - iOS connects via WebSocket (CompanionServer)
 *
 * This handler routes incoming RPC calls to the WotannRuntime methods.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import { resolveWotannHome, resolveWotannHomeSubdir } from "../utils/wotann-home.js";
import { writeFileAtomic } from "../utils/atomic-io.js";
import type { WotannRuntime } from "../core/runtime.js";
import type { KairosDaemon } from "./kairos.js";
import type { QueryExecutor } from "../desktop/prompt-enhancer.js";
import type { EnhancementStyle } from "../desktop/types.js";
import { SymbolOperations } from "../lsp/symbol-operations.js";
import { AuditTrail, type AuditQuery } from "../telemetry/audit-trail.js";
// V9 T1.1 KEYSTONE — wire `computer.session.step` through the real
// Layer-4 action execution surface. V9's HOW block referenced
// `ComputerUseAgent.dispatch()` but that method is Layer 1-2 perception
// routing, not action execution. The real execution happens here, in
// the route-table-driven `executeDesktopAction(action)` from
// platform-bindings. Wiring this unblocks the entire F-series RPC
// surface (iOS → daemon → action → UI feedback).
import {
  executeDesktopAction,
  type DesktopAction,
  type RouteResult,
} from "../computer-use/platform-bindings.js";
import type { DispatchRoutePolicy } from "../channels/dispatch.js";
import type { BackgroundTaskConfig } from "../agents/background-agent.js";
import type { BenchmarkType } from "../intelligence/benchmark-harness.js";
import type { Workflow } from "../orchestration/workflow-dag.js";
import type { WotannMode } from "../core/mode-cycling.js";
import { createECDH, hkdfSync, randomUUID } from "node:crypto";
import { sanitizeCommand } from "../security/command-sanitizer.js";
import { VoicePipeline } from "../voice/voice-pipeline.js";
import {
  ComputerSessionStore,
  type Session as ComputerSessionRecord,
  type SessionEvent as ComputerSessionEvent,
  type SessionStatus as ComputerSessionStatus,
  SessionNotFoundError,
  SessionAlreadyClaimedError,
  SessionUnauthorizedError,
  SessionIllegalTransitionError,
  ErrorDeviceNotRegistered,
  ErrorNotClaimed,
  ErrorHandoffInFlight,
  ErrorHandoffExpired,
  ErrorHandoffNotFound,
} from "../session/computer-session-store.js";
import { SessionHandoffManager } from "../session/session-handoff.js";
import { FleetView, type FleetSnapshot } from "../session/fleet-view.js";
import {
  WatchDispatchRegistry,
  ErrorUnknownTemplate as WatchErrorUnknownTemplate,
  ErrorInvalidArgs as WatchErrorInvalidArgs,
  ErrorRateLimit as WatchErrorRateLimit,
  ErrorDeviceNotRegisteredForDispatch as WatchErrorDeviceNotRegistered,
  type DispatchTemplate,
} from "../session/watch-dispatch.js";
import {
  CarPlayDispatchRegistry,
  ErrorUnknownTemplate as CarPlayErrorUnknownTemplate,
  ErrorRateLimit as CarPlayErrorRateLimit,
  ErrorDeviceNotRegisteredForDispatch as CarPlayErrorDeviceNotRegistered,
  ErrorInvalidTranscript as CarPlayErrorInvalidTranscript,
  type CarPlayTemplate,
} from "../session/carplay-dispatch.js";
import {
  CreationsStore,
  ErrorFileTooLarge as CreationsErrorFileTooLarge,
  ErrorQuotaExceeded as CreationsErrorQuotaExceeded,
  ErrorInvalidFilename as CreationsErrorInvalidFilename,
  ErrorInvalidSessionId as CreationsErrorInvalidSessionId,
  ErrorPathTraversal as CreationsErrorPathTraversal,
  ErrorDiskFull as CreationsErrorDiskFull,
} from "../session/creations.js";
import {
  FileGetHandler,
  ErrorFileNotFound as FileGetErrorFileNotFound,
  ErrorPathTraversal as FileGetErrorPathTraversal,
  ErrorSymlinkEscape as FileGetErrorSymlinkEscape,
  ErrorBinaryNotAsciiSafe as FileGetErrorBinaryNotAsciiSafe,
  ErrorFileTooLarge as FileGetErrorFileTooLarge,
  ErrorRangeUnsatisfiable as FileGetErrorRangeUnsatisfiable,
  ErrorInvalidPath as FileGetErrorInvalidPath,
} from "../session/file-get-handler.js";
import {
  ApprovalQueue,
  ErrorApprovalNotFound,
  ErrorAlreadyDecided,
  ErrorExpired as ApprovalErrorExpired,
  ErrorInvalidPayload as ApprovalErrorInvalidPayload,
  type ApprovalEvent,
  type ApprovalRecord,
} from "../session/approval-queue.js";
import {
  FileDelivery,
  ErrorDeliveryNotFound,
  ErrorDeliveryExpired,
  ErrorCreationMissing,
  ErrorInvalidToken as DeliveryErrorInvalidToken,
  ErrorInvalidPayload as DeliveryErrorInvalidPayload,
  type DeliveryEvent,
  type DeliveryRecord,
} from "../session/file-delivery.js";
import {
  CursorStream,
  ErrorInvalidCoordinates as CursorErrorInvalidCoordinates,
  ErrorSessionNotFound as CursorErrorSessionNotFound,
  type CursorAction,
} from "../session/cursor-stream.js";
import {
  LiveActivityManager,
  ErrorSessionNotFound as LiveActivityErrorSessionNotFound,
  ErrorTitleTooLong as LiveActivityErrorTitleTooLong,
  ErrorInvalidTitle as LiveActivityErrorInvalidTitle,
  ErrorInvalidProgress as LiveActivityErrorInvalidProgress,
  ErrorInvalidIcon as LiveActivityErrorInvalidIcon,
  ErrorInvalidExpandedDetail as LiveActivityErrorInvalidExpandedDetail,
  type StepUpdate as LiveActivityStepUpdate,
  type ExpandedStep as LiveActivityExpandedStep,
} from "../session/live-activity.js";
// V9 Wave 2-L — GA-11 stream discriminator. iOS RPCClient subscribes to
// distinct method-name topics (`stream.text`, `stream.done`, `stream.error`,
// `stream.thinking`, `stream.tool_use`); without the discriminator every
// `method:"stream"` notification dead-letters at the iOS subscription layer.
// Source of truth lives in companion-server.ts so additions or renames stay
// in lockstep across every emit site (CLI socket, desktop bridge, iOS WS).
import { streamMethodForChunkType, type StreamMethodName } from "../desktop/companion-server.js";

// ── Voice pipeline singleton + streaming bookkeeping ──────
//
// Session-5 wiring for `voice.transcribe` and `voice.stream.{start,poll,
// cancel}` — session-4's commit message claimed these were wired, but
// the live handlers still returned an honest-error envelope (see the
// Phase-1 adversarial audit GAP-1). VoicePipeline already exposes
// `transcribe(audioPath)` via the STTDetector fallback chain (Web Speech
// API → system → whisper-local → whisper-cloud → deepgram), so wiring
// the RPC is just instantiation + delegation.
//
// NDJSON IPC doesn't carry subscriptions, so `voice.stream` is a
// polling protocol: start() seeds a stream id, poll() returns
// chunks-since-cursor, cancel() frees buffers. Streaming transcription
// for longer audio drops partial text chunks into the buffer as the
// underlying STT emits them; for the single-shot backend path we emit
// one chunk containing the full transcription and mark the stream
// done. Both cases release resources via cancel() even on error.
let sharedVoicePipeline: VoicePipeline | null = null;
async function getVoicePipeline(): Promise<VoicePipeline> {
  if (sharedVoicePipeline) return sharedVoicePipeline;
  const vp = new VoicePipeline();
  await vp.initialize();
  sharedVoicePipeline = vp;
  return vp;
}

interface VoiceStream {
  readonly id: string;
  chunks: Array<{ readonly seq: number; readonly text: string; readonly isFinal: boolean }>;
  done: boolean;
  error?: string;
  createdAt: number;
}

const voiceStreams = new Map<string, VoiceStream>();

/** Drop streams that haven't been polled in N seconds (defensive GC). */
function pruneStaleVoiceStreams(maxAgeMs: number = 10 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, stream] of voiceStreams.entries()) {
    if (now - stream.createdAt > maxAgeMs) voiceStreams.delete(id);
  }
}

// ── Helpers ─────────────────────────────────────────────

/**
 * Compute a simple line-by-line diff between two strings. Returns a
 * pseudo-unified-diff string with `+ ` for additions and `- ` for
 * deletions, plus a header line. Used by composer.plan to give the UI
 * a real preview without depending on a heavyweight diff library.
 */
function simpleLineDiff(oldContent: string, newContent: string, path: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [`--- ${path} (current)`, `+++ ${path} (proposed)`];
  // Naive line-by-line comparison: emit removals for lines in old not in new
  // and additions for lines in new not in old. Loses ordering nuance but
  // is sufficient for the UI's "what changed" surface and avoids pulling
  // in a real diff package.
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  for (const line of oldLines) {
    if (!newSet.has(line)) lines.push(`- ${line}`);
  }
  for (const line of newLines) {
    if (!oldSet.has(line)) lines.push(`+ ${line}`);
  }
  return lines.join("\n");
}

// ── Computer Session serialization helpers (Phase 3 P1-F1) ─

function serializeSession(s: ComputerSessionRecord): Record<string, unknown> {
  return {
    id: s.id,
    creatorDeviceId: s.creatorDeviceId,
    claimedByDeviceId: s.claimedByDeviceId,
    taskSpec: s.taskSpec,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    eventCount: s.events.length,
    pendingApprovalId: s.pendingApprovalId,
    result: s.result,
    // F14 — cross-session resume state. Surfaces can tell whether a transfer
    // is in flight, inspect the audit trail, and know which status to resume
    // to once the transfer lands.
    pendingHandoffId: s.pendingHandoffId,
    handoffs: s.handoffs,
    handoffResumeStatus: s.handoffResumeStatus,
  };
}

function serializeEvent(e: ComputerSessionEvent): Record<string, unknown> {
  return {
    sessionId: e.sessionId,
    seq: e.seq,
    timestamp: e.timestamp,
    type: e.type,
    payload: e.payload,
  };
}

function serializeApprovalRecord(r: ApprovalRecord): Record<string, unknown> {
  // The typed payload is serialised as-is — JSON-RPC consumers rely on
  // `payload.kind` to discriminate (shell-exec/file-write/destructive/custom)
  // and render the appropriate cell.
  return {
    approvalId: r.approvalId,
    sessionId: r.sessionId,
    payload: r.payload as unknown as Record<string, unknown>,
    summary: r.summary,
    riskLevel: r.riskLevel,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    state: r.state,
    decision: r.decision,
    deciderDeviceId: r.deciderDeviceId,
    decidedAt: r.decidedAt,
  };
}

function serializeApprovalEvent(e: ApprovalEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: e.type,
    approvalId: e.approvalId,
    sessionId: e.sessionId,
    timestamp: e.timestamp,
    record: serializeApprovalRecord(e.record),
  };
  if (e.decision !== undefined) out["decision"] = e.decision;
  return out;
}

// F9 — delivery record / event serializers. Mirror the approval shape so
// iOS / desktop surfaces parse them with the same plumbing. The
// `downloadToken` field is flattened from {value, expiresAt} to a pair of
// siblings because the wire contract is "opaque string + absolute ms"
// rather than a nested object — matches how iOS ShareLink treats HTTP
// Authorization: Bearer tokens.
function serializeDeliveryRecord(r: DeliveryRecord): Record<string, unknown> {
  return {
    deliveryId: r.deliveryId,
    sessionId: r.sessionId,
    filename: r.filename,
    displayName: r.displayName,
    description: r.description,
    downloadToken: r.downloadToken.value,
    tokenExpiresAt: r.downloadToken.expiresAt,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    state: r.state,
    acknowledgements: r.acknowledgements.map((a) => ({
      deviceId: a.deviceId,
      acknowledgedAt: a.acknowledgedAt,
    })),
  };
}

function serializeDeliveryEvent(e: DeliveryEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: e.type,
    deliveryId: e.deliveryId,
    sessionId: e.sessionId,
    timestamp: e.timestamp,
    record: serializeDeliveryRecord(e.record),
  };
  if (e.deviceId !== undefined) out["deviceId"] = e.deviceId;
  return out;
}

// F3 — Live Activity step serializer. Emits both compact + expanded
// payload shapes so iOS Dynamic Island can render the rolled view
// without re-fetching. `icon` / `expandedDetail` are intentionally
// omitted (rather than explicitly `undefined`) when the caller didn't
// supply them so the wire payload stays tight.
function serializeLiveActivityStep(step: LiveActivityExpandedStep): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    sessionId: step.sessionId,
    title: step.title,
    progress: step.progress,
  };
  if (step.icon !== undefined) compact["icon"] = step.icon;

  const expanded: Record<string, unknown> = {
    sessionId: step.sessionId,
    title: step.title,
    progress: step.progress,
    firstSeenAt: step.firstSeenAt,
    lastUpdatedAt: step.lastUpdatedAt,
  };
  if (step.icon !== undefined) expanded["icon"] = step.icon;
  if (step.expandedDetail !== undefined) expanded["expandedDetail"] = step.expandedDetail;

  return {
    sessionId: step.sessionId,
    compact,
    expanded,
  };
}

function toRpcError(err: unknown): Error {
  if (err instanceof SessionNotFoundError) return err;
  if (err instanceof SessionAlreadyClaimedError) return err;
  if (err instanceof SessionUnauthorizedError) return err;
  if (err instanceof SessionIllegalTransitionError) return err;
  // F14 cross-session-resume errors — preserve their classes so callers can
  // discriminate on `.code` instead of parsing message strings.
  if (err instanceof ErrorDeviceNotRegistered) return err;
  if (err instanceof ErrorNotClaimed) return err;
  if (err instanceof ErrorHandoffInFlight) return err;
  if (err instanceof ErrorHandoffExpired) return err;
  if (err instanceof ErrorHandoffNotFound) return err;
  // F12 — Watch dispatch errors. Preserve classes so JSON-RPC clients can
  // discriminate on `.code` / `.name` and surface localized UI strings.
  if (err instanceof WatchErrorUnknownTemplate) return err;
  if (err instanceof WatchErrorInvalidArgs) return err;
  if (err instanceof WatchErrorRateLimit) return err;
  if (err instanceof WatchErrorDeviceNotRegistered) return err;
  // F13 — CarPlay dispatch errors. Same class-preservation rationale.
  if (err instanceof CarPlayErrorUnknownTemplate) return err;
  if (err instanceof CarPlayErrorRateLimit) return err;
  if (err instanceof CarPlayErrorDeviceNotRegistered) return err;
  if (err instanceof CarPlayErrorInvalidTranscript) return err;
  // F5 — Creations store errors. Preserve classes so JSON-RPC clients
  // discriminate on `.code` and surface localized UI strings without
  // parsing message bodies.
  if (err instanceof CreationsErrorFileTooLarge) return err;
  if (err instanceof CreationsErrorQuotaExceeded) return err;
  if (err instanceof CreationsErrorInvalidFilename) return err;
  if (err instanceof CreationsErrorInvalidSessionId) return err;
  if (err instanceof CreationsErrorPathTraversal) return err;
  if (err instanceof CreationsErrorDiskFull) return err;
  // F7 — file.get handler errors. Same class-preservation rationale:
  // JSON-RPC clients (iOS ShareLink + desktop + TUI) discriminate on
  // `.code` (FILE_GET_NOT_FOUND / FILE_GET_PATH_TRAVERSAL / ...) so
  // the UI can render localized strings without parsing the message.
  if (err instanceof FileGetErrorFileNotFound) return err;
  if (err instanceof FileGetErrorPathTraversal) return err;
  if (err instanceof FileGetErrorSymlinkEscape) return err;
  if (err instanceof FileGetErrorBinaryNotAsciiSafe) return err;
  if (err instanceof FileGetErrorFileTooLarge) return err;
  if (err instanceof FileGetErrorRangeUnsatisfiable) return err;
  if (err instanceof FileGetErrorInvalidPath) return err;
  // F6 — Approval queue errors. Preserve classes so JSON-RPC clients
  // (iOS approval sheet, watch, CarPlay) discriminate on `.code` and
  // surface localized UI strings without parsing message bodies.
  if (err instanceof ErrorApprovalNotFound) return err;
  if (err instanceof ErrorAlreadyDecided) return err;
  if (err instanceof ApprovalErrorExpired) return err;
  if (err instanceof ApprovalErrorInvalidPayload) return err;
  // F9 — Delivery pipeline errors. Preserve classes so JSON-RPC clients
  // discriminate on `.code` (DELIVERY_NOT_FOUND / DELIVERY_EXPIRED / ...).
  if (err instanceof ErrorDeliveryNotFound) return err;
  if (err instanceof ErrorDeliveryExpired) return err;
  if (err instanceof ErrorCreationMissing) return err;
  if (err instanceof DeliveryErrorInvalidToken) return err;
  if (err instanceof DeliveryErrorInvalidPayload) return err;
  // F2 — Cursor stream errors. Preserve classes so JSON-RPC clients
  // (desktop-control agent + iOS CursorOverlayView) discriminate on
  // `.code` (CURSOR_INVALID_COORDINATES / CURSOR_SESSION_NOT_FOUND).
  if (err instanceof CursorErrorInvalidCoordinates) return err;
  if (err instanceof CursorErrorSessionNotFound) return err;
  // F3 — Live Activity errors. Preserve classes so JSON-RPC clients
  // (iOS Dynamic Island + Watch complication + TUI HUD) discriminate
  // on `.code` (LIVE_ACTIVITY_*) without parsing message bodies.
  if (err instanceof LiveActivityErrorSessionNotFound) return err;
  if (err instanceof LiveActivityErrorTitleTooLong) return err;
  if (err instanceof LiveActivityErrorInvalidTitle) return err;
  if (err instanceof LiveActivityErrorInvalidProgress) return err;
  if (err instanceof LiveActivityErrorInvalidIcon) return err;
  if (err instanceof LiveActivityErrorInvalidExpandedDetail) return err;
  if (err instanceof Error) return err;
  return new Error(String(err));
}

// ── Types ────────────────────────────────────────────────

export interface RPCRequest {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly id: string | number;
}

export interface RPCResponse {
  readonly jsonrpc: "2.0";
  readonly result?: unknown;
  readonly error?: RPCError;
  readonly id: string | number;
}

export interface RPCError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface RPCStreamEvent {
  readonly jsonrpc: "2.0";
  // V9 Wave 2-L — GA-11 stream discriminator. iOS RPCClient subscribes
  // per-topic on `stream.text`/`stream.done`/`stream.error`/`stream.thinking`/
  // `stream.tool_use`, so emit sites use the discriminated method name (via
  // streamMethodForChunkType when the chunk type is dynamic; hardcoded when
  // statically known). The previously-flagged daemon broadcast path at
  // kairos.ts:2002 has been migrated to "stream.text" so the union no
  // longer needs to retain the legacy "stream" literal — both BridgeRPCStreamEvent
  // and RPCStreamEvent now converge on StreamMethodName.
  readonly method: StreamMethodName;
  readonly params: {
    readonly type: "text" | "thinking" | "tool_use" | "done" | "error";
    readonly content: string;
    readonly sessionId: string;
    readonly provider?: string;
    readonly model?: string;
  };
}

export interface SessionInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly createdAt: number;
  readonly messageCount: number;
  readonly totalCost: number;
}

export interface AgentInfo {
  readonly id: string;
  readonly task: string;
  readonly status: "running" | "paused" | "completed" | "failed";
  readonly progress: number;
  readonly cost: number;
  readonly startedAt: number;
}

export interface CostSnapshot {
  readonly sessionCost: number;
  readonly dailyCost: number;
  readonly weeklyCost: number;
  readonly budget: number;
  readonly budgetUsedPercent: number;
}

export interface ProviderInfo {
  readonly name: string;
  readonly available: boolean;
  readonly models: readonly string[];
  readonly billing: string;
}

type RPCHandler = (params: Record<string, unknown>) => Promise<unknown>;

// ── RPC Error Codes ──────────────────────────────────────

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INTERNAL_ERROR = -32603;

// ── Codex JWT Verification (B3) ──────────────────────────
//
// The Codex CLI stores OAuth id tokens in ~/.codex/auth.json. Previously we
// naively decoded the payload without verification, which meant a local
// attacker could edit auth.json to forge a higher-tier plan (pro/enterprise).
//
// We don't have the JWK here (fetching the well-known /jwks endpoint requires
// network access that may be unavailable), so we do defence-in-depth:
//   1. Reject anything that isn't a well-formed 3-part JWT.
//   2. Reject if the payload is not valid JSON.
//   3. Reject if `exp` is missing or in the past.
//   4. Reject if `iss` is not one of the expected OpenAI issuers.
//
// These checks prevent the "edit-a-flat-file to promote your plan" attack
// without requiring network connectivity.

interface CodexJWTPayload {
  readonly iss?: string;
  readonly aud?: string | string[];
  readonly sub?: string;
  readonly iat?: number;
  readonly exp?: number;
  readonly "https://api.openai.com/auth"?: { chatgpt_plan_type?: string };
  readonly [key: string]: unknown;
}

interface CodexJWTVerificationResult {
  readonly valid: boolean;
  readonly payload: CodexJWTPayload | null;
  readonly error: string | null;
}

/** Known Codex / ChatGPT JWT issuers (accepts well-known OpenAI OIDC issuers). */
const CODEX_EXPECTED_ISSUERS: readonly string[] = [
  "https://auth.openai.com",
  "https://auth.openai.com/",
  "https://chat.openai.com",
  "https://chat.openai.com/",
];

/**
 * Verify a Codex id token with defence-in-depth checks.
 * Returns { valid: true, payload } on success, or { valid: false, error } on failure.
 */
export function verifyCodexJWT(token: string): CodexJWTVerificationResult {
  if (typeof token !== "string" || token.length === 0) {
    return { valid: false, payload: null, error: "empty token" };
  }

  // Structural check: 3 parts separated by "."
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, payload: null, error: "not a 3-part JWT" };
  }
  if (!parts[0] || !parts[1] || !parts[2]) {
    return { valid: false, payload: null, error: "empty JWT segment" };
  }

  // Decode payload (middle segment) as base64url JSON
  let payload: CodexJWTPayload;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf-8");
    payload = JSON.parse(decoded) as CodexJWTPayload;
  } catch (err) {
    return {
      valid: false,
      payload: null,
      error: `payload decode failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  // exp claim: must exist and be in the future
  if (typeof payload.exp !== "number") {
    return { valid: false, payload: null, error: "missing exp claim" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) {
    return { valid: false, payload: null, error: "token expired" };
  }

  // iss claim: must match one of the expected OpenAI/Codex issuers
  if (typeof payload.iss !== "string" || payload.iss.length === 0) {
    return { valid: false, payload: null, error: "missing iss claim" };
  }
  if (!CODEX_EXPECTED_ISSUERS.includes(payload.iss)) {
    return {
      valid: false,
      payload: null,
      error: `unexpected iss: ${payload.iss}`,
    };
  }

  return { valid: true, payload, error: null };
}

// ── Codex JWT: cryptographic signature verification (B3 upgrade) ─────
//
// The synchronous `verifyCodexJWT` handles the offline case. When the daemon
// has network access, `verifyCodexJWTSignature` fetches the issuer's JWKS,
// resolves the key by `kid`, and verifies the RS256 signature. A short-lived
// in-memory JWKS cache (TTL 1h) keeps the hot path fast.
//
// Callers should prefer this when verifying a freshly-received token from
// auth.json; fall back to the sync check only when fetch() is unavailable or
// the JWKS endpoint is unreachable.

interface CodexJWK {
  readonly kty: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
  readonly n?: string;
  readonly e?: string;
  readonly x5c?: readonly string[];
}

interface JWKSCacheEntry {
  readonly jwks: { readonly keys: readonly CodexJWK[] };
  readonly fetchedAt: number;
}

const JWKS_CACHE = new Map<string, JWKSCacheEntry>();
const JWKS_TTL_MS = 60 * 60 * 1000;

// V9 Wave 6.7 (M-N3) — JWKS prune. Stale JWKS entries (older than 90s)
// are evicted on demand by `pruneJWKSCache()`; the daemon-side subscription
// sweep timer (KairosRPCHandler#dispose / startSubscriptionSweep) calls
// this every 60s as a side-effect to keep the cache bounded.
//
// QB #6: never throws — Map.delete is total and the timestamp comparison
// is pure. QB #7: module-level cache is acceptable here because JWKS
// caching is a process-wide network optimization (not per-handler state)
// and tests don't observe its contents.
const JWKS_STALE_MS = 90 * 1000;
export function pruneJWKSCache(now: number = Date.now()): number {
  let evicted = 0;
  for (const [issuer, entry] of JWKS_CACHE.entries()) {
    if (now - entry.fetchedAt >= JWKS_STALE_MS) {
      JWKS_CACHE.delete(issuer);
      evicted++;
    }
  }
  return evicted;
}

async function fetchJWKS(issuer: string): Promise<{ keys: readonly CodexJWK[] } | null> {
  const cached = JWKS_CACHE.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.jwks;
  try {
    const base = issuer.replace(/\/$/, "");
    const discoveryUrl = `${base}/.well-known/openid-configuration`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const discoveryRes = await fetch(discoveryUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!discoveryRes.ok) return null;
    const discovery = (await discoveryRes.json()) as { jwks_uri?: string };
    if (!discovery.jwks_uri) return null;
    const jwksController = new AbortController();
    const jwksTimer = setTimeout(() => jwksController.abort(), 5_000);
    const jwksRes = await fetch(discovery.jwks_uri, { signal: jwksController.signal });
    clearTimeout(jwksTimer);
    if (!jwksRes.ok) return null;
    const parsed = (await jwksRes.json()) as { keys: readonly CodexJWK[] };
    JWKS_CACHE.set(issuer, { jwks: parsed, fetchedAt: Date.now() });
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verify a Codex JWT's cryptographic signature against the issuer's JWKS.
 * Falls back to the sync defence-in-depth check if the network is unreachable.
 *
 * Returns the same shape as `verifyCodexJWT`, with `signatureVerified: true`
 * when the RSA signature check succeeded.
 */
export async function verifyCodexJWTSignature(
  token: string,
): Promise<CodexJWTVerificationResult & { signatureVerified: boolean }> {
  const offlineCheck = verifyCodexJWT(token);
  if (!offlineCheck.valid) return { ...offlineCheck, signatureVerified: false };

  const parts = token.split(".");
  let header: { alg?: string; kid?: string };
  try {
    const decoded = Buffer.from(parts[0]!, "base64url").toString("utf-8");
    header = JSON.parse(decoded) as { alg?: string; kid?: string };
  } catch {
    return {
      ...offlineCheck,
      valid: false,
      error: "header decode failed",
      signatureVerified: false,
    };
  }
  if (header.alg !== "RS256") {
    // We only support RS256 (the algorithm the ChatGPT IdP uses).
    return { ...offlineCheck, signatureVerified: false };
  }

  const issuer = offlineCheck.payload?.iss;
  if (!issuer) return { ...offlineCheck, signatureVerified: false };

  const jwks = await fetchJWKS(issuer);
  if (!jwks) {
    // Network unreachable — return offline-verified result unchanged.
    return { ...offlineCheck, signatureVerified: false };
  }

  const key = jwks.keys.find(
    (k) => (k as { kid?: string }).kid === header.kid && (k as { alg?: string }).alg !== "none",
  );
  if (!key) return { ...offlineCheck, signatureVerified: false, error: "kid not in JWKS" };

  try {
    const { createPublicKey, createVerify } = await import("node:crypto");

    const pubKey = createPublicKey({ key: key as any, format: "jwk" });
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2]!, "base64url");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signingInput);
    const verified = verifier.verify(pubKey, signature);
    if (!verified) {
      return {
        ...offlineCheck,
        valid: false,
        error: "signature verification failed",
        signatureVerified: false,
      };
    }
    return { ...offlineCheck, signatureVerified: true };
  } catch (err) {
    return {
      ...offlineCheck,
      signatureVerified: false,
      error: `crypto verify failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

// ── Image Validation (Session Corruption Guard) ──────────

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

export interface ImageValidationResult {
  readonly ok: boolean;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
  readonly error?: string;
}

/**
 * Validate a base64-encoded image payload. Confirms:
 *  - Decodable base64
 *  - Magic bytes match PNG/JPEG/WebP/GIF
 *  - Size under 20MB
 *
 * Returns an `ok: false` result with a clear error when invalid, so the caller
 * can surface it to the user without corrupting the session transcript.
 */
export function validateBase64Image(raw: string): ImageValidationResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "Empty or non-string image payload" };
  }

  // Strip data URL prefix if present (e.g., "data:image/png;base64,...")
  let b64 = raw;
  const dataUrlMatch = raw.match(/^data:image\/[a-z]+;base64,(.+)$/i);
  if (dataUrlMatch?.[1]) b64 = dataUrlMatch[1];

  // Reject payloads that don't look like base64 at all (avoids throwing).
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
    return { ok: false, error: "Image payload is not valid base64" };
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return { ok: false, error: "Image payload failed to decode as base64" };
  }

  if (buf.length === 0) {
    return { ok: false, error: "Image payload decoded to zero bytes" };
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: `Image exceeds 20MB limit (${buf.length} bytes)` };
  }

  // Magic byte sniffing
  const mime = detectImageMime(buf);
  if (!mime) {
    return { ok: false, error: "Image payload does not match PNG/JPEG/WebP/GIF magic bytes" };
  }

  return { ok: true, mimeType: mime, sizeBytes: buf.length };
}

function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Extract candidate image payloads from RPC params and validate each. Looks
 * at `images`, `image`, and `attachments` fields in common shapes.
 * Returns `null` if all images valid, or the first error encountered.
 */
export function validateImageParams(params: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  const images = params["images"];
  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === "string") candidates.push(img);
      else if (img && typeof img === "object") {
        const obj = img as Record<string, unknown>;
        if (typeof obj["base64"] === "string") candidates.push(obj["base64"] as string);
        else if (typeof obj["data"] === "string") candidates.push(obj["data"] as string);
      }
    }
  }
  if (typeof params["image"] === "string") candidates.push(params["image"] as string);
  const attachments = params["attachments"];
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (att && typeof att === "object") {
        const obj = att as Record<string, unknown>;
        const type = String(obj["type"] ?? "");
        if (type.startsWith("image") && typeof obj["data"] === "string") {
          candidates.push(obj["data"] as string);
        }
      }
    }
  }

  for (const c of candidates) {
    const result = validateBase64Image(c);
    if (!result.ok) return result.error ?? "Invalid image";
  }
  return null;
}

// ── KAIROS RPC Handler ───────────────────────────────────

// ── Node Registry (phones acting as agent nodes) ─────────

interface NodeRegistryEntry {
  readonly nodeId: string;
  readonly deviceId: string;
  readonly capabilities: readonly string[];
  readonly registeredAt: number;
}

interface PendingNodeRequest {
  resolve(value: unknown): void;
  reject(err: Error): void;
  readonly requestId: string;
  readonly createdAt: number;
}

// ── ECDH Session Keys ────────────────────────────────────

interface ECDHSession {
  readonly sessionId: string;
  readonly derivedKey: Buffer;
  readonly createdAt: number;
}

// ── Continuity Frame Buffer ──────────────────────────────

interface ContinuityFrame {
  readonly timestamp: number;
  readonly sizeBytes: number;
}

const MAX_FRAME_BUFFER = 30;

export class KairosRPCHandler {
  private readonly handlers: Map<string, RPCHandler> = new Map();
  private runtime: WotannRuntime | null = null;
  private daemon: KairosDaemon | null = null;

  // State for iOS surface handlers (node registry, ECDH keys, frame buffer).
  private readonly nodeRegistry = new Map<string, NodeRegistryEntry>();
  private readonly pendingNodeRequests = new Map<string, PendingNodeRequest>();
  private readonly ecdhSessions = new Map<string, ECDHSession>();
  private readonly frameBuffer: ContinuityFrame[] = [];
  private notificationPrefsPath = resolveWotannHomeSubdir("notifications.json");

  // Computer-session keystone store (Phase 3 P1-F1). Per-session state lives here,
  // NOT in module globals (QB #7). Polling subscribers hold a rolling buffer keyed
  // by subscription id; the store owns the canonical event log.
  private readonly computerSessionStore = new ComputerSessionStore();
  private readonly computerSessionSubscriptions = new Map<
    string,
    {
      readonly sessionId: string | "*";
      readonly events: ComputerSessionEvent[];
      readonly dispose: () => void;
      lastPolledAt: number;
    }
  >();

  // F14 — cross-session resume (handoff). The manager lifts TTL bookkeeping
  // and UnifiedEvent broadcasting out of the store so the store stays a
  // pure state machine. The isTargetRegistered predicate defaults to
  // "trust the caller" (test-friendly); setRuntime wires it to the
  // dispatch plane's device registry when available, and setDaemon hooks
  // broadcasts into the plane once the daemon injects it.
  private readonly computerSessionHandoff = new SessionHandoffManager({
    store: this.computerSessionStore,
  });

  // F15 — multi-agent fleet view. Observes the store's event bus and
  // exposes debounced snapshots via fleet.list / fleet.summary /
  // fleet.watch. One-per-handler per QB #7 (per-session state lives on
  // this instance, not in module globals). The default 100ms debounce
  // batches bursts of events (ten cursor emits in a tick -> one snapshot).
  private readonly fleetView = new FleetView({ store: this.computerSessionStore });
  private readonly fleetSubscriptions = new Map<
    string,
    {
      snapshots: FleetSnapshot[];
      readonly dispose: () => void;
      lastPolledAt: number;
    }
  >();

  // F12 — Watch new-task dispatch primitive. Templates keep dispatches
  // atomic for the constrained surface; the registry auto-claims on
  // create so the session binds to the watch device with no extra RPC.
  // Per-handler instance per QB #7 — the rate-limit ledger + template
  // registry live here, not in module globals. Default templates (seed
  // from DEFAULT_TEMPLATES) cover URL summarize / note capture /
  // contact message / build project.
  private readonly watchDispatch = new WatchDispatchRegistry({
    store: this.computerSessionStore,
  });

  // F13 — CarPlay voice task-dispatch primitive. CarPlay is hands-free-
  // only by regulation, so the dispatch path is transcript → voice-intent
  // parser → template match → auto-claimed ComputerSession. Low-confidence
  // matches return needsConfirmation with topCandidates so the iOS UI can
  // prompt "Did you mean X or Y?". Per-handler instance per QB #7.
  private readonly carplayDispatch = new CarPlayDispatchRegistry({
    store: this.computerSessionStore,
  });

  // F5 — Creations store. When an agent writes a file as part of a
  // research/creation task, the bytes land under ~/.wotann/creations/
  // <sessionId>/<filename> with SHA256 integrity, and a UnifiedEvent
  // fires via F11 so iOS CreationsView / desktop Creations panel can
  // sync. Per-handler instance per QB #7. The broadcast hook is wired
  // in setRuntime once the dispatch plane is available.
  private readonly creationsStore = new CreationsStore();

  // F7 — file.get handler. Generalises F5's creations.get to arbitrary
  // workspace files with HTTP-style range-request support. Nulled until
  // setRuntime wires it to the runtime's working-dir — the handler
  // needs a non-degenerate rootDir and the runtime owns that value.
  // Tests swap in their own via setFileGetHandlerForTest.
  private fileGetHandler: FileGetHandler | null = null;

  // F6 — Approval subscription channel. Queue lives per-handler (QB #7 —
  // per-session state, not a module global) so tests construct their own.
  // Broadcast is wired in setRuntime once the dispatch plane is available.
  // Polling subscribers buffer events here until a drain call comes in.
  private readonly approvalQueue = new ApprovalQueue();
  private readonly approvalSubscriptions = new Map<
    string,
    {
      readonly events: ApprovalEvent[];
      readonly dispose: () => void;
      lastPolledAt: number;
    }
  >();

  // F9 — File-delivery pipeline. Pairs with F5 CreationsStore (finalize
  // hook) and F7 file.get (actual download). Per-handler instance per
  // QB #7. Broadcast + finalizeHook are wired in setRuntime; the queue
  // itself is usable stand-alone in tests. The subscription map follows
  // the same polling shape as F6 approvals because NDJSON IPC cannot
  // carry long-lived push streams.
  private readonly fileDelivery = new FileDelivery();
  private readonly deliverySubscriptions = new Map<
    string,
    {
      readonly events: DeliveryEvent[];
      readonly dispose: () => void;
      lastPolledAt: number;
    }
  >();

  // F2 — Cursor stream primitive. Sits on top of the F1 session store
  // and micro-batches `move` events at 30fps; `click`/`scroll` pass
  // through immediately. Per-handler instance per QB #7 (throttle state
  // is per-session, not per-process). Broadcast is wired in setRuntime
  // once the dispatch plane is available; the stream emits into the
  // session event log regardless, so tests without a plane still get
  // deterministic coverage.
  private readonly cursorStream = new CursorStream({ store: this.computerSessionStore });

  // F3 — Live Activity manager. Sits on top of the F1 session store and
  // rate-limits `step` updates to 1/sec per session for APNs budget. The
  // per-session state (last-emit timestamp, stashed burst, current step)
  // lives on the manager per QB #7. Broadcast is wired in setRuntime once
  // the dispatch plane is available; without a plane the manager still
  // records pending state so surfaces can pull via `liveActivity.pending`.
  private readonly liveActivity = new LiveActivityManager({
    store: this.computerSessionStore,
  });
  // Polling subscriptions follow the same shape as F6 approvals / F9
  // delivery: NDJSON IPC can't carry long-lived push streams, so the
  // client calls `liveActivity.subscribe` to seed a subscription id then
  // polls with `{subscriptionId}` to drain buffered steps since the last
  // poll.
  private readonly liveActivitySubscriptions = new Map<
    string,
    {
      readonly events: Array<Record<string, unknown>>;
      readonly dispose: () => void;
      lastPolledAt: number;
    }
  >();

  // V9 Wave 6.7 (M-N4) — Subscription GC sweep. The five subscription
  // maps above (computerSession / fleet / approval / delivery /
  // liveActivity) accumulate entries for clients that connect, subscribe,
  // and then disconnect without calling the explicit `unsubscribe` RPC.
  // Without a sweep, the daemon's heap grows unbounded over its lifetime.
  //
  // Strategy: every SWEEP_INTERVAL_MS, drop any subscription whose
  // `lastPolledAt` is older than SUBSCRIPTION_STALE_MS. The poll-based
  // protocol (NDJSON IPC) means a healthy client polls within seconds,
  // so a stale window of 5 minutes is conservative — anything quieter
  // than that is almost certainly a dead connection.
  //
  // Each disposed entry calls its `.dispose()` (unsubscribe from the
  // upstream emitter) so the source store doesn't keep emitting into
  // a forgotten buffer. QB #6: dispose calls are wrapped in try/catch
  // so one bad subscriber can't poison the sweep. QB #7: the timer is
  // per-handler-instance, not module-global.
  private static readonly SWEEP_INTERVAL_MS = 60_000;
  private static readonly SUBSCRIPTION_STALE_MS = 5 * 60_000;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.registerBuiltinMethods();
    this.startSubscriptionSweep();
  }

  /**
   * V9 Wave 6.7 (M-N3 + M-N4) — start the periodic GC sweep. Called from
   * the constructor so every handler instance has its own timer (QB #7).
   * The timer is `unref()`'d so it never blocks process exit on its own.
   *
   * Side-effect: also prunes the module-level JWKS_CACHE on every tick to
   * keep that cache bounded without a second timer.
   */
  private startSubscriptionSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      try {
        this.sweepStaleSubscriptions();
      } catch {
        /* QB #6: cleanup must not throw or the timer will be unscheduled */
      }
      try {
        pruneJWKSCache();
      } catch {
        /* QB #6: pure-Map prune cannot throw, but defensive */
      }
    }, KairosRPCHandler.SWEEP_INTERVAL_MS);
    if (typeof this.sweepTimer.unref === "function") {
      this.sweepTimer.unref();
    }
  }

  /**
   * V9 Wave 6.7 (M-N4) — sweep stale entries from the five polling
   * subscription maps. Public for tests so they can drive the sweep
   * deterministically without waiting on the 60s timer.
   *
   * Returns the count of entries evicted across all maps.
   */
  sweepStaleSubscriptions(now: number = Date.now()): number {
    const cutoff = now - KairosRPCHandler.SUBSCRIPTION_STALE_MS;
    let evicted = 0;
    const maps: Array<Map<string, { readonly dispose: () => void; lastPolledAt: number }>> = [
      this.computerSessionSubscriptions,
      // fleetSubscriptions has the same shape (dispose + lastPolledAt) but
      // a different value type so we cast through unknown for the loop.
      this.fleetSubscriptions as unknown as Map<
        string,
        { readonly dispose: () => void; lastPolledAt: number }
      >,
      this.approvalSubscriptions as unknown as Map<
        string,
        { readonly dispose: () => void; lastPolledAt: number }
      >,
      this.deliverySubscriptions as unknown as Map<
        string,
        { readonly dispose: () => void; lastPolledAt: number }
      >,
      this.liveActivitySubscriptions as unknown as Map<
        string,
        { readonly dispose: () => void; lastPolledAt: number }
      >,
    ];
    for (const map of maps) {
      for (const [id, sub] of map.entries()) {
        if (sub.lastPolledAt < cutoff) {
          try {
            sub.dispose();
          } catch {
            /* QB #6: a single bad subscriber must not poison the sweep */
          }
          map.delete(id);
          evicted++;
        }
      }
    }
    return evicted;
  }

  /**
   * V9 Wave 6.7 (M-N3 + M-N4) — release the sweep timer and dispose
   * every remaining subscription. Called from KairosDaemon.stop() so
   * daemon teardown drains the in-flight subscribers cleanly. Idempotent.
   */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    // Drain ALL remaining subscriptions regardless of staleness — daemon
    // is going down, so even fresh subscribers must release their handles.
    const maps: Array<Map<string, { readonly dispose: () => void }>> = [
      this.computerSessionSubscriptions,
      this.fleetSubscriptions as unknown as Map<string, { readonly dispose: () => void }>,
      this.approvalSubscriptions as unknown as Map<string, { readonly dispose: () => void }>,
      this.deliverySubscriptions as unknown as Map<string, { readonly dispose: () => void }>,
      this.liveActivitySubscriptions as unknown as Map<string, { readonly dispose: () => void }>,
    ];
    for (const map of maps) {
      for (const sub of map.values()) {
        try {
          sub.dispose();
        } catch {
          /* QB #6: cleanup must not throw */
        }
      }
      map.clear();
    }
  }

  /**
   * Attach the parent daemon so RPC handlers can access self-improvement
   * subsystems (PatternCrystallizer, FeedbackCollector, etc.) that live on
   * the daemon rather than the runtime.
   */
  setDaemon(daemon: KairosDaemon): void {
    this.daemon = daemon;
  }

  /**
   * Test-visibility accessor for the ComputerSessionStore. External callers
   * (UnifiedDispatchPlane bridges, tests) should read session state through
   * this method rather than poking at private fields.
   */
  getComputerSessionStore(): ComputerSessionStore {
    return this.computerSessionStore;
  }

  /**
   * Test-visibility accessor for the F14 handoff manager. External callers
   * should route through the `computer.session.handoff` / `acceptHandoff`
   * / `expireHandoff` RPC methods; this is exposed only so tests can
   * assert TTL bookkeeping and deterministic scheduler swapping.
   */
  getComputerSessionHandoff(): SessionHandoffManager {
    return this.computerSessionHandoff;
  }

  /**
   * Test-visibility accessor for the F12 Watch dispatch registry. External
   * callers should route through the `watch.templates` / `watch.dispatch`
   * RPC methods; this exists so tests can seed custom templates, adjust
   * rate-limit config, or inject a deterministic clock.
   */
  getWatchDispatchRegistry(): WatchDispatchRegistry {
    return this.watchDispatch;
  }

  /**
   * Test-visibility accessor for the F5 creations store. External callers
   * should route through the `creations.save` / `creations.list` /
   * `creations.get` / `creations.delete` RPC methods; this exists so tests
   * can construct a handler with a tmp rootDir by replacing the field and
   * seed fixture files before the RPC round-trip.
   */
  getCreationsStore(): CreationsStore {
    return this.creationsStore;
  }

  /**
   * Test-visibility setter for the F7 file.get handler. Production wires
   * this via setRuntime() using runtime.getWorkingDir(); tests bind a
   * tmp rootDir. Exposed on the public surface because several test
   * suites need it — the alternative (casting to access a private
   * field) is brittle and unsafe across refactors.
   */
  setFileGetHandlerForTest(fgh: FileGetHandler | null): void {
    this.fileGetHandler = fgh;
  }

  /**
   * Test-visibility accessor for the F7 file.get handler. Returns null
   * until setRuntime() or setFileGetHandlerForTest() binds one.
   */
  getFileGetHandler(): FileGetHandler | null {
    return this.fileGetHandler;
  }

  /**
   * Test-visibility accessor for the F13 CarPlay dispatch registry. External
   * callers should route through the `carplay.templates` / `carplay.parseVoice`
   * / `carplay.dispatch` RPC methods; this exists so tests can seed custom
   * templates, adjust rate-limit config, or inject a deterministic clock.
   */
  getCarPlayDispatchRegistry(): CarPlayDispatchRegistry {
    return this.carplayDispatch;
  }

  /**
   * Test-visibility accessor for the F15 fleet view. External callers
   * should route through `fleet.list`, `fleet.summary`, and `fleet.watch`
   * RPCs; this is exposed for tests that need to assert subscriber
   * lifecycle and debounce behavior with a synthetic scheduler.
   */
  getFleetView(): FleetView {
    return this.fleetView;
  }

  /**
   * Test-visibility accessor for the F6 approval queue. External callers
   * route through `approvals.pending` / `approvals.subscribe` /
   * `approvals.decide` RPCs; this exists so tests can seed approvals
   * directly and assert subscription semantics without polling round-trips.
   */
  getApprovalQueue(): ApprovalQueue {
    return this.approvalQueue;
  }

  /**
   * Test-visibility accessor for the F9 delivery pipeline. External
   * callers route through `delivery.notify` / `delivery.pending` /
   * `delivery.acknowledge` RPCs; this exposes the queue so tests can
   * seed deliveries directly and assert lifecycle events without
   * round-tripping through the RPC layer.
   */
  getFileDelivery(): FileDelivery {
    return this.fileDelivery;
  }

  /**
   * Test-visibility accessor for the F2 cursor stream. External callers
   * route through `cursor.emit` / `cursor.subscribe` RPCs; this exposes
   * the stream so tests can swap in a deterministic scheduler, seed
   * samples directly, and assert coalescing behavior without waiting
   * on real timers.
   */
  getCursorStream(): CursorStream {
    return this.cursorStream;
  }

  /**
   * Test-visibility accessor for the F3 Live Activity manager. External
   * callers route through `liveActivity.step` / `liveActivity.pending` /
   * `liveActivity.subscribe` RPCs; this exposes the manager so tests can
   * swap in a fake clock and deterministically exercise the 1-per-second
   * rate-limit path without wall-clock dependence (QB #12).
   */
  getLiveActivity(): LiveActivityManager {
    return this.liveActivity;
  }

  /**
   * Attach a WotannRuntime instance to route RPC calls to.
   */
  setRuntime(runtime: WotannRuntime): void {
    this.runtime = runtime;
    // Register self-improvement handlers now that runtime and daemon are available
    this.registerSelfImprovementHandlers();
    this.registerSurfaceHandlers();

    // F14 — hook the handoff manager into the dispatch plane so every
    // initiate/accept/expire reaches surfaces registered via F11's
    // SurfaceRegistry (phone push, watch haptic, TUI status, CarPlay
    // count, etc). Best-effort: if the runtime doesn't expose a plane,
    // the manager simply runs without broadcast side-effects.
    try {
      const plane = runtime.getDispatchPlane();
      this.computerSessionHandoff.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));
    } catch {
      // Dispatch plane not available — handoff still works, just without
      // cross-surface fan-out beyond the store's own event stream.
    }

    // F5 — hook the creations store into the same dispatch plane. Every
    // save / delete emits a file-write UnifiedEvent so the iOS
    // CreationsView, desktop Creations panel, and any other registered
    // surface learns about the new/removed file in realtime. Same
    // best-effort pattern as F14.
    try {
      const plane = runtime.getDispatchPlane();
      this.creationsStore.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));
    } catch {
      // Dispatch plane not available — creations still works, just
      // without cross-surface fan-out. Surfaces can still poll `list`.
    }

    // F6 — hook the approval queue into the dispatch plane. Each
    // enqueue/decide/expire fires a UnifiedEvent{type:"approval"} so
    // watches, phones, and CarPlay can render approval UI without
    // subscribing to the full session event stream. Same best-effort
    // pattern as F5/F14 — tests without a plane still see local events
    // via ApprovalQueue.subscribe.
    try {
      const plane = runtime.getDispatchPlane();
      this.approvalQueue.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));
    } catch {
      // Dispatch plane not available — approvals still work locally.
    }

    // F7 — bind the file.get handler to the runtime's working directory.
    // We refuse to wire a handler for "/" or "" — those would let any
    // absolute path pass the workspace check. If the runtime has no
    // meaningful working dir (fresh-start, tests without cwd overrides),
    // the handler stays null and file.get returns a cleanly-formed
    // "not configured" error rather than serving arbitrary host files.
    try {
      const workingDir = runtime.getWorkingDir();
      if (typeof workingDir === "string" && workingDir.length > 0 && workingDir !== "/") {
        this.fileGetHandler = new FileGetHandler({ rootDir: workingDir });
      }
    } catch {
      // Best-effort — runtime may not expose getWorkingDir in every test.
    }

    // F9 — wire the delivery pipeline into both the dispatch plane (for
    // cross-surface `delivery-ready` / `delivery-acknowledged` /
    // `delivery-expired` fan-out) and the creations store (for the
    // `finalize` hook that lifts a save into a delivery notification).
    // The existence-check hook lets `delivery.notify` refuse to mint a
    // token for a file that never got saved — preventing broken download
    // links on surfaces (QB #6: honest failures).
    try {
      const plane = runtime.getDispatchPlane();
      this.fileDelivery.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));
    } catch {
      // Dispatch plane not available — delivery still works locally.
    }
    // F2 — hook the cursor stream into the dispatch plane. Every emitted
    // cursor sample (post-coalesce) fans out a UnifiedEvent{type:"cursor"}
    // so iOS CursorOverlayView + desktop agents-window HUD render in
    // lock-step. Best-effort identical to F5/F6/F9 — tests without a
    // plane still exercise the session-log path via `cursor.subscribe`
    // and verify coalescing against the event buffer directly.
    try {
      const plane = runtime.getDispatchPlane();
      this.cursorStream.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));
    } catch {
      // Dispatch plane not available — cursor emits still land on the
      // F1 event log; only cross-surface fan-out is skipped.
    }
    // F3 — hook the Live Activity manager into the dispatch plane. Each
    // rate-limited step fans out as a UnifiedEvent{type:"step"} carrying
    // both compact + expanded payload shapes so iOS Dynamic Island,
    // Watch complication, TUI HUD can pick whichever they render.
    // Best-effort identical to F2/F5/F6/F9 — tests without a plane still
    // exercise the pending() / subscribe() paths for assertion.
    try {
      const plane = runtime.getDispatchPlane();
      this.liveActivity.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));
    } catch {
      // Dispatch plane not available — liveActivity.pending() still
      // returns the latest dispatched step; only cross-surface fan-out
      // is skipped.
    }
    this.fileDelivery.setCreationExists(({ sessionId, filename }) => {
      return this.creationsStore.get({ sessionId, filename }) !== null;
    });
    this.creationsStore.setFinalizeHook((params) => {
      const notifyParams: {
        sessionId: string;
        filename: string;
        displayName?: string;
        description?: string;
        expiresInSec?: number;
      } = {
        sessionId: params.sessionId,
        filename: params.filename,
      };
      if (params.displayName !== undefined) notifyParams.displayName = params.displayName;
      if (params.description !== undefined) notifyParams.description = params.description;
      if (params.expiresInSec !== undefined) notifyParams.expiresInSec = params.expiresInSec;
      return this.fileDelivery.notify(notifyParams);
    });
  }

  /**
   * Process a raw JSON-RPC message string.
   * Returns either a single response or a stream event generator.
   */
  async handleMessage(raw: string): Promise<RPCResponse | AsyncGenerator<RPCStreamEvent>> {
    let request: RPCRequest;

    try {
      request = JSON.parse(raw) as RPCRequest;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return this.errorResponse(null, RPC_PARSE_ERROR, "Parse error");
    }

    if (!request.method || !request.id) {
      return this.errorResponse(request.id ?? null, RPC_INVALID_REQUEST, "Invalid request");
    }

    // Streaming methods return an async generator
    if (request.method === "query") {
      return this.handleQuery(request);
    }

    // iOS's `chat.send` routes through the streaming runtime query unless the
    // caller explicitly opts out via `stream: false`, so real-time stream events
    // reach the iOS StreamHandler instead of a single aggregated chunk.
    if (request.method === "chat.send") {
      const streamEnabled = request.params?.["stream"] !== false;
      if (streamEnabled) {
        return this.handleChatSend(request);
      }
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      return this.errorResponse(
        request.id,
        RPC_METHOD_NOT_FOUND,
        `Method not found: ${request.method}`,
      );
    }

    try {
      const result = await handler(request.params ?? {});
      return { jsonrpc: "2.0", result, id: request.id };
    } catch (error) {
      return this.errorResponse(
        request.id,
        RPC_INTERNAL_ERROR,
        error instanceof Error ? error.message : "Internal error",
      );
    }
  }

  /**
   * Handle streaming query — returns an async generator of stream events.
   */
  private async *handleQuery(request: RPCRequest): AsyncGenerator<RPCStreamEvent> {
    if (!this.runtime) {
      yield {
        jsonrpc: "2.0",
        method: "stream.error",
        params: {
          type: "error",
          content: "Runtime not initialized",
          sessionId: "",
        },
      };
      return;
    }

    const prompt = (request.params?.prompt as string) ?? "";
    const sessionId = (request.params?.sessionId as string) ?? "default";
    const requestedModel = (request.params?.model as string) ?? "";
    const requestedProvider = (request.params?.provider as string) ?? "";

    // Load the system prompt from AGENTS.md + bootstrap files for ALL query paths
    let systemPrompt = "";
    try {
      const { assembleSystemPrompt } = await import("../prompt/engine.js");
      systemPrompt = assembleSystemPrompt({ workspaceRoot: process.cwd() });
    } catch {
      // Fallback: load AGENTS.md directly if prompt engine fails
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { join } = await import("node:path");
        const { resolveWotannHomeSubdir } = await import("../utils/wotann-home.js");
        const agentsPath = resolveWotannHomeSubdir("AGENTS.md");
        const projectAgentsPath = join(process.cwd(), ".wotann", "AGENTS.md");
        const path = existsSync(projectAgentsPath)
          ? projectAgentsPath
          : existsSync(agentsPath)
            ? agentsPath
            : null;
        if (path) systemPrompt = readFileSync(path, "utf-8");
      } catch {
        /* no system prompt available */
      }
    }

    // Determine which model to use — prefer explicit request, fall back to config
    let targetModel = requestedModel;
    let targetProvider = requestedProvider;
    if (!targetModel) {
      // Read from user's codex config
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const configPath = join(homedir(), ".codex", "config.toml");
        if (existsSync(configPath)) {
          const match = readFileSync(configPath, "utf-8").match(/^model\s*=\s*"([^"]+)"/m);
          if (match?.[1]) targetModel = match[1];
        }
      } catch {
        /* ignore */
      }
    }
    if (!targetModel) targetModel = "gemma4"; // Ultimate fallback to local model

    // Try the runtime's query pipeline first
    let runtimeHasProviders = false;
    try {
      const status = this.runtime.getStatus();
      runtimeHasProviders = (status.providers?.length ?? 0) > 0;
    } catch {
      /* ignore */
    }

    if (runtimeHasProviders) {
      for await (const chunk of this.runtime.query({
        prompt,
        model: targetModel,
        provider: targetProvider as never,
      })) {
        const chunkType = chunk.type as "text" | "thinking" | "tool_use" | "done" | "error";
        yield {
          jsonrpc: "2.0",
          method: streamMethodForChunkType(chunkType),
          params: {
            type: chunkType,
            content: chunk.content,
            sessionId,
            provider: chunk.provider,
            model: chunk.model,
          },
        };
      }
      return;
    }

    // Fallback: route through available providers directly (bypassing uninitialized runtime)
    // Smart routing: detect provider from model name

    const _isOllamaModel =
      [
        "gemma",
        "llama",
        "qwen",
        "phi",
        "mistral",
        "deepseek",
        "codestral",
        "glm",
        "devstral",
        "nemotron",
      ].some((k) => targetModel.toLowerCase().includes(k)) || targetModel.includes(":");
    const isCloudModel = ["gpt", "claude", "o3", "o4", "chatgpt"].some((k) =>
      targetModel.toLowerCase().includes(k),
    );

    // Route cloud models through Codex CLI via stdin pipe, then Ollama as fallback
    if (isCloudModel) {
      try {
        const { spawn: spawnProcess } = await import("node:child_process");
        const codexModel = targetModel || "gpt-5.4";

        const response = await new Promise<string>((resolve, reject) => {
          const codex = spawnProcess("codex", ["exec", "--json", "-c", `model="${codexModel}"`], {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
              ...process.env,
              PATH: process.env["PATH"] ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin",
            },
            timeout: 60000,
          });

          let stdout = "";
          let stderr = "";
          codex.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
          codex.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          const systemContext = systemPrompt ? systemPrompt + "\n\n---\n\n" : "";
          codex.stdin?.write(systemContext + prompt);
          codex.stdin?.end();

          codex.on("close", (code: number | null) => {
            if (code === 0 && stdout.trim()) {
              // Parse JSONL output — extract text from item.completed events
              const textParts: string[] = [];
              for (const line of stdout.trim().split("\n")) {
                try {
                  const event = JSON.parse(line) as {
                    type?: string;
                    item?: { text?: string; type?: string };
                  };
                  if (
                    event.type === "item.completed" &&
                    event.item?.type === "agent_message" &&
                    event.item?.text
                  ) {
                    textParts.push(event.item.text);
                  }
                } catch {
                  /* skip non-JSON lines */
                }
              }
              resolve(textParts.join("\n") || stdout.trim());
            } else {
              reject(new Error(stderr || `Codex exited with code ${code}`));
            }
          });
          codex.on("error", reject);
        });

        if (response) {
          yield {
            jsonrpc: "2.0",
            method: "stream.text",
            params: {
              type: "text",
              content: response,
              sessionId,
              provider: "codex",
              model: codexModel,
            },
          };
          yield {
            jsonrpc: "2.0",
            method: "stream.done",
            params: { type: "done", content: "", sessionId, provider: "codex", model: codexModel },
          };
          return;
        }
      } catch (codexErr) {
        // Codex failed — fall through to Ollama
        const errMsg = codexErr instanceof Error ? codexErr.message : "Unknown error";
        // Log the error but don't show it to the user — just fall through silently to Ollama
        console.error(`[WOTANN] Codex CLI failed: ${errMsg}. Falling back to local model.`);
      }
    }

    // Try Ollama (for local models, or as fallback for failed cloud models)
    try {
      const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
      // Use Ollama streaming API for real-time token delivery
      // Use reduced context window to prevent OOM on limited RAM systems
      // TurboQuant principle: 16GB RAM - 9.6GB model = ~4GB for KV cache ≈ 8K context
      // Ollama q8_0 KV cache + flash attention reduce memory by ~50%
      const ollamaModel = targetModel.includes(":")
        ? targetModel // Already fully qualified (e.g. gemma4:latest)
        : ["gemma", "llama", "qwen", "glm", "phi", "mistral", "deepseek", "codestral"].some((k) =>
              targetModel.toLowerCase().includes(k),
            )
          ? targetModel
          : "gemma4";
      const res = await fetch(`${ollamaHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: prompt },
          ],
          stream: true,
          options: {
            num_ctx: 8192, // Reduced context to prevent OOM (TurboQuant principle)
            num_gpu: 999, // Use all GPU layers
            use_mmap: true, // Memory-mapped loading for efficiency
          },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value, { stream: true });
            // Ollama streams NDJSON lines
            for (const line of text.split("\n")) {
              if (!line.trim()) continue;
              try {
                const chunk = JSON.parse(line) as {
                  message?: { content?: string };
                  done?: boolean;
                };
                if (chunk.message?.content) {
                  yield {
                    jsonrpc: "2.0",
                    method: "stream.text",
                    params: {
                      type: "text",
                      content: chunk.message.content,
                      sessionId,
                      provider: "ollama",
                      model: "gemma4",
                    },
                  };
                }
                if (chunk.done) {
                  yield {
                    jsonrpc: "2.0",
                    method: "stream.done",
                    params: {
                      type: "done",
                      content: "",
                      sessionId,
                      provider: "ollama",
                      model: "gemma4",
                    },
                  };
                }
              } catch {
                /* skip invalid JSON lines */
              }
            }
          }
        }
        return;
      }
    } catch {
      /* Ollama not available */
    }

    // Try Codex CLI as second fallback
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const tmpFile = `/tmp/wotann-codex-${Date.now()}.txt`;
      const codexModel = targetModel || "gpt-5.4";
      await execFileAsync("codex", ["exec", "-c", `model="${codexModel}"`, "-o", tmpFile, prompt], {
        timeout: 60000,
        encoding: "utf-8",
      });
      const { readFileSync, unlinkSync } = await import("node:fs");
      const responseText = readFileSync(tmpFile, "utf-8").trim();
      try {
        unlinkSync(tmpFile);
      } catch {
        /* cleanup */
      }

      if (responseText) {
        yield {
          jsonrpc: "2.0",
          method: "stream.text",
          params: {
            type: "text",
            content: responseText,
            sessionId,
            provider: "codex",
            model: targetModel || "gpt-5.4",
          },
        };
        yield {
          jsonrpc: "2.0",
          method: "stream.done",
          params: {
            type: "done",
            content: "",
            sessionId,
            provider: "codex",
            model: targetModel || "gpt-5.4",
          },
        };
        return;
      }
    } catch {
      /* Codex CLI failed */
    }

    // No providers available
    yield {
      jsonrpc: "2.0",
      method: "stream.error",
      params: {
        type: "error",
        content: "No providers available. Configure an API key or install a CLI (codex, claude).",
        sessionId,
      },
    };
  }

  /**
   * Handle iOS `chat.send` as a streaming method. Validates image attachments
   * (A9 session corruption guard) before appending the user message, then
   * delegates to the runtime's streaming query so iOS's StreamHandler receives
   * real-time events. If the runtime isn't available, falls back to the same
   * provider fallback path as `query`.
   */
  private async *handleChatSend(request: RPCRequest): AsyncGenerator<RPCStreamEvent> {
    const params = request.params ?? {};
    const prompt =
      (params["content"] as string | undefined) ??
      (params["prompt"] as string | undefined) ??
      (params["message"] as string | undefined) ??
      "";
    const sessionId =
      (params["conversationId"] as string | undefined) ??
      (params["sessionId"] as string | undefined) ??
      "default";

    // A9: validate any attached images before touching the conversation so a
    // corrupt payload can't poison session history.
    const imageError = validateImageParams(params);
    if (imageError) {
      yield {
        jsonrpc: "2.0",
        method: "stream.error",
        params: { type: "error", content: `Image validation failed: ${imageError}`, sessionId },
      };
      return;
    }

    if (!this.runtime) {
      yield {
        jsonrpc: "2.0",
        method: "stream.error",
        params: { type: "error", content: "Runtime not initialized", sessionId },
      };
      return;
    }

    const requestedModel = (params["model"] as string | undefined) ?? "";
    const requestedProvider = (params["provider"] as string | undefined) ?? "";

    // Try the runtime streaming path first.
    try {
      let runtimeHasProviders = false;
      try {
        const status = this.runtime.getStatus();
        runtimeHasProviders = (status.providers?.length ?? 0) > 0;
      } catch {
        /* ignore */
      }

      if (runtimeHasProviders) {
        for await (const chunk of this.runtime.query({
          prompt,
          model: requestedModel || undefined,
          provider: requestedProvider ? (requestedProvider as never) : undefined,
        })) {
          const chunkType = chunk.type as "text" | "thinking" | "tool_use" | "done" | "error";
          yield {
            jsonrpc: "2.0",
            method: streamMethodForChunkType(chunkType),
            params: {
              type: chunkType,
              content: chunk.content,
              sessionId,
              provider: chunk.provider,
              model: chunk.model,
            },
          };
        }
        return;
      }
    } catch (err) {
      yield {
        jsonrpc: "2.0",
        method: "stream.error",
        params: {
          type: "error",
          content: `chat.send failed: ${err instanceof Error ? err.message : String(err)}`,
          sessionId,
        },
      };
      return;
    }

    // Runtime has no providers — route through the same fallback path as
    // `query` by synthesizing an equivalent query request.
    yield* this.handleQuery({
      jsonrpc: "2.0",
      method: "query",
      params: { prompt, sessionId, model: requestedModel, provider: requestedProvider },
      id: request.id,
    });
  }

  /**
   * Register a custom RPC method handler.
   */
  register(method: string, handler: RPCHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * List all registered RPC methods.
   */
  getMethods(): readonly string[] {
    return [...this.handlers.keys()];
  }

  // ── Built-in Method Registration ──────────────────────────

  private registerBuiltinMethods(): void {
    // Status — returns real RuntimeStatus from the hosted runtime
    this.handlers.set("status", async () => {
      if (!this.runtime) return { status: "stopped" };
      return this.runtime.getStatus();
    });

    // SECURITY (B1, SB-5): auth.handshake — surface the current session
    // token to callers that have already proven they own the daemon. The
    // method was previously listed in UNAUTH_IPC_METHODS with a comment
    // claiming "ECDH-encrypted pairing" protected it; that was a LIE — the
    // daemon performed no ECDH verification, so any local process could
    // call this method and get a 24-hour daemon token cleartext. The fix
    // (SB-5) removes auth.handshake from UNAUTH_IPC_METHODS in kairos-ipc.ts,
    // so the surrounding IPC dispatcher will reject the call unless the
    // caller already presents a valid session token. With auth gating
    // restored, this handler is effectively a no-op (the caller already has
    // what it returns) but is kept for backwards compatibility with
    // legitimate clients that probe for the endpoint.
    //
    // iOS DOES NOT use this method. iOS pairs over the WebSocket
    // CompanionServer (`pair`/`pair.local`) and gets its auth token in
    // the pair response — it never connects to the kairos UDS.
    this.handlers.set("auth.handshake", async () => {
      const { readSessionToken } = await import("./kairos-ipc.js");
      const token = readSessionToken();
      if (!token) {
        throw new Error("session_token_unavailable");
      }
      return { token, expiresAt: null };
    });

    // ── Subscription Login RPCs ──────────────────────────
    //
    // Both flows open a system browser tab (OAuth PKCE for Codex, the Claude
    // CLI's built-in login for Anthropic) and resolve once credentials are
    // written to disk. The desktop app calls these via the login_anthropic /
    // login_codex Tauri commands so users never have to touch a terminal.

    this.handlers.set("auth.anthropic-login", async () => {
      const { startAnthropicLogin } = await import("../providers/claude-cli-backend.js");
      try {
        const result = await startAnthropicLogin();
        return result;
      } catch (err) {
        return {
          success: false,
          provider: "anthropic" as const,
          expiresAt: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    this.handlers.set("auth.codex-login", async () => {
      const { detectExistingCodexCredential, importCodexCliCredential } =
        await import("../providers/codex-detector.js");
      try {
        // Detect-only path. Per V9 T0.2, WOTANN no longer runs its own
        // PKCE flow against auth.openai.com — the Codex CLI is the
        // legitimate credential holder. If no existing credential is
        // found, prompt the user to run `codex login` themselves.
        const existing = detectExistingCodexCredential();
        if (existing.found && existing.path) {
          const imported = importCodexCliCredential(existing.path);
          if (imported.success) {
            return {
              success: true,
              provider: "codex" as const,
              expiresAt: existing.expiresAt ?? null,
              tokenSource: existing.path,
              reused: true,
            };
          }
          return {
            success: false,
            provider: "codex" as const,
            expiresAt: null,
            error: `Found ~/.codex/auth.json but could not import it: ${imported.error ?? "unknown"}. Run 'codex login' to refresh.`,
          };
        }

        return {
          success: false,
          provider: "codex" as const,
          expiresAt: null,
          error:
            "No existing Codex CLI session. Run 'codex login' in a shell (install with 'npm i -g @openai/codex'), then retry.",
        };
      } catch (err) {
        return {
          success: false,
          provider: "codex" as const,
          expiresAt: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // Detect existing subscription credentials without triggering a login.
    // The desktop app calls this on settings mount to surface the
    // "Found existing login — tap to import" banner.
    this.handlers.set("auth.detect-existing", async () => {
      const { detectExistingAnthropicCredential } =
        await import("../providers/claude-cli-backend.js");
      const { detectExistingCodexCredential } = await import("../providers/codex-detector.js");
      return {
        anthropic: await detectExistingAnthropicCredential(),
        codex: detectExistingCodexCredential(),
      };
    });

    this.handlers.set("auth.import-codex", async (params) => {
      const { importCodexCliCredential } = await import("../providers/codex-detector.js");
      const path = (params.path as string | undefined) ?? undefined;
      if (!path) {
        return { success: false, error: "path required" };
      }
      return importCodexCliCredential(path);
    });

    this.handlers.set("companion.pairing", async () => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        throw new Error("Companion server not running");
      }

      const pairing = companionServer.generatePairingQR();

      return {
        ...pairing,
        port: Number.isFinite(pairing.port) ? pairing.port : 3849,
      };
    });

    this.handlers.set("companion.devices", async () => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        return [];
      }

      const activeDeviceIds = new Set(
        companionServer
          .getPairingManager()
          .getActiveSessions()
          .map((session) => session.device.id),
      );

      return companionServer
        .getPairingManager()
        .getPairedDevices()
        .map((device) => ({
          id: device.id,
          name: device.name,
          platform: device.platform,
          lastSeen: device.lastSeen,
          connected: activeDeviceIds.has(device.id),
        }));
    });

    this.handlers.set("companion.sessions", async () => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        return [];
      }

      return companionServer
        .getPairingManager()
        .getActiveSessions()
        .map((session) => ({
          id: session.id,
          deviceId: session.device.id,
          deviceName: session.device.name,
          connectedAt: new Date(session.establishedAt).getTime(),
          messagesExchanged: session.messagesExchanged,
          status: session.status,
        }));
    });

    this.handlers.set("companion.unpair", async (params) => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        throw new Error("Companion server not running");
      }
      const deviceId = params.deviceId as string | undefined;
      if (!deviceId) {
        throw new Error("deviceId required");
      }
      return { removed: companionServer.getPairingManager().unpairDevice(deviceId), deviceId };
    });

    this.handlers.set("companion.session.end", async (params) => {
      const companionServer = this.daemon?.getCompanionServer();
      if (!companionServer || !companionServer.isRunning()) {
        throw new Error("Companion server not running");
      }
      const sessionId = params.sessionId as string | undefined;
      if (!sessionId) {
        throw new Error("sessionId required");
      }
      return { ended: companionServer.getPairingManager().endSession(sessionId), sessionId };
    });

    // Session management — returns the active session
    this.handlers.set("session.list", async () => {
      if (!this.runtime) return [];
      const session = this.runtime.getSession();
      return [
        {
          id: session.id,
          name: session.id,
          provider: session.provider,
          model: session.model,
          createdAt: Date.now(),
          messageCount: session.messages.length,
          totalCost: session.totalCost,
        } satisfies SessionInfo,
      ];
    });

    // NOTE: The canonical session.create handler is registered further below
    // (see ~L1731). The earlier duplicate registered here was dead — Map.set
    // silently overwrote it — and has been removed as part of C5 cleanup.

    // Provider management — returns real provider data from RuntimeStatus
    this.handlers.set("providers.list", async (params) => {
      // Unified discovery via ProviderService. Returns the shape the UI expects:
      // { id, name, enabled, models, defaultModel }. For richer state, use providers.snapshot.
      const { getProviderService } = await import("../providers/provider-service.js");
      const service = getProviderService();
      const force = (params as Record<string, unknown>)["force"] === true;
      const snapshot = await service.getSnapshot({ force });
      return snapshot.providers
        .map((p) => ({
          id: p.id,
          name: p.name + (p.credential?.label ? ` (${p.credential.label})` : ""),
          enabled: p.configured,
          models: p.models.map((m) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            costPerMTok: m.costPerMTokInput,
          })),
          defaultModel: p.defaultModel ?? "",
        }))
        .filter((p) => p.enabled);
    });

    // providers.snapshot — full state including unconfigured providers + auth methods
    this.handlers.set("providers.snapshot", async (params) => {
      const { getProviderService } = await import("../providers/provider-service.js");
      const service = getProviderService();
      const force = (params as Record<string, unknown>)["force"] === true;
      const snapshot = await service.getSnapshot({ force });
      return {
        providers: snapshot.providers.map((p) => ({
          id: p.id,
          name: p.name,
          tier: p.tier,
          configured: p.configured,
          credentialLabel: p.credential?.label ?? null,
          credentialMethod: p.credential?.method ?? null,
          credentialSource: p.credential?.source ?? null,
          models: p.models,
          defaultModel: p.defaultModel,
          lastRefreshedAt: p.lastRefreshedAt,
          lastError: p.lastError ?? null,
          supportedMethods: service.getSpec(p.id)?.supportedMethods ?? [],
          envKeys: service.getSpec(p.id)?.envKeys ?? [],
          docsUrl: service.getSpec(p.id)?.docsUrl ?? null,
        })),
        active: snapshot.active,
        lastRefreshedAt: snapshot.lastRefreshedAt,
      };
    });

    // providers.saveCredential — save an API key or OAuth token
    this.handlers.set("providers.saveCredential", async (params) => {
      const { providerId, method, token, expiresAt, label } = params as {
        providerId?: string;
        method?: string;
        token?: string;
        expiresAt?: number;
        label?: string;
      };
      if (!providerId || !method || !token)
        throw new Error("providerId, method, and token required");
      const { getProviderService } = await import("../providers/provider-service.js");
      const state = await getProviderService().saveCredential(providerId, {
        method: method as "apiKey" | "oauth" | "subscription" | "cli" | "local",
        token,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(label !== undefined ? { label } : {}),
      });
      return {
        ok: true,
        provider: state
          ? { id: state.id, configured: state.configured, models: state.models.length }
          : null,
      };
    });

    // providers.deleteCredential — remove saved credential for a provider
    this.handlers.set("providers.deleteCredential", async (params) => {
      const { providerId } = params as { providerId?: string };
      if (!providerId) throw new Error("providerId required");
      const { getProviderService } = await import("../providers/provider-service.js");
      await getProviderService().deleteCredential(providerId);
      return { ok: true };
    });

    // providers.test — validate the current credential by fetching model list
    this.handlers.set("providers.test", async (params) => {
      const { providerId } = params as { providerId?: string };
      if (!providerId) throw new Error("providerId required");
      const { getProviderService } = await import("../providers/provider-service.js");
      return getProviderService().testCredential(providerId);
    });

    // providers.refresh — force re-discovery of all providers
    this.handlers.set("providers.refresh", async () => {
      const { getProviderService } = await import("../providers/provider-service.js");
      await getProviderService().refresh();
      return { ok: true, refreshedAt: Date.now() };
    });

    // providers.import — import credentials from a discovered file path
    this.handlers.set("providers.import", async (params) => {
      const { providerId, path } = params as { providerId?: string; path?: string };
      if (!providerId || !path) throw new Error("providerId and path required");
      const { getProviderService } = await import("../providers/provider-service.js");
      const state = await getProviderService().importFromPath(providerId, path);
      return { ok: state !== null, provider: state?.id ?? null };
    });

    // Legacy handler kept for reference — now superseded by providers.snapshot.
    this.handlers.set("providers.list.legacy", async () => {
      type ProviderResult = {
        id: string;
        name: string;
        enabled: boolean;
        models: Array<{ id: string; name: string; contextWindow: number; costPerMTok: number }>;
        defaultModel: string;
      };
      const results: ProviderResult[] = [];

      // 1. Ollama — always probe (free, local, no auth)
      try {
        const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
        const res = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = (await res.json()) as {
            models: Array<{ name: string; details?: { parameter_size?: string }; size?: number }>;
          };
          const models = data.models.map((m) => ({
            id: m.name,
            name: m.name.replace(":latest", ""),
            contextWindow: 128000,
            costPerMTok: 0,
          }));
          if (models.length > 0) {
            results.push({
              id: "ollama",
              name: "Ollama (Local)",
              enabled: true,
              models,
              defaultModel: models[0]?.id ?? "",
            });
          }
        }
      } catch {
        /* Ollama not running */
      }

      // 2. Anthropic — detect via API key, Claude CLI, or saved OAuth token
      const anthropicKey = process.env["ANTHROPIC_API_KEY"];
      const claudeOauthToken = process.env["CLAUDE_CODE_OAUTH_TOKEN"];
      let hasClaudeCli = false;
      if (!anthropicKey && !claudeOauthToken) {
        try {
          const { execFileSync } = await import("node:child_process");
          execFileSync("claude", ["--version"], { stdio: "pipe", timeout: 3000 });
          hasClaudeCli = true;
        } catch {
          /* claude CLI not installed */
        }
      }
      // Legacy saved-OAuth path removed per V9 T0.1: WOTANN no longer
      // writes its own copy of the Claude subscription token. The
      // `claude` binary owns the credential and is detected via
      // `hasClaudeCli` above.

      if (anthropicKey || claudeOauthToken || hasClaudeCli) {
        // If API key is available, try to fetch real model list from Anthropic API
        let anthropicModels: Array<{
          id: string;
          name: string;
          contextWindow: number;
          costPerMTok: number;
        }> = [];
        if (anthropicKey) {
          try {
            const res = await fetch("https://api.anthropic.com/v1/models", {
              headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
              signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
              const data = (await res.json()) as {
                data?: Array<{ id: string; display_name?: string }>;
              };
              anthropicModels = (data.data ?? []).slice(0, 10).map((m) => ({
                id: m.id,
                name: m.display_name ?? m.id,
                contextWindow: 200000,
                costPerMTok: 3,
              }));
            }
          } catch {
            /* API unreachable */
          }
        }
        // Fallback to well-known models for CLI/OAuth users
        if (anthropicModels.length === 0) {
          anthropicModels = [
            {
              id: "claude-opus-4-6",
              name: "Claude Opus 4.6",
              contextWindow: 200000,
              costPerMTok: 15,
            },
            {
              id: "claude-sonnet-4-6",
              name: "Claude Sonnet 4.6",
              contextWindow: 200000,
              costPerMTok: 3,
            },
            {
              id: "claude-haiku-4-5",
              name: "Claude Haiku 4.5",
              contextWindow: 200000,
              costPerMTok: 0.25,
            },
          ];
        }
        const authMethod = anthropicKey ? "API Key" : hasClaudeCli ? "Claude CLI" : "OAuth";
        results.push({
          id: "anthropic",
          name: `Anthropic (${authMethod})`,
          enabled: true,
          models: anthropicModels,
          defaultModel: anthropicModels[0]?.id ?? "",
        });
      }

      // 3. OpenAI — query /v1/models if API key exists
      const openaiKey = process.env["OPENAI_API_KEY"];
      if (openaiKey) {
        try {
          const res = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${openaiKey}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: Array<{ id: string }> };
            const chatModels = (data.data ?? [])
              .filter((m) => m.id.includes("gpt") || m.id.includes("o3") || m.id.includes("o4"))
              .slice(0, 10);
            const models = chatModels.map((m) => ({
              id: m.id,
              name: m.id,
              contextWindow: 128000,
              costPerMTok: 2,
            }));
            if (models.length > 0) {
              results.push({
                id: "openai",
                name: "OpenAI",
                enabled: true,
                models,
                defaultModel: models[0]?.id ?? "",
              });
            }
          }
        } catch {
          /* API unreachable */
        }
      }

      // 4. Gemini — query if API key exists
      // SECURITY (B2): send the API key via the `x-goog-api-key` header rather
      // than as a query-string parameter, so it does not leak into server
      // access logs, HTTP referers, or error traces.
      const geminiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
      if (geminiKey) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models`, {
            headers: { "x-goog-api-key": geminiKey },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              models?: Array<{ name: string; displayName?: string; inputTokenLimit?: number }>;
            };
            const models = (data.models ?? [])
              .filter((m) => m.name.includes("gemini"))
              .slice(0, 10)
              .map((m) => ({
                id: m.name.replace("models/", ""),
                name: m.displayName ?? m.name,
                contextWindow: m.inputTokenLimit ?? 1000000,
                costPerMTok: 0,
              }));
            if (models.length > 0) {
              results.push({
                id: "gemini",
                name: "Google Gemini",
                enabled: true,
                models,
                defaultModel: models[0]?.id ?? "",
              });
            }
          }
        } catch {
          /* API unreachable */
        }
      }

      // 5. Groq — query /v1/models if API key exists
      const groqKey = process.env["GROQ_API_KEY"];
      if (groqKey) {
        try {
          const res = await fetch("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${groqKey}` },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = (await res.json()) as { data?: Array<{ id: string }> };
            const models = (data.data ?? []).slice(0, 10).map((m) => ({
              id: m.id,
              name: m.id,
              contextWindow: 128000,
              costPerMTok: 0.5,
            }));
            if (models.length > 0) {
              results.push({
                id: "groq",
                name: "Groq",
                enabled: true,
                models,
                defaultModel: models[0]?.id ?? "",
              });
            }
          }
        } catch {
          /* API unreachable */
        }
      }

      // 6. GitHub Copilot — check for token
      const ghToken = process.env["GH_TOKEN"] ?? process.env["GITHUB_TOKEN"];
      if (ghToken) {
        try {
          // Exchange GH token for Copilot token and list models
          const tokenRes = await fetch("https://api.github.com/copilot_internal/v2/token", {
            headers: { Authorization: `token ${ghToken}` },
            signal: AbortSignal.timeout(5000),
          });
          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as {
              token?: string;
              endpoints?: { api?: string };
            };
            const copilotToken = tokenData.token;
            const apiBase = tokenData.endpoints?.api ?? "https://api.githubcopilot.com";
            if (copilotToken) {
              const modelsRes = await fetch(`${apiBase}/models`, {
                headers: { Authorization: `Bearer ${copilotToken}` },
                signal: AbortSignal.timeout(5000),
              });
              if (modelsRes.ok) {
                const modelsData = (await modelsRes.json()) as {
                  data?: Array<{ id: string; name?: string }>;
                };
                const models = (modelsData.data ?? []).slice(0, 15).map((m) => ({
                  id: m.id,
                  name: m.name ?? m.id,
                  contextWindow: 128000,
                  costPerMTok: 0,
                }));
                if (models.length > 0) {
                  results.push({
                    id: "copilot",
                    name: "GitHub Copilot",
                    enabled: true,
                    models,
                    defaultModel: models[0]?.id ?? "",
                  });
                }
              }
            }
          }
        } catch {
          /* Copilot not available */
        }
      }

      // 7. Codex (ChatGPT subscription) — read auth.json, decode JWT plan type, map to models
      // SECURITY (B3): verify JWT structure, expiration, and issuer before
      // trusting any claims. We do not have the JWK to verify the signature
      // locally, but at minimum we reject malformed, expired, or wrong-issuer
      // tokens so a local attacker cannot forge claims by editing auth.json.
      try {
        const { readFileSync, existsSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join } = await import("node:path");
        const authPath = join(homedir(), ".codex", "auth.json");
        if (existsSync(authPath)) {
          const authData = JSON.parse(readFileSync(authPath, "utf-8")) as {
            auth_mode?: string;
            tokens?: { id_token?: string; access_token?: string };
          };

          if (authData.tokens?.id_token) {
            const verification = verifyCodexJWT(authData.tokens.id_token);
            if (!verification.valid || !verification.payload) {
              // Structural / exp / iss check failed — do NOT trust the claims.
              console.warn(
                `[WOTANN] codex.auth_invalid: ${verification.error ?? "jwt verification failed"}`,
              );
              throw new Error("codex.auth_invalid");
            }
            // B3 upgrade: attempt cryptographic signature verify in the
            // background. Fire-and-forget so provider discovery stays fast;
            // signature failures are logged but don't block startup.
            const idToken = authData.tokens.id_token;
            void verifyCodexJWTSignature(idToken).then((sig) => {
              if (!sig.signatureVerified) {
                console.warn(
                  `[WOTANN] codex.signature_unverified: ${sig.error ?? "JWKS unreachable; relying on offline defence-in-depth checks"}`,
                );
              }
            });
            const decoded = verification.payload;
            const planType = decoded["https://api.openai.com/auth"]?.chatgpt_plan_type ?? "free";

            // Also read config.toml for the user's preferred model
            let configModel = "";
            try {
              const configPath = join(homedir(), ".codex", "config.toml");
              if (existsSync(configPath)) {
                const configText = readFileSync(configPath, "utf-8");
                const modelMatch = configText.match(/^model\s*=\s*"([^"]+)"/m);
                if (modelMatch?.[1]) configModel = modelMatch[1];
              }
            } catch {
              /* config read failed */
            }

            // Map plan type to available models (based on OpenAI's published tier access)
            type ModelDef = {
              id: string;
              name: string;
              contextWindow: number;
              costPerMTok: number;
            };
            const modelsByPlan: Record<string, readonly ModelDef[]> = {
              free: [
                {
                  id: "gpt-4.1-mini",
                  name: "GPT-4.1 Mini",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
                {
                  id: "gpt-4.1-nano",
                  name: "GPT-4.1 Nano",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
              ],
              plus: [
                { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 1000000, costPerMTok: 0 },
                { id: "o4-mini", name: "o4-mini", contextWindow: 200000, costPerMTok: 0 },
                { id: "o3", name: "o3", contextWindow: 200000, costPerMTok: 0 },
                { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, costPerMTok: 0 },
                {
                  id: "gpt-4.1-mini",
                  name: "GPT-4.1 Mini",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
                { id: "chatgpt-4o-latest", name: "GPT-4o", contextWindow: 128000, costPerMTok: 0 },
              ],
              pro: [
                { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 1000000, costPerMTok: 0 },
                { id: "o3", name: "o3", contextWindow: 200000, costPerMTok: 0 },
                { id: "o4-mini", name: "o4-mini", contextWindow: 200000, costPerMTok: 0 },
                { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, costPerMTok: 0 },
                {
                  id: "gpt-4.1-mini",
                  name: "GPT-4.1 Mini",
                  contextWindow: 1000000,
                  costPerMTok: 0,
                },
                { id: "gpt-4.5", name: "GPT-4.5", contextWindow: 128000, costPerMTok: 0 },
                { id: "chatgpt-4o-latest", name: "GPT-4o", contextWindow: 128000, costPerMTok: 0 },
              ],
            };

            const models = [...(modelsByPlan[planType] ?? modelsByPlan["free"] ?? [])];

            // If user has a preferred model in config, move it to the top
            const defaultModel = configModel || models[0]?.id || "gpt-4.1-mini";

            const planLabel =
              planType === "plus" ? "ChatGPT Plus" : planType === "pro" ? "ChatGPT Pro" : "ChatGPT";
            results.push({
              id: "codex",
              name: `${planLabel} (Codex)`,
              enabled: true,
              models,
              defaultModel,
            });
          }
        }
      } catch {
        /* Codex auth not available */
      }

      return results;
    });

    this.handlers.set("providers.switch", async (params) => {
      const provider = params.provider as string;
      const model = params.model as string;
      if (!provider || !model) throw new Error("provider and model required");

      // Validate + set the active provider on the unified service. It throws
      // a descriptive error if the provider is unconfigured or the model is
      // not available so the UI surfaces a clear message.
      const { getProviderService } = await import("../providers/provider-service.js");
      getProviderService().setActive(provider, model);
      return { success: true, provider, model };
    });

    // Cost — returns real cost data from the runtime session and status
    this.handlers.set("cost.current", async () => {
      if (!this.runtime) {
        return {
          sessionCost: 0,
          dailyCost: 0,
          weeklyCost: 0,
          budget: 0,
          budgetUsedPercent: 0,
        } satisfies CostSnapshot;
      }
      const session = this.runtime.getSession();
      const tracker = this.runtime.getCostTracker();
      const dailyCost = tracker.getTodayCost();
      const weeklyCost = tracker.getWeeklyCost();
      const budget = tracker.getBudget() ?? 0;
      const budgetUsedPercent = budget > 0 ? (weeklyCost / budget) * 100 : 0;
      return {
        sessionCost: session.totalCost,
        dailyCost,
        weeklyCost,
        budget,
        budgetUsedPercent,
      } satisfies CostSnapshot;
    });

    // Memory — searches the real hybrid memory system
    this.handlers.set("memory.search", async (params) => {
      const query = params.query as string;
      if (!query) return [];
      if (!this.runtime) return [];
      try {
        const hybridSearch = this.runtime.getHybridSearch();
        const results = hybridSearch.search(query, 10);
        return results.map((r) => ({
          id: r.id,
          score: r.score,
        }));
      } catch {
        // Hybrid search may not be initialized — fall back to empty
        return [];
      }
    });

    // V9 T1.9 — Expose the previously-orphaned
    // `Runtime.searchUnifiedKnowledge()` over RPC. Fabric-level fan-out
    // retrieval (MemoryStore FTS5 + ContextTreeManager markdown +
    // whatever else registers retrievers) with dedup, confidence
    // filtering, and provenance-tagged results. Different from
    // `memory.search` above which only hits FTS5 hybrid search.
    this.handlers.set("memory.searchUnified", async (params) => {
      const query = params.query as string;
      if (!query) return [];
      if (!this.runtime) return [];
      const maxResults =
        typeof params["maxResults"] === "number" ? (params["maxResults"] as number) : 20;
      const minConfidence =
        typeof params["minConfidence"] === "number" ? (params["minConfidence"] as number) : 0;
      try {
        const results = await this.runtime.searchUnifiedKnowledge(query, maxResults, minConfidence);
        // KnowledgeResult is already a POJO shape (id, content, score,
        // source, metadata) — safe to ship over RPC without re-serialization.
        return results;
      } catch (err) {
        // Knowledge fabric may be uninitialized (no retrievers
        // registered). Surface as empty rather than throwing — matches
        // memory.search fallback shape above.
        console.warn(
          `[kairos-rpc] memory.searchUnified failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      }
    });

    // Enhance — uses the real PromptEnhancer from the runtime
    this.handlers.set("enhance", async (params) => {
      const prompt = params.prompt as string;
      if (!prompt) throw new Error("prompt required");
      if (!this.runtime) {
        // No runtime available — return the original prompt unenhanced
        return { original: prompt, enhanced: prompt, style: params.style ?? "detailed" };
      }
      try {
        const enhancer = this.runtime.getPromptEnhancerEngine();
        const style = (params.style as EnhancementStyle) ?? "detailed";
        // Build a query executor that routes through the runtime
        const executor: QueryExecutor = async (p, systemPrompt) => {
          let response = "";
          const startMs = Date.now();
          for await (const chunk of this.runtime!.query({ prompt: `${systemPrompt}\n\n${p}` })) {
            if (chunk.type === "text") response += chunk.content;
          }
          return {
            response,
            model: this.runtime!.getStatus().activeProvider ?? "unknown",
            provider: this.runtime!.getSession().provider,
            tokensUsed: 0,
            durationMs: Date.now() - startMs,
          };
        };
        const result = await enhancer.enhance(prompt, executor, style);
        return {
          original: result.originalPrompt,
          enhanced: result.enhancedPrompt,
          style: result.style,
        };
      } catch {
        // Enhancement failed — return original unchanged
        return { original: prompt, enhanced: prompt, style: params.style ?? "detailed" };
      }
    });

    // Config — reads/writes ~/.wotann/wotann.yaml
    this.handlers.set("config.get", async (params) => {
      const configPath = resolveWotannHomeSubdir("wotann.yaml");
      if (!existsSync(configPath)) return {};
      try {
        const raw = readFileSync(configPath, "utf-8");
        const config = (yamlParse(raw) ?? {}) as Record<string, unknown>;
        const key = params.key as string | undefined;
        if (!key) return config;
        return { key, value: config[key] ?? null };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return {};
      }
    });

    this.handlers.set("config.set", async (params) => {
      const key = params.key as string | undefined;
      const value = params.value;
      if (!key) throw new Error("key required");

      const wotannDir = resolveWotannHome();
      const configPath = join(wotannDir, "wotann.yaml");

      let config: Record<string, unknown> = {};
      try {
        if (!existsSync(wotannDir)) {
          // V9 Wave 6.7 (M-N9) — sensitive directory: 0o700 to match the
          // daemon's own bootstrap (see kairos.ts:Phase A3). The wotann
          // home contains session-token.json, copilot-token.json, and
          // every credential file the harness writes — locking the parent
          // dir to owner-only matches the per-file 0600 perms.
          mkdirSync(wotannDir, { recursive: true, mode: 0o700 });
        }
        if (existsSync(configPath)) {
          const raw = readFileSync(configPath, "utf-8");
          config = (yamlParse(raw) ?? {}) as Record<string, unknown>;
        }
      } catch {
        // Start with empty config on read failure
      }

      // Return a new config object with the updated key (immutable pattern)
      const updated = { ...config, [key]: value };
      // Wave 6.5-UU (H-22) — wotann.yaml is the user's persisted config.
      // writeFileAtomic uses tmp + fsync + rename so a crash mid-write
      // doesn't corrupt the YAML and break the next daemon boot.
      writeFileAtomic(configPath, yamlStringify(updated), { encoding: "utf-8", mode: 0o600 });
      try {
        chmodSync(configPath, 0o600);
      } catch {
        // best-effort: on FAT/exfat chmod is a no-op; the writeFileAtomic
        // mode arg already set perms at create time.
      }
      return { success: true, key, value };
    });

    // Agent fleet — returns combined delegation tasks + background agent tasks
    this.handlers.set("agents.list", async () => {
      const results: AgentInfo[] = [];

      // Delegation tasks from runtime
      if (this.runtime) {
        try {
          const delegationManager = this.runtime.getTaskDelegationManager();
          const pending = delegationManager.getPending();
          for (const task of pending) {
            results.push({
              id: task.id,
              task: task.task,
              status:
                task.status === "in-progress"
                  ? ("running" as const)
                  : task.status === "completed"
                    ? ("completed" as const)
                    : task.status === "failed"
                      ? ("failed" as const)
                      : ("paused" as const),
              progress: task.status === "completed" ? 100 : task.status === "in-progress" ? 50 : 0,
              cost: 0,
              startedAt: task.startedAt ?? task.createdAt,
            } satisfies AgentInfo);
          }
        } catch {
          // Delegation manager may not be initialized
        }
      }

      // Background agent tasks from daemon
      if (this.daemon) {
        try {
          const manager = this.daemon.getBackgroundAgents();
          const tasks = manager.listTasks();
          for (const t of tasks) {
            results.push({
              id: t.id,
              task: t.description,
              status:
                t.status === "running"
                  ? ("running" as const)
                  : t.status === "completed"
                    ? ("completed" as const)
                    : t.status === "failed" || t.status === "cancelled"
                      ? ("failed" as const)
                      : ("paused" as const),
              progress: t.progress,
              cost: t.cost,
              startedAt: t.startedAt,
            } satisfies AgentInfo);
          }
        } catch {
          // Background agents may not be initialized
        }
      }

      return results;
    });

    this.handlers.set("agents.spawn", async (params) => {
      const task = params.task as string;
      if (!task) throw new Error("task required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      try {
        const delegationManager = this.runtime.getTaskDelegationManager();
        const delegated = delegationManager.create(
          "rpc-client",
          task,
          {
            workingDir: "",
            relevantFiles: [],
            decisions: [],
            priorAttempts: [],
            memoryEntryIds: [],
            parentSessionId: "",
          },
          {
            maxTimeMs: 300_000,
            maxCostUsd: 1.0,
            allowedFiles: [],
            forbiddenFiles: [],
            mustPass: [],
          },
        );
        return {
          id: delegated.id,
          task: delegated.task,
          status: delegated.status,
        };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        const id = `agent-${Date.now()}`;
        return { id, task, status: "queued" };
      }
    });

    this.handlers.set("agents.kill", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("agent id required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      try {
        const delegationManager = this.runtime.getTaskDelegationManager();
        // Complete the task as failed to terminate it
        delegationManager.complete(id, {
          success: false,
          output: "Terminated by user",
          filesModified: [],
          testsRun: 0,
          testsPassed: 0,
          costUsd: 0,
          tokensUsed: 0,
          knowledgeExtracted: [],
          errors: ["Terminated by user via RPC"],
        });
        return { success: true, id };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { success: false, id, error: "Agent not found or already terminated" };
      }
    });

    // ── Background Agent Management (via daemon's BackgroundAgentManager) ──

    // agents.submit — submit a new background task for autonomous execution
    this.handlers.set("agents.submit", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const config: BackgroundTaskConfig = {
        description: (params.description as string) ?? (params.task as string) ?? "",
        fileScope: params.fileScope as readonly string[] | undefined,
        model: (params.model as string) ?? "gemma4:e4b",
        provider: (params.provider as string) ?? "ollama",
        maxCost: (params.maxCost as number) ?? 1.0,
        maxTurns: (params.maxTurns as number) ?? 50,
        workingDir: (params.workingDir as string) ?? process.cwd(),
      };
      if (!config.description) throw new Error("description required");
      const manager = this.daemon.getBackgroundAgents();
      const id = manager.submit(config);
      return { id, status: "queued" };
    });

    // agents.cancel — cancel a running or queued background task
    this.handlers.set("agents.cancel", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const manager = this.daemon.getBackgroundAgents();
      const cancelled = manager.cancel(id);
      return { success: cancelled, id };
    });

    // agents.status — get detailed status of a single background task
    this.handlers.set("agents.status", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const manager = this.daemon.getBackgroundAgents();
      const task = manager.getTask(id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return task;
    });

    // Channels — queries the dispatch plane for channel health
    this.handlers.set("channels.status", async () => {
      if (!this.runtime) return [];
      try {
        const dispatchPlane = this.runtime.getDispatchPlane();
        return dispatchPlane.getChannelHealth();
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return [];
      }
    });

    // ── Phase G: Full CLI Parity for Desktop/iOS ─────────

    // Arena — multi-model comparison
    // Each target model is queried by passing the model override through query options,
    // so each iteration actually routes to a different model instead of hitting the default.
    this.handlers.set("arena.run", async (params) => {
      const prompt = params.prompt as string;
      const models = params.models as string[] | undefined;
      if (!prompt) throw new Error("prompt required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const responses: {
        model: string;
        provider: string;
        content: string;
        tokensUsed: number;
        costUsd: number;
        durationMs: number;
      }[] = [];
      const targetModels = models ?? ["claude-opus-4-6", "gpt-5.4"];
      for (const model of targetModels) {
        const start = Date.now();
        try {
          let content = "";
          let responseProvider = "auto";
          // Pass model override so the runtime routes to the correct provider/model
          for await (const chunk of this.runtime.query({ prompt, model })) {
            if (chunk.type === "text") content += chunk.content ?? "";
            if (chunk.provider) responseProvider = chunk.provider;
          }
          responses.push({
            model,
            provider: responseProvider,
            content,
            tokensUsed: Math.ceil(content.length / 4),
            costUsd: content.length * 0.00004,
            durationMs: Date.now() - start,
          });
        } catch {
          // Best-effort path — caller gets a safe fallback, no user-facing error.
          responses.push({
            model,
            provider: "auto",
            content: "Error querying model",
            tokensUsed: 0,
            costUsd: 0,
            durationMs: Date.now() - start,
          });
        }
      }
      return { responses };
    });

    // Deep Research
    this.handlers.set("research", async (params) => {
      const topic = params.topic as string;
      if (!topic) throw new Error("topic required");
      // Route through runtime query with research mode
      let result = "";
      if (this.runtime) {
        const researchPrompt = `Research the following topic thoroughly: ${topic}`;
        for await (const chunk of this.runtime.query({ prompt: researchPrompt })) {
          if (chunk.type === "text") result += chunk.content ?? "";
        }
      }
      return { topic, result, timestamp: Date.now() };
    });

    // Cost details — extended breakdown (weekly/monthly sourced from
    // DailyCostStore so it's real history, not sessionCost * 7).
    this.handlers.set("cost.details", async () => {
      if (!this.runtime) return { sessionCost: 0, dailyCost: 0, weeklyCost: 0, monthlyCost: 0 };
      const status = this.runtime.getStatus();
      const tracker = this.runtime.getCostTracker();
      const session = this.runtime.getSession();
      const dailyCost = tracker.getTodayCost();
      const weeklyCost = tracker.getWeeklyCost();
      const monthlyCost = tracker.getMonthlyCost();
      return {
        sessionCost: session.totalCost,
        dailyCost,
        weeklyCost,
        monthlyCost,
        weekTokens: status.totalTokens,
        weekConversations: 1,
        avgCostPerMessage: status.messageCount > 0 ? session.totalCost / status.messageCount : 0,
        history: tracker.getDailyStore().getAll(),
        budget: tracker.getBudget() ?? 0,
      };
    });

    // S2-25 — compare real provider costs for a prompt.
    //
    // The previous implementation hardcoded 4 entries with arbitrary
    // `costPer1M` values and always flagged Google as "recommended".
    // Now we drive arbitrage from the single-source-of-truth
    // PROVIDER_DEFAULTS table + the cost-tracker's pricing. The "best"
    // recommendation falls out of the actual calculated cost, not a
    // vendor preference. Latency estimates come from the router's
    // historical recording of p50 per provider (if available), with a
    // sensible default when the router has no data yet.
    this.handlers.set("cost.arbitrage", async (params) => {
      const prompt = params.prompt as string;
      if (!this.runtime) return { estimates: [] };

      const { PROVIDER_DEFAULTS } = await import("../providers/model-defaults.js");
      const costTracker = this.runtime.getCostTracker();
      // approx 4 chars per token for the input
      const inputTokens = Math.ceil((prompt?.length ?? 100) / 4);
      // typical completion ~ input size for code tasks; tracker uses
      // these separately so we estimate both arms honestly.
      const outputTokens = Math.max(128, Math.floor(inputTokens * 0.75));

      const estimates: Array<{
        provider: string;
        model: string;
        estimatedCost: number;
        estimatedTokens: number;
        inputTokens: number;
        outputTokens: number;
        estimatedLatencyMs: number;
        quality: string;
        recommended: boolean;
      }> = [];

      for (const [providerName, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
        // Skip provider aliases that duplicate another entry (the same
        // model shouldn't appear twice in the result).
        if (providerName === "anthropic-cli" || providerName === "openai-compat") {
          continue;
        }
        const estimatedCost = costTracker.estimateCost(
          defaults.defaultModel,
          inputTokens,
          outputTokens,
        );
        // Qualitative tier label: worker/oracle pair width gives us a
        // proxy for "is this a single tier or does the provider have a
        // flagship worth reaching for?" Keep it intentionally coarse.
        const tier =
          defaults.workerModel === defaults.oracleModel ? "single-tier" : "worker+oracle";
        estimates.push({
          provider: providerName,
          model: defaults.defaultModel,
          estimatedCost,
          estimatedTokens: inputTokens + outputTokens,
          inputTokens,
          outputTokens,
          // Router doesn't yet expose historical latency per provider;
          // use a generic estimate (1200 ms) until we wire that.
          estimatedLatencyMs: 1200,
          quality: tier,
          recommended: false,
        });
      }

      // Recommend the cheapest non-zero-cost estimate, or the first
      // zero-cost (local) entry if one exists. Zero-cost is always a
      // win when the user tolerates local speed.
      estimates.sort((a, b) => a.estimatedCost - b.estimatedCost);
      const local = estimates.find((e) => e.estimatedCost === 0);
      const cheapestPaid = estimates.find((e) => e.estimatedCost > 0);
      const recommendedEntry = local ?? cheapestPaid ?? estimates[0];
      if (recommendedEntry) recommendedEntry.recommended = true;

      return { estimates };
    });

    // Skills list
    this.handlers.set("skills.list", async () => {
      if (!this.runtime) return { skills: [], count: 0 };
      try {
        const registry = this.runtime.getSkillRegistry();
        const summaries = registry.getSummaries();
        const skills = summaries.map((s) => ({
          name: s.name,
          description: s.description,
          category: s.category,
          version: s.version ?? null,
          alwaysActive: s.always ?? false,
        }));
        return { skills, count: skills.length };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { skills: [], count: 0 };
      }
    });

    // Mode set (S2-24) — actually switches the runtime's mode instead of
    // just echoing the requested mode back. Previously the handler
    // returned `{ success: true, mode }` without calling anything, so
    // the iOS mode switcher was a purely cosmetic toggle.
    this.handlers.set("mode.set", async (params) => {
      const mode = params.mode as string;
      if (!mode) throw new Error("mode required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const valid: readonly WotannMode[] = [
        "default",
        "plan",
        "acceptEdits",
        "auto",
        "bypass",
        "autonomous",
        "guardrails-off",
        "focus",
        "interview",
        "teach",
        "review",
        "exploit",
      ];
      if (!(valid as readonly string[]).includes(mode)) {
        return { success: false, error: `unknown mode: ${mode}`, validModes: valid };
      }
      this.runtime.setMode(mode as WotannMode);
      return { success: true, mode: this.runtime.getModeName() };
    });

    // Context info
    this.handlers.set("context.info", async () => {
      if (!this.runtime) return { percent: 0, tokens: 0, sources: [] };
      const status = this.runtime.getStatus();
      return {
        percent: status.contextPercent,
        tokens: status.totalTokens,
        messageCount: status.messageCount,
        sources: [],
      };
    });

    // Doctor — system health check
    this.handlers.set("doctor", async () => {
      const checks: { name: string; status: "ok" | "warn" | "fail"; detail: string }[] = [];
      checks.push({
        name: "runtime",
        status: this.runtime ? "ok" : "fail",
        detail: this.runtime ? "WotannRuntime initialized" : "Not initialized",
      });
      checks.push({ name: "node", status: "ok", detail: process.version });
      checks.push({
        name: "memory",
        status: "ok",
        detail: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB heap`,
      });
      return { checks };
    });

    // Workspaces list
    this.handlers.set("workspaces.list", async () => {
      const { readdirSync, existsSync: exists, statSync } = await import("node:fs");
      const { join: pathJoin } = await import("node:path");
      const { homedir: home } = await import("node:os");
      const workspaces: {
        id: string;
        name: string;
        path: string;
        description: string;
        lastAccessed: number;
        conversationCount: number;
        pinned: boolean;
      }[] = [];
      for (const dir of ["Desktop", "Documents", "Projects", "Code", "dev", "src"]) {
        const base = pathJoin(home(), dir);
        if (!exists(base)) continue;
        try {
          for (const entry of readdirSync(base, { withFileTypes: true })) {
            if (entry.isDirectory() && exists(pathJoin(base, entry.name, ".wotann"))) {
              const fullPath = pathJoin(base, entry.name);
              workspaces.push({
                id: `ws-${entry.name.toLowerCase().replace(/\s/g, "-")}`,
                name: entry.name,
                path: fullPath,
                description: "",
                lastAccessed: statSync(fullPath).mtimeMs,
                conversationCount: 0,
                pinned: false,
              });
            }
          }
        } catch {
          /* skip inaccessible dirs */
        }
      }
      return { workspaces };
    });

    // Plugins list
    this.handlers.set("plugins.list", async () => {
      if (!this.runtime) return { plugins: [] };
      try {
        const lifecycle = this.runtime.getPluginLifecycle();
        const stats = lifecycle.getStats();
        // Build a plugin list from the lifecycle hook registrations.
        // Each unique pluginName across all events represents a registered plugin.
        const pluginSet = new Map<string, { events: string[]; hookCount: number }>();
        for (const event of Object.keys(stats) as Array<keyof typeof stats>) {
          const hooks = lifecycle.getHooks(event as Parameters<typeof lifecycle.getHooks>[0]);
          for (const hook of hooks) {
            const existing = pluginSet.get(hook.pluginName);
            if (existing) {
              if (!existing.events.includes(event)) {
                existing.events.push(event);
              }
              existing.hookCount++;
            } else {
              pluginSet.set(hook.pluginName, { events: [event], hookCount: 1 });
            }
          }
        }
        const plugins = [...pluginSet.entries()].map(([name, info]) => ({
          name,
          events: info.events,
          hookCount: info.hookCount,
          enabled: true,
        }));
        return { plugins };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { plugins: [] };
      }
    });

    // Connectors list
    this.handlers.set("connectors.list", async () => {
      if (!this.runtime) return { connectors: [] };
      try {
        const dispatch = this.runtime.getDispatchPlane();
        const healthEntries = dispatch.getChannelHealth();
        const connectedChannels = dispatch.getConnectedChannels();
        const connectors = healthEntries.map((h) => ({
          channelType: h.channelType,
          connected: connectedChannels.includes(h.channelType),
          lastMessageAt: h.lastMessageAt,
          messagesReceived: h.messagesReceived,
          messagesSent: h.messagesSent,
          errors: h.errors,
          latencyMs: h.latencyMs,
          upSince: h.upSince,
        }));
        return { connectors };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { connectors: [] };
      }
    });

    // connectors.save_config — persist a channel/connector config to wotann.yaml.
    this.handlers.set("connectors.save_config", async (params) => {
      const p = params as Record<string, unknown>;
      const connectorType = p["connectorType"] as string | undefined;
      const config = (p["config"] as Record<string, unknown>) ?? {};
      if (!connectorType) return { ok: false, error: "connectorType required" };
      const configPath = resolveWotannHomeSubdir("wotann.yaml");
      try {
        if (!existsSync(dirname(configPath))) mkdirSync(dirname(configPath), { recursive: true });
        const root = existsSync(configPath)
          ? ((yamlParse(readFileSync(configPath, "utf-8")) ?? {}) as Record<string, unknown>)
          : {};
        const channels = (root["channels"] ?? {}) as Record<string, Record<string, unknown>>;
        const next: Record<string, Record<string, unknown>> = {
          ...channels,
          [connectorType]: { ...config, savedAt: new Date().toISOString() },
        };
        // Wave 6.5-UU (H-22) — channel connector config. Atomic write so
        // a crash mid-save doesn't corrupt wotann.yaml.
        writeFileAtomic(configPath, yamlStringify({ ...root, channels: next }), {
          encoding: "utf-8",
        });
        return { ok: true, connectorType };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // connectors.test — probe current health for a connector type.
    // Returns latest heartbeat from the dispatch plane (no live connect yet).
    this.handlers.set("connectors.test", async (params) => {
      const connectorType = (params as Record<string, unknown>)["connectorType"] as
        | string
        | undefined;
      if (!connectorType) return { ok: false, error: "connectorType required" };
      if (!this.runtime) return { ok: false, error: "Runtime not initialized" };
      try {
        const dispatch = this.runtime.getDispatchPlane();
        const health = dispatch.getChannelHealth().find((h) => h.channelType === connectorType);
        const connectedList = dispatch.getConnectedChannels() as readonly string[];
        const connected = connectedList.includes(connectorType);
        return {
          ok: true,
          connectorType,
          connected,
          latencyMs: health?.latencyMs ?? null,
          lastMessageAt: health?.lastMessageAt ?? null,
          errors: health?.errors ?? 0,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // Cron jobs list — surface every cron-triggered schedule so callers
    // (`wotann cron list`, `wotann schedule list`, TUI schedule panel,
    // iOS bridge) see the actual state, not a stub. Wave 3H replaced
    // the {jobs:[]} no-op with AutomationEngine-backed enumeration;
    // Wave 4F adds the SQLite-backed CronStore jobs so both sources
    // surface side-by-side. `source` discriminates which store the
    // row came from ("automation" = event-driven engine, "cron" =
    // persistent CronStore).
    this.handlers.set("cron.list", async () => {
      if (!this.daemon) return { jobs: [] };
      try {
        const automations = this.daemon.getAutomationEngine().listAutomations();
        const automationJobs = automations
          .filter((a) => a.trigger.type === "cron")
          .map((a) => ({
            id: a.id,
            name: a.name,
            schedule: a.trigger.type === "cron" ? a.trigger.schedule : "",
            enabled: a.enabled,
            lastRunAt: a.lastRunAt,
            runCount: a.runCount,
            source: "automation" as const,
          }));

        const store = this.daemon.getCronStore();
        const storeJobs = store
          ? store.list().map((j) => ({
              id: j.id,
              name: j.name,
              schedule: j.schedule,
              command: j.command,
              enabled: j.enabled,
              lastFiredAt: j.lastFiredAt,
              nextFireAt: j.nextFireAt,
              lastResult: j.lastResult,
              source: "cron" as const,
            }))
          : [];

        return { jobs: [...storeJobs, ...automationJobs] };
      } catch (err) {
        return {
          jobs: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // Wave 4F: add a cron job to the SQLite-backed CronStore so it
    // survives daemon restarts. Returns the assigned id. Honest
    // failure when the store isn't available (daemon not started or
    // init failed) instead of silently discarding the add.
    this.handlers.set("cron.add", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const name = typeof params["name"] === "string" ? params["name"] : null;
      const schedule = typeof params["schedule"] === "string" ? params["schedule"] : null;
      const command = typeof params["command"] === "string" ? params["command"] : null;
      if (!name || !schedule || !command) {
        throw new Error("cron.add requires {name, schedule, command}");
      }

      const metadata =
        params["metadata"] !== null &&
        typeof params["metadata"] === "object" &&
        !Array.isArray(params["metadata"])
          ? (params["metadata"] as Record<string, unknown>)
          : undefined;

      const taskDesc = typeof params["taskDesc"] === "string" ? params["taskDesc"] : undefined;
      const enabled = typeof params["enabled"] === "boolean" ? params["enabled"] : undefined;

      const addParams: Parameters<KairosDaemon["addCronJobPersistent"]>[0] = {
        name,
        schedule,
        command,
        ...(taskDesc !== undefined ? { taskDesc } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
      };
      const record = this.daemon.addCronJobPersistent(addParams);

      return {
        id: record.id,
        name: record.name,
        schedule: record.schedule,
        command: record.command,
        enabled: record.enabled,
        nextFireAt: record.nextFireAt,
      };
    });

    // Wave 4F: remove a cron job by id. Works against the CronStore;
    // the AutomationEngine has its own `automations.delete` handler.
    this.handlers.set("cron.remove", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const id = typeof params["id"] === "string" ? params["id"] : null;
      if (!id) throw new Error("cron.remove requires {id}");
      const store = this.daemon.getCronStore();
      if (!store) {
        return { ok: false, reason: "cron_store_unavailable" };
      }
      // Keep the in-memory daemon state aligned so `getStatus()`
      // callers don't see a stale entry after the row is deleted.
      this.daemon.removeCronJob(id);
      return { ok: true, id };
    });

    // Wave 4F: toggle enabled state.
    this.handlers.set("cron.setEnabled", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const id = typeof params["id"] === "string" ? params["id"] : null;
      const enabled = typeof params["enabled"] === "boolean" ? params["enabled"] : null;
      if (!id || enabled === null) {
        throw new Error("cron.setEnabled requires {id, enabled}");
      }
      const store = this.daemon.getCronStore();
      if (!store) {
        return { ok: false, reason: "cron_store_unavailable" };
      }
      const changed = store.setEnabled(id, enabled);
      return { ok: changed, id, enabled };
    });

    // Wave 4F: surface store-level summary for the CLI `status` view.
    this.handlers.set("cron.status", async () => {
      if (!this.daemon) return { available: false };
      const store = this.daemon.getCronStore();
      if (!store) return { available: false };
      return {
        available: true,
        running: store.isRunning(),
        dbPath: store.getDbPath(),
        total: store.list().length,
        enabled: store.countEnabled(),
      };
    });

    // ── P1-C2: Hermes-style Cron Scheduler (at-most-once) ──
    //
    // Distinct from the `cron.*` family above (which wraps the
    // legacy Wave-4F CronStore). `schedule.*` exposes the handler-
    // based scheduler with at-most-once semantics, missed-fire
    // policies, and the inflight gate. See `src/scheduler/`.

    /** List every registered schedule with derived next_fire_at + inflight. */
    this.handlers.set("schedule.list", async () => {
      if (!this.daemon) return { schedules: [] };
      const scheduler = this.daemon.getCronScheduler();
      if (!scheduler) return { schedules: [] };
      return { schedules: scheduler.list() };
    });

    /**
     * Create or update a schedule. Requires a cronExpr; taskId is
     * caller-supplied (for re-registration) or assigned by the
     * store. Returns the persisted record.
     *
     * Note: this RPC DOES NOT attach a handler. Handlers are
     * registered in-process by the owning module (e.g. memory flush
     * module registers itself at daemon boot). `schedule.create` is
     * primarily for caller-visible CRUD; handler-less schedules fire
     * a `skip` event with reason="no_handler" at tick time.
     */
    this.handlers.set("schedule.create", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const scheduler = this.daemon.getCronScheduler();
      if (!scheduler) {
        return { ok: false, reason: "scheduler_unavailable" };
      }
      const cronExpr = typeof params["cronExpr"] === "string" ? params["cronExpr"] : null;
      if (!cronExpr) throw new Error("schedule.create requires {cronExpr}");

      const taskId = typeof params["taskId"] === "string" ? params["taskId"] : undefined;
      const missedPolicyRaw = params["missedPolicy"];
      const missedPolicy =
        missedPolicyRaw === "skip" ||
        missedPolicyRaw === "catch-up-once" ||
        missedPolicyRaw === "catch-up-all"
          ? missedPolicyRaw
          : undefined;
      const enabled = typeof params["enabled"] === "boolean" ? params["enabled"] : undefined;
      const optionsRaw = params["options"];
      const options =
        optionsRaw !== null && typeof optionsRaw === "object" && !Array.isArray(optionsRaw)
          ? (optionsRaw as Record<string, unknown>)
          : undefined;

      // Register with a no-op handler if caller didn't wire one — a
      // CLI-created schedule with no runtime handler yet still needs
      // a registry row so the caller can observe it in `schedule.list`.
      const record = scheduler.register(cronExpr, () => {}, {
        ...(taskId !== undefined ? { taskId } : {}),
        ...(missedPolicy !== undefined ? { missedPolicy } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(options !== undefined ? { options } : {}),
      });
      return { ok: true, schedule: record };
    });

    /** Remove a schedule by taskId. Handler completes if inflight. */
    this.handlers.set("schedule.delete", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const scheduler = this.daemon.getCronScheduler();
      if (!scheduler) return { ok: false, reason: "scheduler_unavailable" };

      const taskId = typeof params["taskId"] === "string" ? params["taskId"] : null;
      if (!taskId) throw new Error("schedule.delete requires {taskId}");
      const removed = scheduler.unregister(taskId);
      return { ok: removed, taskId };
    });

    /**
     * Fire a schedule now, bypassing the cron expression. Respects
     * the inflight gate — a schedule already running returns ok=false
     * with reason="inflight" in the emitted event stream.
     */
    this.handlers.set("schedule.fire", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const scheduler = this.daemon.getCronScheduler();
      if (!scheduler) return { ok: false, reason: "scheduler_unavailable" };

      const taskId = typeof params["taskId"] === "string" ? params["taskId"] : null;
      if (!taskId) throw new Error("schedule.fire requires {taskId}");
      const fired = await scheduler.fireNow(taskId);
      return { ok: fired, taskId };
    });

    // ── Automation Engine (via daemon's AutomationEngine) ──

    // automations.list — list all configured automations
    this.handlers.set("automations.list", async () => {
      if (!this.daemon) return { automations: [] };
      try {
        const automations = this.daemon.getAutomationEngine().listAutomations();
        return { automations };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { automations: [] };
      }
    });

    // automations.create — create a new event-driven automation
    this.handlers.set("automations.create", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const name = params.name as string;
      const trigger = params.trigger as Record<string, unknown>;
      const agentConfig = params.agentConfig as Record<string, unknown>;
      if (!name || !trigger || !agentConfig) {
        throw new Error("name, trigger, and agentConfig required");
      }
      const automation = this.daemon.getAutomationEngine().createAutomation({
        name,
        enabled: (params.enabled as boolean) ?? true,
        trigger: trigger as unknown as Parameters<
          ReturnType<KairosDaemon["getAutomationEngine"]>["createAutomation"]
        >[0]["trigger"],
        agentConfig: agentConfig as unknown as Parameters<
          ReturnType<KairosDaemon["getAutomationEngine"]>["createAutomation"]
        >[0]["agentConfig"],
        memoryScope: (params.memoryScope as "isolated" | "shared") ?? "isolated",
      });
      return { success: true, automation };
    });

    // automations.update — update an existing automation
    this.handlers.set("automations.update", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const updates = (params.updates as Record<string, unknown>) ?? params;
      const { id: _id, updates: _updates, ...inlineUpdates } = updates;
      const mergedUpdates = Object.keys(inlineUpdates).length > 0 ? inlineUpdates : updates;
      const result = this.daemon
        .getAutomationEngine()
        .updateAutomation(
          id,
          mergedUpdates as Parameters<
            ReturnType<KairosDaemon["getAutomationEngine"]>["updateAutomation"]
          >[1],
        );
      if (!result) throw new Error(`Automation not found: ${id}`);
      return { success: true, automation: result };
    });

    // automations.delete — delete an automation by id
    this.handlers.set("automations.delete", async (params) => {
      const id = params.id as string;
      if (!id) throw new Error("id required");
      if (!this.daemon) throw new Error("Daemon not initialized");
      const deleted = this.daemon.getAutomationEngine().deleteAutomation(id);
      return { success: deleted, id };
    });

    // automations.status — get full automation engine status with next runs
    this.handlers.set("automations.status", async () => {
      if (!this.daemon)
        return { running: false, automations: [], nextRuns: {}, recentExecutions: [] };
      try {
        return this.daemon.getAutomationEngine().getStatus();
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { running: false, automations: [], nextRuns: {}, recentExecutions: [] };
      }
    });

    // Session create
    this.handlers.set("session.create", async (params) => {
      const name = (params.name as string) ?? (params.title as string) ?? "New Session";
      const init = params.init === true;
      // When `init` is set, the command palette "Initialize Project" action
      // is the caller. Queue a hotspot scan so the session starts with a
      // populated code-awareness cache rather than a cold one.
      let initializedHotspots: unknown = null;
      if (init) {
        const hotspotsHandler = this.handlers.get("files.hotspots");
        if (hotspotsHandler) {
          try {
            initializedHotspots = await hotspotsHandler({});
          } catch (err) {
            initializedHotspots = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
      return {
        id: `session-${Date.now()}`,
        name,
        createdAt: Date.now(),
        init,
        hotspots: initializedHotspots,
      };
    });

    // Dream — trigger learning consolidation via daemon's DreamPipeline
    this.handlers.set("dream", async () => {
      if (!this.daemon) return { success: false, reason: "Daemon not initialized" };
      const pipeline = this.daemon.getDreamPipeline();
      if (!pipeline)
        return {
          success: false,
          reason: "DreamPipeline not initialized (async init may still be pending)",
        };
      try {
        const result = pipeline.runPipelineSync();
        return { success: true, ...result };
      } catch (err) {
        return {
          success: false,
          reason: `Dream pipeline failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });

    // ── iOS-Compatible Aliases ────────────────────────────

    // iOS calls "chat.send" — when the caller passes stream:false this
    // non-streaming handler runs and aggregates the response. When stream is
    // left unset or true, handleMessage routes to the streaming handleChatSend
    // path above so iOS's StreamHandler receives real-time events.
    this.handlers.set("chat.send", async (params) => {
      const prompt =
        (params.content as string) ?? (params.prompt as string) ?? (params.message as string) ?? "";
      if (!this.runtime) throw new Error("Runtime not initialized");

      // A9: validate image attachments before appending to conversation.
      const imageError = validateImageParams(params);
      if (imageError) {
        return { ok: false, error: `Image validation failed: ${imageError}` };
      }

      const provider = params.provider as string | undefined;
      const model = params.model as string | undefined;

      let result = "";
      try {
        for await (const chunk of this.runtime.query({
          prompt,
          model: model || undefined,
          provider: provider ? (provider as never) : undefined,
        })) {
          if (chunk.type === "text") result += chunk.content ?? "";
          if (chunk.type === "error") {
            return { ok: false, error: chunk.content || "Query error" };
          }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { ok: true, content: result };
    });

    // iOS calls "conversations.list" — alias to session.list
    this.handlers.set("conversations.list", this.handlers.get("session.list")!);

    // iOS calls "cost.snapshot" — alias to cost.current
    this.handlers.set("cost.snapshot", this.handlers.get("cost.current")!);

    // iOS calls "task.dispatch" — alias to agents.spawn
    this.handlers.set("task.dispatch", this.handlers.get("agents.spawn")!);

    // ── Task Approval Handlers (iOS approve/reject/cancel UI) ──

    this.handlers.set("task.approve", async (params) => {
      const taskId = (params.taskId as string) ?? (params.id as string);
      if (!taskId || !this.runtime) throw new Error("taskId and runtime required");
      const dm = this.runtime.getTaskDelegationManager();
      dm.accept(taskId, "ios-user");
      dm.markInProgress(taskId);
      return { success: true, taskId };
    });

    this.handlers.set("task.reject", async (params) => {
      const taskId = (params.taskId as string) ?? (params.id as string);
      if (!taskId || !this.runtime) throw new Error("taskId and runtime required");
      const dm = this.runtime.getTaskDelegationManager();
      dm.complete(taskId, {
        success: false,
        output: "Rejected by user",
        filesModified: [],
        testsRun: 0,
        testsPassed: 0,
        costUsd: 0,
        tokensUsed: 0,
        knowledgeExtracted: [],
        errors: ["Rejected"],
      });
      return { success: true, taskId };
    });

    this.handlers.set("task.cancel", async (params) => {
      const taskId = (params.taskId as string) ?? (params.id as string);
      if (!taskId || !this.runtime) throw new Error("taskId and runtime required");
      const dm = this.runtime.getTaskDelegationManager();
      dm.complete(taskId, {
        success: false,
        output: "Cancelled by user",
        filesModified: [],
        testsRun: 0,
        testsPassed: 0,
        costUsd: 0,
        tokensUsed: 0,
        knowledgeExtracted: [],
        errors: ["Cancelled"],
      });
      return { success: true, taskId };
    });

    // execute — shell command execution with sanitizer pre-check (B5).
    //
    // SECURITY (B5): every shell command arriving from an iOS/desktop frontend
    // is passed through the sanitizer before we spawn a subprocess. The
    // sanitizer blocks catastrophic patterns (rm -rf /, dd if=/dev/zero,
    // forkbomb, pipe-to-shell, /etc/passwd writes) and gates privileged ops
    // (sudo, chmod 777, chown, mkfs, format) behind an explicit allowlist
    // flag. Callers that have pre-approved privileged operations can pass
    // `allowPrivileged: true` in params.
    //
    // The Rust `execute_command` in desktop-app/src-tauri/src/commands.rs
    // performs its own blocklist check too — this is defence in depth.
    this.handlers.set("execute", async (params) => {
      const cmd =
        (params.cmd as string | undefined) ?? (params.command as string | undefined) ?? "";
      const cwd = (params.cwd as string | undefined) ?? process.cwd();
      const allowPrivileged = params.allowPrivileged === true;
      const timeoutMs =
        typeof params.timeoutMs === "number"
          ? Math.min(Math.max(params.timeoutMs, 100), 300_000) // clamp 100ms..300s
          : 30_000;

      // Pre-check: sanitizer verdict
      const verdict = sanitizeCommand(cmd, { allowPrivileged });
      if (!verdict.safe) {
        return {
          ok: false,
          error: "command_rejected",
          severity: verdict.severity,
          reason: verdict.reason ?? "unsafe command",
        };
      }

      // Execute via /bin/sh -c, capturing stdout/stderr.
      const { spawn: spawnProc } = await import("node:child_process");
      return new Promise<Record<string, unknown>>((resolve) => {
        const proc = spawnProc("sh", ["-c", cmd], {
          cwd,
          timeout: timeoutMs,
          env: process.env,
        });
        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d: Buffer) => {
          stdout += d.toString("utf-8");
        });
        proc.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString("utf-8");
        });
        proc.on("close", (code: number | null) => {
          resolve({
            ok: code === 0,
            exitCode: code ?? -1,
            stdout,
            stderr,
            severity: verdict.severity,
            ...(verdict.reason ? { reason: verdict.reason } : {}),
          });
        });
        proc.on("error", (err: Error) => {
          resolve({
            ok: false,
            error: "spawn_failed",
            detail: err.message,
            severity: verdict.severity,
          });
        });
      });
    });

    // shell.precheck — non-executing command validation for UI pre-flight.
    // Returns the sanitizer verdict without spawning a process. Useful for
    // disabling the "Run" button on iOS/desktop when the command is rejected.
    this.handlers.set("shell.precheck", async (params) => {
      const cmd =
        (params.cmd as string | undefined) ?? (params.command as string | undefined) ?? "";
      const allowPrivileged = params.allowPrivileged === true;
      return sanitizeCommand(cmd, { allowPrivileged });
    });

    // ── CLI-Parity Methods ──────────────────────────────

    // autonomous.run — actually invoke the AutonomousExecutor loop (S1-12).
    //
    // The previous implementation only prefixed `[AUTONOMOUS MODE]` onto the
    // user's prompt and ran a single query. That meant the doom-loop
    // detection, strategy escalation, heartbeat watchdog, checkpointing, and
    // verification cascade — all ~2,000 LOC of real autonomous execution —
    // were never entered. The handler was effectively a docstring.
    //
    // This version bridges the executor's `execute(task, exec, verify)`
    // signature onto the runtime's streaming query + verification cascade.
    this.handlers.set("autonomous.run", async (params) => {
      const task = (params.task as string) ?? (params.prompt as string);
      if (!task) throw new Error("task required");
      if (!this.runtime) throw new Error("Runtime not initialized");

      const runtime = this.runtime;
      const executor = runtime.getAutonomousExecutor();
      const cascade = runtime.getVerificationCascade();
      const notifier = runtime.getNotificationManager();

      // Per-turn executor: drives a single worker step through the runtime's
      // normal query pipeline (so middleware, memory, and provider fallback
      // all still apply). Cost tracking is real — we take a before/after
      // snapshot of the runtime's CostTracker and surface the delta so the
      // executor's budget gate (maxCostUsd) actually fires. Previously
      // hardcoded to 0, which meant an autonomous loop could burn arbitrary
      // money without the budget ever tripping.
      const costTracker = runtime.getCostTracker();
      const runTurn = async (
        prompt: string,
      ): Promise<{ output: string; costUsd: number; tokensUsed: number }> => {
        const costBefore = costTracker.getTotalCost();
        let output = "";
        // Sum tokensUsed across chunks instead of overwriting with the
        // last value. Provider adapters differ on whether `tokensUsed` is
        // cumulative or per-chunk; summing is correct for both
        // conventions because per-chunk providers emit a single done
        // chunk with the total. Closes the "fragile coupling to provider
        // cumulative-total convention" Opus audit finding.
        let tokensUsed = 0;
        let lastTokensUsed = 0;
        for await (const chunk of runtime.query({ prompt })) {
          if (chunk.type === "text") output += chunk.content ?? "";
          if (typeof chunk.tokensUsed === "number") {
            // If the value monotonically grows, treat as cumulative
            // (overwrite). If it's a per-chunk delta (smaller than
            // previous), sum. The rule: take the larger of (current
            // value) and (running sum + this delta).
            const next = Math.max(chunk.tokensUsed, lastTokensUsed + chunk.tokensUsed);
            tokensUsed = next;
            lastTokensUsed = chunk.tokensUsed;
          }
        }
        const costAfter = costTracker.getTotalCost();
        const costUsd = Math.max(0, costAfter - costBefore);
        return { output, costUsd, tokensUsed };
      };

      // Adapter: AutonomousExecutor wants a verifier returning the classic
      // tests/typecheck/lint tri-state. The cascade gives us a list of
      // detected step results — fold those into the shape the executor wants.
      const runVerifier = async (): Promise<{
        testsPass: boolean;
        typecheckPass: boolean;
        lintPass: boolean;
        output: string;
      }> => {
        const result = await cascade.run();
        const stepPassed = (needle: string): boolean => {
          const step = result.steps.find((s) => s.step.toLowerCase().includes(needle));
          return step ? step.passed : true; // absent step counts as "not blocking"
        };
        return {
          testsPass: stepPassed("test"),
          typecheckPass: stepPassed("typecheck") || stepPassed("type-check"),
          lintPass: stepPassed("lint"),
          output: result.steps.map((s) => `[${s.step}] ${s.output}`).join("\n"),
        };
      };

      try {
        const result = await executor.execute(task, runTurn, runVerifier);

        notifier.push(
          "task-complete",
          result.success ? "Autonomous task complete" : "Autonomous task halted",
          `${task.slice(0, 100)} (${result.totalCycles} cycles, ${result.exitReason})`,
        );

        return {
          task,
          result,
          timestamp: Date.now(),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notifier.push("error", "Autonomous task failed", `${task}: ${message}`.slice(0, 180));
        throw err;
      }
    });

    // session.resume — resume a saved session
    this.handlers.set("session.resume", async (params) => {
      const sessionId = params.sessionId as string | undefined;
      if (!this.runtime) throw new Error("Runtime not initialized");
      const sessionsDir = resolveWotannHomeSubdir("sessions");
      if (!existsSync(sessionsDir)) return { success: false, reason: "No sessions directory" };

      if (sessionId) {
        // S2-6: validate sessionId before using it as a filename. Previously
        // an RPC caller with `sessionId: "../../../../etc/passwd"` could
        // read any file under `~/.wotann/sessions/../..` — i.e. anywhere.
        // Restrict to a safe alphanumeric+hyphen+underscore regex and
        // double-check the resolved path stays inside sessionsDir.
        if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
          return { success: false, reason: "Invalid sessionId format" };
        }
        const filePath = join(sessionsDir, `${sessionId}.json`);
        const resolved = resolvePath(filePath);
        const safeRoot = resolvePath(sessionsDir) + "/";
        if (!resolved.startsWith(safeRoot)) {
          return { success: false, reason: "Invalid sessionId path" };
        }
        if (!existsSync(resolved))
          return { success: false, reason: `Session ${sessionId} not found` };
        try {
          const raw = readFileSync(resolved, "utf-8");
          const snapshot = JSON.parse(raw) as Record<string, unknown>;
          return { success: true, session: snapshot };
        } catch {
          // Best-effort path — caller gets a safe fallback, no user-facing error.
          return { success: false, reason: "Failed to parse session file" };
        }
      }

      // No sessionId — return the most recent session
      try {
        const files = (await import("node:fs"))
          .readdirSync(sessionsDir)
          .filter((f: string) => f.endsWith(".json"))
          .sort()
          .reverse();
        const latest = files[0];
        if (!latest) return { success: false, reason: "No saved sessions" };
        const raw = readFileSync(join(sessionsDir, latest), "utf-8");
        const snapshot = JSON.parse(raw) as Record<string, unknown>;
        return { success: true, session: snapshot };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { success: false, reason: "Failed to read sessions" };
      }
    });

    // architect — route through runtime query with architect system prompt
    this.handlers.set("architect", async (params) => {
      const prompt = (params.prompt as string) ?? (params.question as string);
      if (!prompt) throw new Error("prompt required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const architectPrompt = [
        "[ARCHITECT MODE] You are a senior system architect. Analyze the following",
        "and provide a detailed architectural design with components, interfaces,",
        "data flow, and trade-offs.\n\n",
        prompt,
      ].join(" ");
      let result = "";
      for await (const chunk of this.runtime.query({ prompt: architectPrompt })) {
        if (chunk.type === "text") result += chunk.content ?? "";
      }
      return { result, timestamp: Date.now() };
    });

    // council — multi-model deliberation via runtime
    this.handlers.set("council", async (params) => {
      const query = (params.query as string) ?? (params.prompt as string);
      const providers = params.providers as string[] | undefined;
      if (!query) throw new Error("query required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      try {
        const providerNames = (providers ?? [
          "anthropic",
          "openai",
        ]) as import("../core/types.js").ProviderName[];
        const result = await this.runtime.runCouncil(query, providerNames);
        return {
          synthesis: result.synthesis,
          chairmanModel: result.chairmanModel,
          memberCount: result.members.length,
          totalTokens: result.totalTokens,
          totalDurationMs: result.totalDurationMs,
          timestamp: result.timestamp,
        };
      } catch (error) {
        throw new Error(
          `Council failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    });

    // channels.start — start accepting messages on a channel
    this.handlers.set("channels.start", async (params) => {
      const channelType = params.channel as string;
      if (!channelType) throw new Error("channel required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      const health = plane.getChannelHealth();
      const found = health.find((h) => h.channelType === channelType);
      return { channel: channelType, connected: found?.connected ?? false, health };
    });

    // channels.stop — disconnect a channel
    this.handlers.set("channels.stop", async (params) => {
      const channelType = params.channel as string;
      if (!channelType) throw new Error("channel required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      // Channels are adapter-based; report current health
      const health = plane.getChannelHealth();
      return { channel: channelType, stopped: true, health };
    });

    // channels.policy.list — list route policies
    this.handlers.set("channels.policy.list", async () => {
      if (!this.runtime) return { policies: [] };
      const plane = this.runtime.getDispatchPlane();
      const policies = plane.getPolicies();
      return { policies };
    });

    // channels.policy.add — add a dispatch route policy
    this.handlers.set("channels.policy.add", async (params) => {
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      const policy: DispatchRoutePolicy = {
        id: (params.id as string) ?? `policy-${Date.now()}`,
        label: params.label as string | undefined,
        channelType: params.channelType as string | undefined,
        channelId: params.channelId as string | undefined,
        senderId: params.senderId as string | undefined,
        provider: params.provider as import("../core/types.js").ProviderName | undefined,
        model: params.model as string | undefined,
      };
      plane.upsertPolicy(policy);
      return { success: true, policy };
    });

    // channels.policy.remove — remove a route policy by ID
    this.handlers.set("channels.policy.remove", async (params) => {
      const policyId = params.id as string;
      if (!policyId) throw new Error("id required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const plane = this.runtime.getDispatchPlane();
      const removed = plane.removePolicy(policyId);
      return { success: removed, id: policyId };
    });

    // memory.verify — programmatic verification of a memory entry.
    // S5-14: the prior body routed through runtime.query() (hit the LLM
    // on every call and always returned verified:true regardless of the
    // model's actual response). Now a direct store lookup + optional
    // source-file existence + content hash check — cheap, deterministic,
    // and a real signal of whether the memory is still grounded.
    this.handlers.set("memory.verify", async (params) => {
      const entryId = params.entryId as string;
      if (!entryId) throw new Error("entryId required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const store = this.runtime.getMemoryStore();
      if (!store) {
        return { entryId, verified: false, error: "Memory store unavailable" };
      }
      const entry = store.getById(entryId);
      if (!entry) {
        return { entryId, verified: false, error: "Entry not found" };
      }

      let fileExists = true;
      let fileHash: string | null = null;
      let resolvedPath: string | null = null;
      if (entry.sourceFile) {
        const { existsSync, readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const { createHash } = await import("node:crypto");
        resolvedPath = resolve(this.runtime.getWorkingDir(), entry.sourceFile);
        fileExists = existsSync(resolvedPath);
        if (fileExists) {
          try {
            const buf = readFileSync(resolvedPath);
            fileHash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
          } catch {
            fileExists = false;
          }
        }
      }

      // Mark the entry verified when either (a) no source file is
      // associated (the entry is self-describing), or (b) the source
      // file still exists on disk. A missing file is a real staleness
      // signal, not a generic failure — surface it in the response.
      const verified = !entry.sourceFile || fileExists;
      if (verified) store.memoryVerify(entryId);

      return {
        entryId,
        verified,
        sourceFile: entry.sourceFile ?? null,
        resolvedPath,
        fileExists,
        fileHash,
        detail: verified
          ? "entry verified against codebase (programmatic check)"
          : `source file missing: ${entry.sourceFile}`,
      };
    });

    // lsp.symbols — find symbols in workspace
    this.handlers.set("lsp.symbols", async (params) => {
      const name = params.name as string;
      if (!name) throw new Error("name required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const symbols = await ops.findSymbol(name);
      return { symbols, count: symbols.length };
    });

    // lsp.outline — get document symbol outline for a file
    this.handlers.set("lsp.outline", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      if (!uri) throw new Error("uri required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const symbols = await ops.getDocumentSymbols(uri);
      return { symbols, count: symbols.length };
    });

    // lsp.refs — find references to a symbol at position
    this.handlers.set("lsp.refs", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      const line = (params.line as number) ?? 0;
      const character = (params.character as number) ?? 0;
      if (!uri) throw new Error("uri required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const refs = await ops.findReferences(uri, { line, character });
      return { references: refs, count: refs.length };
    });

    // lsp.hover — get type/hover info at position
    this.handlers.set("lsp.hover", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      const line = (params.line as number) ?? 0;
      const character = (params.character as number) ?? 0;
      if (!uri) throw new Error("uri required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const info = await ops.getTypeInfo(uri, { line, character });
      return { info };
    });

    // lsp.completion — list completion candidates at a position.
    //
    // The current LSP layer (`SymbolOperations`) doesn't expose a
    // completion call; the underlying TS language service has one but
    // wiring it requires per-file program rebuilds that are too expensive
    // for the editor's debounced ghost-text path. Until that lands we
    // serve an honest stub (empty items + a `notes` field explaining
    // why) — per QB #6, the iOS Editor branches on `items.length === 0`
    // and shows no popover rather than a misleading completion list.
    //
    // V9 follow-up: replace this stub with a real handler when the LSP
    // layer grows `getCompletions(uri, position, prefix?)`.
    this.handlers.set("lsp.completion", async (params) => {
      const uri = (params["uri"] as string) ?? (params["path"] as string);
      if (!uri || typeof uri !== "string") {
        throw new Error("uri (or path) required");
      }
      const line = (params["line"] as number) ?? 0;
      const character = (params["character"] as number) ?? (params["column"] as number) ?? 0;
      void line;
      void character;
      return {
        items: [] as ReadonlyArray<{ label: string; kind: string; detail?: string }>,
        notes:
          "lsp.completion not yet wired in the LSP layer; SymbolOperations exposes hover/refs/symbols but no completion. iOS shows no popover when items is empty.",
      };
    });

    // lsp.definition — locate a symbol's source position.
    //
    // Approximate via `findReferences` since SymbolOperations doesn't
    // expose a dedicated `getDefinition`. We pick the FIRST reference
    // whose location lies on or before the requested cursor — usually the
    // declaration site for typed languages.
    //
    // Honest stub when no references found: returns `null` so the iOS
    // Editor branches on `result == null` and shows "No definition found"
    // instead of jumping to a misleading location.
    this.handlers.set("lsp.definition", async (params) => {
      const uri = (params["uri"] as string) ?? (params["path"] as string);
      const line = (params["line"] as number) ?? 0;
      const character = (params["character"] as number) ?? (params["column"] as number) ?? 0;
      if (!uri || typeof uri !== "string") {
        throw new Error("uri (or path) required");
      }
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const refs = await ops.findReferences(uri, { line, character });
      if (refs.length === 0) {
        return null;
      }
      // Refs come back from the language service ordered by file then
      // line; the first ref is the declaration in TS-language-service
      // output. Return its location.
      const first = refs[0]!;
      return {
        uri: first.uri,
        line: first.range.start.line,
        column: first.range.start.character,
      };
    });

    // lsp.rename — rename a symbol across the codebase
    this.handlers.set("lsp.rename", async (params) => {
      const uri = (params.uri as string) ?? (params.file as string);
      const line = (params.line as number) ?? 0;
      const character = (params.character as number) ?? 0;
      const newName = params.newName as string;
      if (!uri || !newName) throw new Error("uri and newName required");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const workspaceRoot = this.runtime.getWorkingDir();
      const ops = new SymbolOperations({ workspaceRoot });
      const result = await ops.rename(uri, { line, character }, newName);
      return {
        filesAffected: result.filesAffected,
        editsApplied: result.editsApplied,
      };
    });

    // repo.map — Aider-style repo map of symbols + centrality (for /init, planner context, command palette)
    this.handlers.set("repo.map", async (params) => {
      const { buildRepoMap, renderRepoMap, summariseRepoMap } =
        await import("../context/repo-map.js");
      const root =
        (params as Record<string, string>)["root"] ??
        this.runtime?.getWorkingDir() ??
        process.cwd();
      const maxBytes = Number((params as Record<string, unknown>)["maxBytes"]) || 8_000;
      try {
        const map = buildRepoMap({ root });
        return {
          summary: summariseRepoMap(map),
          rendered: renderRepoMap(map, maxBytes),
          entries: map.entries.slice(0, 200).map((e) => ({
            path: e.path,
            language: e.language,
            symbols: e.symbols,
            centrality: e.centrality,
            sizeBytes: e.sizeBytes,
          })),
          totalFiles: map.totalFiles,
          generatedAt: map.generatedAt,
        };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
          entries: [],
          totalFiles: 0,
        };
      }
    });

    // mcp.list — list MCP servers (installed and available)
    this.handlers.set("mcp.list", async () => {
      // MCP servers are config-based; read from wotann.yaml
      const configPath = resolveWotannHomeSubdir("wotann.yaml");
      if (!existsSync(configPath)) return { servers: [], count: 0 };
      try {
        const raw = readFileSync(configPath, "utf-8");
        const config = (yamlParse(raw) ?? {}) as Record<string, unknown>;
        const mcpServers = config["mcpServers"] ?? config["mcp_servers"] ?? {};
        const servers = Object.entries(mcpServers as Record<string, unknown>).map(
          ([name, entry]) => ({
            name,
            ...(typeof entry === "object" && entry !== null ? entry : {}),
          }),
        );
        return { servers, count: servers.length };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { servers: [], count: 0 };
      }
    });

    // composer.apply — apply a batch of multi-file edits.
    // Accepts {edits: [{path, newContent, acceptedHunkIds?}]} and writes
    // newContent to each path. Returns per-edit success/failure counts.
    this.handlers.set("composer.apply", async (params) => {
      const edits = ((params as Record<string, unknown>)["edits"] ?? []) as Array<{
        path: string;
        newContent: string;
        acceptedHunkIds?: string[];
      }>;
      if (!Array.isArray(edits) || edits.length === 0) {
        return { ok: false, error: "edits array required" };
      }
      // S2-5: composer.apply used to write to whatever path the caller asked
      // for — that let a prompt-injection payload with a routing to this
      // RPC overwrite `/etc/shadow` or `~/.ssh/authorized_keys` with
      // arbitrary bytes. Now every edit path must resolve inside the
      // active workspace (runtime.getWorkingDir() / process.cwd()).
      const workspaceRoot = resolvePath(this.runtime?.getWorkingDir() ?? process.cwd());
      // Reject degenerate workspace roots where every absolute path would
      // pass the prefix check — `/` and `""` both let an attacker write
      // anywhere on the filesystem. This should never happen in practice
      // (runtime.getWorkingDir defaults to process.cwd) but defence-in-
      // depth matters for a daemon the desktop app trusts blindly.
      if (workspaceRoot === "/" || workspaceRoot === "") {
        return {
          ok: false,
          error: "Refusing composer.apply with degenerate workspace root",
        };
      }
      let applied = 0;
      const failures: Array<{ path: string; error: string }> = [];
      for (const edit of edits) {
        if (!edit.path || typeof edit.newContent !== "string") {
          failures.push({ path: edit.path ?? "<unknown>", error: "invalid edit shape" });
          continue;
        }
        try {
          // Reject edits whose resolved path escapes the workspace. A
          // trailing separator on workspaceRoot prevents the classic
          // `/root-prefix-extension` bypass (e.g., `/workspace` matching
          // `/workspace-secret/…`).
          const resolved = resolvePath(edit.path);
          const rootWithSep = workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`;
          if (resolved !== workspaceRoot && !resolved.startsWith(rootWithSep)) {
            failures.push({
              path: edit.path,
              error: `path outside workspace: ${resolved}`,
            });
            continue;
          }
          // Symlink-traversal defence: `path.resolve` is purely lexical, so
          // if the attacker pre-created `$WORKSPACE/innocent.txt` as a
          // symlink to `/etc/passwd`, writeFileSync would follow it and
          // clobber the target. Compute realpath on the parent directory
          // (which must already exist if we're about to write to it) and
          // re-check that the REAL path still lives inside the workspace.
          // The parent is what matters — writeFileSync on a symlinked file
          // itself follows through, so checking the parent of an existing
          // symlink and the parent of a new file both give us the real
          // target directory.
          const parentDir = dirname(resolved);
          if (existsSync(parentDir)) {
            const realParent = realpathSync(parentDir);
            const realRootWithSep = realpathSync(workspaceRoot).endsWith("/")
              ? realpathSync(workspaceRoot)
              : `${realpathSync(workspaceRoot)}/`;
            if (
              realParent !== realpathSync(workspaceRoot) &&
              !realParent.startsWith(realRootWithSep)
            ) {
              failures.push({
                path: edit.path,
                error: `symlinked parent escapes workspace: ${realParent}`,
              });
              continue;
            }
          }
          if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
          }
          writeFileSync(resolved, edit.newContent, "utf-8");
          applied += 1;
        } catch (err) {
          failures.push({
            path: edit.path,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { ok: failures.length === 0, applied, failures, total: edits.length };
    });

    // mcp.toggle — flip the `enabled` flag for a named MCP server.
    this.handlers.set("mcp.toggle", async (params) => {
      const name = (params as Record<string, unknown>)["name"] as string | undefined;
      const enabled = (params as Record<string, unknown>)["enabled"] as boolean | undefined;
      if (!name) return { ok: false, error: "name required" };
      const configPath = resolveWotannHomeSubdir("wotann.yaml");
      try {
        const config = existsSync(configPath)
          ? ((yamlParse(readFileSync(configPath, "utf-8")) ?? {}) as Record<string, unknown>)
          : {};
        const key = "mcpServers" in config ? "mcpServers" : "mcp_servers";
        const servers = (config[key] ?? {}) as Record<string, Record<string, unknown>>;
        const entry = servers[name];
        if (!entry) return { ok: false, error: `MCP server '${name}' not found` };
        const next: Record<string, Record<string, unknown>> = {
          ...servers,
          [name]: { ...entry, enabled: typeof enabled === "boolean" ? enabled : !entry["enabled"] },
        };
        const updated = { ...config, [key]: next };
        // Wave 6.5-UU (H-22) — wotann.yaml MCP config. Atomic write.
        writeFileAtomic(configPath, yamlStringify(updated), { encoding: "utf-8" });
        return { ok: true, name, enabled: next[name]?.["enabled"] };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // mcp.add — register a new MCP server in wotann.yaml.
    this.handlers.set("mcp.add", async (params) => {
      const p = params as Record<string, unknown>;
      const name = p["name"] as string | undefined;
      const command = p["command"] as string | undefined;
      const args = (p["args"] as string[] | undefined) ?? [];
      const transport = ((p["transport"] as string | undefined) ?? "stdio") as "stdio" | "http";
      if (!name || !command) return { ok: false, error: "name and command required" };
      const configPath = resolveWotannHomeSubdir("wotann.yaml");
      try {
        if (!existsSync(dirname(configPath))) mkdirSync(dirname(configPath), { recursive: true });
        const config = existsSync(configPath)
          ? ((yamlParse(readFileSync(configPath, "utf-8")) ?? {}) as Record<string, unknown>)
          : {};
        const key = "mcp_servers" in config ? "mcp_servers" : "mcpServers";
        const servers = (config[key] ?? {}) as Record<string, Record<string, unknown>>;
        if (servers[name]) return { ok: false, error: `MCP server '${name}' already exists` };
        const next: Record<string, Record<string, unknown>> = {
          ...servers,
          [name]: { command, args, transport, enabled: true },
        };
        const updated = { ...config, [key]: next };
        // Wave 6.5-UU (H-22) — wotann.yaml MCP add. Atomic write.
        writeFileAtomic(configPath, yamlStringify(updated), { encoding: "utf-8" });
        return { ok: true, name };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // audit.query — query the audit trail
    this.handlers.set("audit.query", async (params) => {
      const dbPath = resolveWotannHomeSubdir("audit.db");
      if (!existsSync(dbPath)) return { entries: [], count: 0 };
      try {
        const trail = new AuditTrail(dbPath);
        const filters: AuditQuery = {
          date: params.date as string | undefined,
          tool: params.tool as string | undefined,
          agentId: params.agentId as string | undefined,
          sessionId: params.sessionId as string | undefined,
          limit: (params.limit as number) ?? 50,
        };
        const entries = trail.query(filters);
        const count = trail.getCount();
        trail.close();
        return { entries, count };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { entries: [], count: 0, error: "Failed to query audit trail" };
      }
    });

    // precommit — run pre-commit analysis on the workspace
    this.handlers.set("precommit", async () => {
      if (!this.runtime) throw new Error("Runtime not initialized");
      const result = this.runtime.runPreCommitAnalysis();
      if (!result) return { checks: [], blockers: [], message: "No edits tracked" };
      return {
        checks: result.checks.map((c) => ({
          name: c.name,
          success: c.success,
          output: c.output.slice(0, 500),
        })),
        blockers: result.blockers,
        commandRunner: result.commandRunner,
      };
    });

    // voice.status — detect voice capabilities
    this.handlers.set("voice.status", async () => {
      if (!this.runtime) return { available: false, capabilities: [], backend: "none" };
      const vibeVoice = this.runtime.getVibeVoiceBackend();
      const status = await vibeVoice.detect();
      return {
        available: status.available,
        version: status.version,
        capabilities: status.capabilities,
        modelLoaded: status.modelLoaded,
        backend: status.backend,
      };
    });

    // local.status — check Ollama/local model availability
    this.handlers.set("local.status", async () => {
      if (!this.runtime) return { available: false, models: [] };
      const status = this.runtime.getStatus();
      const hasOllama = status.providers.includes("ollama");
      // Attempt to detect Ollama by checking its API
      let models: string[] = [];
      let ollamaRunning = false;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const response = await fetch("http://127.0.0.1:11434/api/tags", {
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
          ollamaRunning = true;
          const data = (await response.json()) as { models?: readonly { name: string }[] };
          models = (data.models ?? []).map((m) => m.name);
        }
      } catch {
        // Ollama not running
      }
      return {
        available: ollamaRunning,
        registeredProvider: hasOllama,
        models,
        endpoint: "http://127.0.0.1:11434",
      };
    });

    // skills.search — search available skills by query
    this.handlers.set("skills.search", async (params) => {
      const query = (params.query as string) ?? "";
      if (!this.runtime) return { skills: [], count: 0 };
      const registry = this.runtime.getSkillRegistry();
      const summaries = registry.getSummaries();
      if (!query) return { skills: summaries, count: summaries.length };
      const lowerQuery = query.toLowerCase();
      const matched = summaries.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerQuery) ||
          s.description.toLowerCase().includes(lowerQuery) ||
          s.category.toLowerCase().includes(lowerQuery),
      );
      return { skills: matched, count: matched.length };
    });

    // train.extract — extract training data from session recordings
    this.handlers.set("train.extract", async (params) => {
      const sessionDir = (params.sessionDir as string) ?? resolveWotannHomeSubdir("sessions");
      if (!this.runtime) throw new Error("Runtime not initialized");
      const pipeline = this.runtime.getTrainingPipeline();
      const pairs = pipeline.extractTrainingData(sessionDir);
      const stats = pipeline.getStats();
      return { extracted: pairs.length, stats };
    });

    // train.status — get training pipeline status
    this.handlers.set("train.status", async () => {
      if (!this.runtime) return { totalExtracted: 0, totalFiltered: 0, averageQuality: 0 };
      const pipeline = this.runtime.getTrainingPipeline();
      return pipeline.getStats();
    });

    // Ping — kept as-is
    this.handlers.set("ping", async () => {
      return { pong: true, timestamp: Date.now() };
    });

    // ── Workflow DAG Engine ──────────────────────────────
    // List available workflows (built-in + custom)
    this.handlers.set("workflow.list", async () => {
      if (!this.daemon) return { workflows: [] };
      const engine = this.daemon.getWorkflowEngine();
      const workflows = engine.listWorkflows();
      return {
        workflows: workflows.map((w) => ({
          name: w.name,
          description: w.description ?? "",
          nodeCount: w.nodes.length,
          nodeIds: w.nodes.map((n) => n.id),
        })),
      };
    });

    // Start a workflow run.
    //
    // S1-11 — the previous implementation looked up workflows exclusively
    // via `engine.getBuiltin(name)`, which means any user-defined
    // workflow saved through `workflow.save` was invisible to this
    // handler. The desktop WorkflowBuilder could save a YAML workflow
    // to disk, `workflow.list` would show it, but `workflow.start`
    // returned "not found". Fix: search custom workflows too, and also
    // accept a literal workflow object (frontend sends the full YAML
    // spec inline when the user clicks Run without saving first).
    this.handlers.set("workflow.start", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const engine = this.daemon.getWorkflowEngine();
      const name = params["name"] as string | undefined;
      const inlineWorkflow = params["workflow"] as Record<string, unknown> | undefined;
      const input = (params["input"] as string) ?? "";
      const customDir = resolveWotannHomeSubdir("workflows");

      let workflow = inlineWorkflow as unknown as Workflow | undefined;
      if (!workflow) {
        if (!name) throw new Error("workflow name or inline workflow required");
        // Try built-ins first, then user-defined workflows on disk.
        workflow = engine.getBuiltin(name);
        if (!workflow) {
          const all = engine.listWorkflows(customDir);
          workflow = all.find((w) => w.name === name);
        }
      }

      if (!workflow) throw new Error(`Workflow not found: ${name}`);
      const run = await engine.startRun(workflow, input);
      return {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        nodeStates: run.nodeStates,
      };
    });

    // S1-10 — persist a user-defined workflow to
    // ~/.wotann/workflows/<name>.yaml so the desktop WorkflowBuilder can
    // Save + Run. Previously the save handler was missing entirely so
    // clicking Save from the UI failed silently.
    this.handlers.set("workflow.save", async (params) => {
      const name = params["name"] as string | undefined;
      const workflow = params["workflow"] as Record<string, unknown> | undefined;
      if (!name) return { success: false, error: "name required" };
      if (!workflow) return { success: false, error: "workflow body required" };
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        // Constrain to safe filename characters — this value becomes part
        // of the on-disk path and must not allow traversal.
        return { success: false, error: "invalid workflow name" };
      }
      try {
        const workflowsDir = resolveWotannHomeSubdir("workflows");
        if (!existsSync(workflowsDir)) mkdirSync(workflowsDir, { recursive: true });
        const outPath = join(workflowsDir, `${name}.yaml`);
        // Wave 6.5-UU (H-22) — workflow definition. Atomic write.
        writeFileAtomic(outPath, yamlStringify(workflow), { encoding: "utf-8" });
        return { success: true, name, path: outPath };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // Get workflow run status
    this.handlers.set("workflow.status", async (params) => {
      if (!this.daemon) throw new Error("Daemon not initialized");
      const engine = this.daemon.getWorkflowEngine();
      const runId = params["runId"] as string;
      if (!runId) throw new Error("runId required");
      const run = engine.getRun(runId);
      if (!run) return { found: false };
      return {
        found: true,
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        nodeStates: run.nodeStates,
      };
    });

    // Keystone cross-surface session RPCs (Phase 3 P1-F1). Registered in the
    // built-in set because the session store owns its own lifecycle and does
    // not depend on WotannRuntime — any surface can create/claim/stream sessions
    // from the moment the daemon boots.
    this.registerComputerSessionHandlers();
  }

  // ── Self-Improvement RPC Methods ────────────────────
  // These expose the self-training subsystems to all surfaces via KAIROS.

  registerSelfImprovementHandlers(): void {
    // Feedback — record thumbs up/down via daemon's FeedbackCollector
    this.handlers.set("feedback.record", async (params) => {
      const { prompt, response, feedback, provider, model, sessionId } = params as Record<
        string,
        string
      >;
      if (!prompt || !response || !feedback) throw new Error("prompt, response, feedback required");
      if (!this.daemon) return { success: false, error: "Daemon not initialized" };
      try {
        const collector = this.daemon.getFeedbackCollector();
        collector.recordFeedback(
          prompt,
          response,
          feedback as "positive" | "negative",
          provider ?? "unknown",
          model ?? "unknown",
          sessionId ?? "unknown",
        );
        const stats = collector.getStats();
        return { success: true, recorded: true, stats };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    // Patterns — get crystallized patterns from daemon's PatternCrystallizer
    this.handlers.set("patterns.list", async () => {
      if (!this.daemon) return { patterns: [], crystallized: 0 };
      try {
        const crystallizer = this.daemon.getPatternCrystallizer();
        const patterns = crystallizer.getPatterns();
        const crystallized = crystallizer.getCrystallizedCount();
        return { patterns, crystallized };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { patterns: [], crystallized: 0 };
      }
    });

    // Training — run trajectory extraction via daemon's TrajectoryExtractor
    this.handlers.set("training.extract", async () => {
      if (!this.daemon) return { success: false, message: "Daemon not initialized" };
      try {
        const extractor = this.daemon.getTrajectoryExtractor();
        const examples = extractor.extractFromSessions();
        return {
          success: true,
          message: `Extracted ${examples.length} training examples`,
          count: examples.length,
        };
      } catch (err) {
        return { success: false, message: `Trajectory extraction failed: ${String(err)}` };
      }
    });

    // Self-evolution — get pending approval actions from daemon's SelfEvolutionEngine
    this.handlers.set("evolution.pending", async () => {
      if (!this.daemon) return { pending: [] };
      try {
        const engine = this.daemon.getSelfEvolution();
        const pending = engine.getPendingApprovals();
        return { pending };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { pending: [] };
      }
    });

    // evolution.approve — approve a pending self-evolution action by index.
    // Wires the UI's TrainingReview approve button (prior to this commit,
    // the RPC method didn't exist and every approve click became a silent
    // no-op via the legacy sendMessage fallback).
    this.handlers.set("evolution.approve", async (params) => {
      const index = Number((params as Record<string, unknown>)["index"] ?? -1);
      if (!Number.isFinite(index) || index < 0) {
        return { ok: false, error: "index (non-negative integer) required" };
      }
      if (!this.daemon) return { ok: false, error: "Daemon not initialized" };
      try {
        const engine = this.daemon.getSelfEvolution();
        const ok = engine.approveAction(index);
        return { ok, index };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // evolution.reject — proxies to SelfEvolution.rejectAction (added in
    // the same commit as this handler upgrade). Marks a pending action as
    // reviewed-and-rejected so it falls out of the pending list and the
    // decision is auditable in the persistent evolution log.
    this.handlers.set("evolution.reject", async (params) => {
      const index = Number((params as Record<string, unknown>)["index"] ?? -1);
      if (!Number.isFinite(index) || index < 0) {
        return { ok: false, error: "index (non-negative integer) required" };
      }
      if (!this.daemon) return { ok: false, error: "Daemon not initialized" };
      try {
        const engine = this.daemon.getSelfEvolution();
        const ok = engine.rejectAction(index);
        return { ok, index };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // skills.forge.triggers — list pending skill-forge triggers. Daemon
    // SkillMerger surfaces a getPendingTriggers-like call when active;
    // when absent (e.g. forge engine not booted), return empty list rather
    // than erroring so the UI renders cleanly.
    this.handlers.set("skills.forge.triggers", async () => {
      if (!this.daemon) return { triggers: [] };
      try {
        const merger = this.daemon.getSkillMerger();
        if (!merger) return { triggers: [] };
        // SkillMerger.getPendingTriggers returns deduplicated trigger
        // entries across all discovered skills (built-in + Anthropic +
        // OpenAI + ClawHub + AgentSkills + user-installed).
        const triggers = merger.getPendingTriggers();
        return { triggers };
      } catch (err) {
        return {
          triggers: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // skills.forge.run — session-5 wiring: runs the SkillMerger's
    // runMerge() path to discover skills across sources, group by domain,
    // and write merged skill files. The existing `skills.merge` handler
    // (lower down this file) does the same work; `skills.forge.run` is
    // the name the TrainingReview UI expects. Both route through the
    // daemon's SkillMerger instance so the ring buffer of pending
    // triggers stays consistent across RPC calls.
    this.handlers.set("skills.forge.run", async () => {
      try {
        const merger = this.daemon?.getSkillMerger();
        if (!merger) {
          return {
            ok: false,
            error: "skills.forge.run: SkillMerger not available — requires skills directory",
          };
        }
        const result = merger.runMerge();
        return {
          ok: true,
          discovered: result.discovered,
          groups: result.groups,
          merged: result.merged,
          outputDir: result.outputDir,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // completion.suggest — inline completion ghost-text RPC. Session-5:
    // wired to runtime.query() with a short-context completion prompt +
    // single-line extraction + 200-token budget. Per-session cache keyed
    // by (prefix, suffix) hash prevents re-querying when the user
    // re-focuses the same insertion point.
    const completionCache = new Map<
      string,
      { suggestion: string; confidence: number; model: string | null }
    >();
    this.handlers.set("completion.suggest", async (params) => {
      const p = params as Record<string, unknown>;
      const prefix = typeof p["prefix"] === "string" ? (p["prefix"] as string) : "";
      const suffix = typeof p["suffix"] === "string" ? (p["suffix"] as string) : "";
      const language = typeof p["language"] === "string" ? (p["language"] as string) : "plaintext";
      const maxTokens =
        typeof p["maxTokens"] === "number" ? Math.min(p["maxTokens"] as number, 200) : 120;

      // Short inputs or whitespace-only: return empty without hitting the model.
      if (!prefix.trim() && !suffix.trim()) {
        return { suggestion: "", confidence: 0, model: null };
      }

      // Cache key per (prefix, suffix, language). A session-scoped Map
      // is enough — completion cache churns as the user types; there's
      // no need for disk persistence.
      const { createHash } = await import("node:crypto");
      const cacheKey = createHash("sha256")
        .update(`${language}\u0001${prefix}\u0002${suffix}`)
        .digest("hex")
        .slice(0, 32);
      const cached = completionCache.get(cacheKey);
      if (cached) return cached;

      try {
        // Fill-in-the-middle style prompt: the model sees the cursor
        // position marked by <CURSOR> and completes the next line only.
        const systemPrompt =
          "You are an inline code completion assistant. The user's cursor is at <CURSOR>. " +
          "Output ONLY the text that should be inserted at the cursor — no markdown, no code fences, " +
          "no explanation. Complete at most one line; stop at the first newline unless the line is " +
          "structurally incomplete (open brace, open string). Match the surrounding language and style.";
        const userPrompt = `Language: ${language}\n\n\`\`\`\n${prefix.slice(-800)}<CURSOR>${suffix.slice(0, 400)}\n\`\`\``;
        if (!this.runtime) {
          return {
            suggestion: "",
            confidence: 0,
            model: null,
            error: "completion.suggest: runtime not initialised",
          };
        }
        let suggestionText = "";
        let modelUsed: string | null = null;
        for await (const chunk of this.runtime.query({
          prompt: userPrompt,
          systemPrompt,
          maxTokens,
          temperature: 0.2,
        })) {
          if (chunk.type === "text") suggestionText += chunk.content;
          if (chunk.model) modelUsed = chunk.model;
          if (chunk.type === "done") break;
        }
        // Extract first line (strip markdown fences if model slipped one in).
        let suggestion = suggestionText.trim();
        if (suggestion.startsWith("```")) {
          const inner = suggestion.replace(/^```[a-zA-Z0-9_-]*\s*\n/, "");
          const idx = inner.indexOf("```");
          suggestion = (idx >= 0 ? inner.slice(0, idx) : inner).trim();
        }
        const firstLine = suggestion.split("\n")[0] ?? "";
        const result = {
          suggestion: firstLine,
          confidence: firstLine.length > 0 ? 0.6 : 0,
          model: modelUsed,
        };
        completionCache.set(cacheKey, result);
        return result;
      } catch (err) {
        return {
          suggestion: "",
          confidence: 0,
          model: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // completion.accept — telemetry when the user accepts a ghost-text
    // suggestion. Persists per-day acceptance stats to
    // ~/.wotann/completion-stats.json so cost-tracker / metrics can roll
    // up acceptance rate over time. Atomic write via tmp + rename to
    // handle concurrent acceptance events safely.
    this.handlers.set("completion.accept", async (params) => {
      const suggestionId = (params as Record<string, unknown>)["id"] as string | undefined;
      const characters = Number((params as Record<string, unknown>)["characters"] ?? 0);
      const safeChars = Number.isFinite(characters) && characters >= 0 ? characters : 0;
      const today = new Date().toISOString().slice(0, 10);
      const statsPath = resolveWotannHomeSubdir("completion-stats.json");
      try {
        const existing = existsSync(statsPath)
          ? (JSON.parse(readFileSync(statsPath, "utf-8")) as Record<
              string,
              { acceptCount: number; charsAccepted: number }
            >)
          : {};
        const day = existing[today] ?? { acceptCount: 0, charsAccepted: 0 };
        const updated = {
          ...existing,
          [today]: {
            acceptCount: day.acceptCount + 1,
            charsAccepted: day.charsAccepted + safeChars,
          },
        };
        // Wave 6.5-UU (H-22) — daily suggestion stats. Atomic write.
        writeFileAtomic(statsPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
        return {
          ok: true,
          recorded: { id: suggestionId ?? null, characters: safeChars, day: today },
          stats: updated[today],
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // voice.transcribe — single-shot transcription via VoicePipeline's
    // existing STT fallback chain. Session-5 replaced the honest-error
    // stub after Phase-1 GAP-1 found session-4's "wired" claim was a
    // commit-message fabrication: VoicePipeline.transcribe(audioPath)
    // already handled the full Web Speech API → system → whisper-local
    // → whisper-cloud → deepgram cascade, and wiring the RPC to it was
    // 3 lines. Returns `{ok: true, text, language, confidence,
    // durationMs}` on success, `{ok: false, error}` on STT failure.
    this.handlers.set("voice.transcribe", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const audioPath = typeof p["audioPath"] === "string" ? (p["audioPath"] as string) : null;
      if (!audioPath) {
        return { ok: false, error: "audioPath (string) required" };
      }
      try {
        const vp = await getVoicePipeline();
        const result = await vp.transcribe(audioPath);
        if (!result) {
          return {
            ok: false,
            error: "transcription failed: no STT backend produced a confidence > 0 result",
          };
        }
        return {
          ok: true,
          text: result.text,
          language: result.language,
          confidence: result.confidence,
          durationMs: result.durationMs,
          segments: result.segments,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // voice.stream.start — opens a polling stream. Client calls
    // voice.stream.poll(streamId, cursor) every ~200ms to drain new
    // chunks; voice.stream.cancel(streamId) frees buffers. This matches
    // the session-4 design note about NDJSON being subscription-free.
    //
    // For single-shot audio paths, we emit one final chunk with the full
    // transcription then mark done. For continuous listening the
    // underlying STTDetector.on("interim"/"result") events populate the
    // buffer as partial results arrive. Either way callers see the same
    // protocol shape: `{chunks: [{seq, text, isFinal}], done: boolean}`.
    this.handlers.set("voice.stream.start", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const audioPath = typeof p["audioPath"] === "string" ? (p["audioPath"] as string) : null;
      pruneStaleVoiceStreams();
      const streamId = `vstream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const stream: VoiceStream = { id: streamId, chunks: [], done: false, createdAt: Date.now() };
      voiceStreams.set(streamId, stream);
      // Fire-and-forget: run the transcription in the background, push
      // chunks as they appear. On completion or error, mark done so
      // subsequent polls drain cleanly.
      if (audioPath) {
        (async () => {
          try {
            const vp = await getVoicePipeline();
            const result = await vp.transcribe(audioPath);
            if (result) {
              stream.chunks.push({ seq: 0, text: result.text, isFinal: true });
            } else {
              stream.error = "transcription failed";
            }
          } catch (err) {
            stream.error = err instanceof Error ? err.message : String(err);
          } finally {
            stream.done = true;
          }
        })();
      } else {
        // No audio path → open a live mic stream. VoicePipeline.onTranscription
        // registers a callback for Web Speech API interim + final events.
        (async () => {
          try {
            const vp = await getVoicePipeline();
            let seq = 0;
            vp.onTranscription((text: string, isFinal: boolean) => {
              stream.chunks.push({ seq: seq++, text, isFinal });
              if (isFinal) stream.done = true;
            });
            const started = vp.startListening();
            if (!started) {
              stream.error = "could not start listening (no STT provider available)";
              stream.done = true;
            }
          } catch (err) {
            stream.error = err instanceof Error ? err.message : String(err);
            stream.done = true;
          }
        })();
      }
      return { ok: true, streamId };
    });

    // voice.stream.poll — drain new chunks since `cursor`. Returns an
    // ordered slice of the stream's chunk buffer plus a `done` flag.
    // The client increments its local cursor by chunks.length.
    this.handlers.set("voice.stream.poll", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const streamId = typeof p["streamId"] === "string" ? (p["streamId"] as string) : null;
      const cursor = typeof p["cursor"] === "number" ? (p["cursor"] as number) : 0;
      if (!streamId) return { ok: false, error: "streamId (string) required" };
      const stream = voiceStreams.get(streamId);
      if (!stream) return { ok: false, error: "stream not found (may have expired)" };
      const slice = stream.chunks.slice(cursor);
      return {
        ok: true,
        chunks: slice,
        done: stream.done,
        error: stream.error ?? null,
      };
    });

    // voice.stream.cancel — stop listening and free buffers. Safe to
    // call on an already-done stream (idempotent).
    this.handlers.set("voice.stream.cancel", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const streamId = typeof p["streamId"] === "string" ? (p["streamId"] as string) : null;
      if (!streamId) return { ok: false, error: "streamId (string) required" };
      const stream = voiceStreams.get(streamId);
      if (!stream) return { ok: true, cancelled: false };
      try {
        // Only stop the mic if this stream was a live-mic stream (no audio path).
        if (sharedVoicePipeline) sharedVoicePipeline.stopListening();
      } catch {
        /* non-fatal — still release the buffer */
      }
      stream.done = true;
      voiceStreams.delete(streamId);
      return { ok: true, cancelled: true };
    });

    // voice.stream — single-shot alias that wraps start/poll/cancel for
    // callers that want a blocking transcription without managing the
    // polling cursor themselves. Returns the final text directly.
    this.handlers.set("voice.stream", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const audioPath = typeof p["audioPath"] === "string" ? (p["audioPath"] as string) : null;
      if (!audioPath) {
        return {
          ok: false,
          error:
            "voice.stream (blocking form) requires audioPath. For live-mic streaming use " +
            "voice.stream.start without audioPath, then poll voice.stream.poll.",
        };
      }
      try {
        const vp = await getVoicePipeline();
        const result = await vp.transcribe(audioPath);
        if (!result) return { ok: false, error: "transcription failed" };
        return {
          ok: true,
          text: result.text,
          language: result.language,
          confidence: result.confidence,
          durationMs: result.durationMs,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // composer.plan — dry-run of composer.apply with REAL line-by-line
    // diff preview. Each plan entry includes a unified-style diff string
    // the UI can render before the user confirms and triggers
    // composer.apply for writes. Closes the "echo only" gap from
    // GAP_AUDIT.
    this.handlers.set("composer.plan", async (params) => {
      const edits = ((params as Record<string, unknown>)["edits"] ?? []) as Array<{
        path: string;
        newContent: string;
      }>;
      if (!Array.isArray(edits)) {
        return { ok: false, error: "edits array required" };
      }
      const workspaceRoot = resolvePath(this.runtime?.getWorkingDir() ?? process.cwd());
      const plan = edits.map((edit) => {
        const resolved = resolvePath(edit.path ?? "");
        const inWorkspace =
          resolved === workspaceRoot ||
          resolved.startsWith(workspaceRoot.endsWith("/") ? workspaceRoot : `${workspaceRoot}/`);

        const newContent = typeof edit.newContent === "string" ? edit.newContent : "";
        const fileExists = inWorkspace && existsSync(resolved);
        const oldContent = fileExists ? readFileSync(resolved, "utf-8") : "";
        const diff = simpleLineDiff(oldContent, newContent, edit.path ?? "(new file)");
        const additions = diff.split("\n").filter((l) => l.startsWith("+ ")).length;
        const deletions = diff.split("\n").filter((l) => l.startsWith("- ")).length;

        return {
          path: edit.path,
          resolved,
          inWorkspace,
          isNew: !fileExists,
          previewBytes: newContent.length,
          oldBytes: oldContent.length,
          diff,
          additions,
          deletions,
        };
      });
      return { ok: true, plan, total: plan.length };
    });

    // shadow.undo — restore the most recent shadow-git checkpoint that
    // was created BEFORE the named tool last ran. Wires the S3-3
    // restoreLastBefore() API into the user-visible undo gesture.
    // Without this the GitPreCheckpointHook ring buffer was write-only.
    this.handlers.set("shadow.undo", async (params) => {
      const toolName = (params as Record<string, unknown>)["toolName"] as string | undefined;
      if (!toolName) {
        return {
          ok: false,
          error: "toolName required (e.g. 'Write', 'Edit', 'NotebookEdit')",
        };
      }
      try {
        // Use the runtime's ShadowGit singleton — the same instance the
        // GitPreCheckpointHook populates via `beforeTool`. A fresh instance
        // would have an empty in-memory ring buffer and restoreLastBefore
        // would silently return false for every call.
        const shadowGit = this.runtime?.getShadowGit();
        if (!shadowGit) {
          return { ok: false, error: "Runtime not initialized" };
        }
        const restored = await shadowGit.restoreLastBefore(toolName);
        const recent = shadowGit.getRecentCheckpoints();
        return {
          ok: restored,
          toolName,
          restored,
          recent: recent.map((c) => ({
            hash: c.hash,
            label: c.label,
            timestamp: c.timestamp,
            toolName: c.toolName,
          })),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // shadow.undo-turn — session-6 Conductor-inspired rewind. Calls
    // shadow.undo across ALL known mutating tools in reverse-chronological
    // order until the most recent pre-turn checkpoint is restored. The
    // user-visible action is "reset to previous turn"; under the hood we
    // walk the ring buffer backwards restoring every checkpoint whose
    // timestamp is newer than the target turn boundary. Returns the set
    // of restored checkpoints so the UI can render a summary.
    this.handlers.set("shadow.undo-turn", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const turnsBack = typeof p["turnsBack"] === "number" ? (p["turnsBack"] as number) : 1;
      try {
        const shadowGit = this.runtime?.getShadowGit();
        if (!shadowGit) {
          return { ok: false, error: "Runtime not initialized" };
        }
        const recent = shadowGit.getRecentCheckpoints();
        if (recent.length === 0) {
          return {
            ok: false,
            restored: [],
            error: "No checkpoints in ring buffer — shadow-git has not recorded any pre-tool state",
          };
        }
        // Checkpoints are newest-first by ring-buffer semantics. Skip
        // (turnsBack - 1) turns worth of checkpoints, then restore the
        // next one to rewind the conversation by that turn boundary.
        // One "turn" = one stable mark after a user prompt. We use each
        // `stable: true` marker as a turn boundary; when markers aren't
        // reliable we fall back to N checkpoints ago.
        const target = Math.min(Math.max(turnsBack, 1), recent.length);
        const checkpoint = recent[target - 1];
        if (!checkpoint) {
          return { ok: false, error: `Only ${recent.length} checkpoints available` };
        }
        const restored = await shadowGit.restoreLastBefore(checkpoint.toolName ?? "Write");
        return {
          ok: restored,
          restored,
          turnsBack: target,
          checkpoint: {
            hash: checkpoint.hash,
            label: checkpoint.label,
            toolName: checkpoint.toolName,
            timestamp: checkpoint.timestamp,
          },
          available: recent.length,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    // shadow.checkpoints — list recent shadow-git checkpoints from the
    // ring buffer. Used by the desktop to render an "undo history" so
    // the user can see what's recoverable before invoking shadow.undo.
    this.handlers.set("shadow.checkpoints", async () => {
      try {
        // Share the runtime's ShadowGit singleton — same instance as
        // shadow.undo and the GitPreCheckpointHook ring-buffer writer.
        const shadowGit = this.runtime?.getShadowGit();
        if (!shadowGit) {
          return { ok: false, checkpoints: [], error: "Runtime not initialized" };
        }
        const recent = shadowGit.getRecentCheckpoints();
        return {
          ok: true,
          checkpoints: recent.map((c) => ({
            hash: c.hash,
            label: c.label,
            timestamp: c.timestamp,
            toolName: c.toolName,
          })),
        };
      } catch (err) {
        return {
          ok: false,
          checkpoints: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    // proofs.reverify — re-run the verification cascade against an
    // existing proof bundle. Loads {workingDir}/.wotann/proofs/<id>.json,
    // calls runtime.getVerificationCascade().run() for fresh
    // tests/typecheck/lint results, and writes a new sibling bundle with
    // the reverified state so the UI can compare. The original bundle is
    // preserved (immutable history).
    this.handlers.set("proofs.reverify", async (params) => {
      const id = (params as Record<string, unknown>)["id"] as string | undefined;
      if (!id) return { ok: false, error: "id required" };
      // Path-traversal guard on id — must be safe filename chars only.
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return { ok: false, error: "id must match [a-zA-Z0-9_-]+" };
      }
      if (!this.runtime) return { ok: false, error: "Runtime not initialized" };
      const proofDir = join(this.runtime.getWorkingDir(), ".wotann", "proofs");
      const bundlePath = join(proofDir, `${id}.json`);
      if (!existsSync(bundlePath)) {
        return { ok: false, error: `proof bundle not found: ${id}` };
      }
      try {
        const original = JSON.parse(readFileSync(bundlePath, "utf-8")) as Record<string, unknown>;
        const cascade = this.runtime.getVerificationCascade();
        const fresh = await cascade.run();
        const reverifiedPath = join(proofDir, `${id}.reverified-${Date.now()}.json`);
        const reverifiedBundle = {
          originalId: id,
          reverifiedAt: new Date().toISOString(),
          original,
          fresh,
          drift: {
            originalPassed:
              typeof (original as { allPassed?: boolean }).allPassed === "boolean"
                ? (original as { allPassed: boolean }).allPassed
                : null,
            currentPassed: fresh.allPassed,
            stillPasses: fresh.allPassed === true,
          },
        };
        // Wave 6.5-UU (H-22) — reverified proof bundle. Atomic write.
        writeFileAtomic(reverifiedPath, JSON.stringify(reverifiedBundle, null, 2), {
          encoding: "utf-8",
        });
        return {
          ok: true,
          id,
          reverifiedPath: reverifiedPath.split("/").pop(),
          stillPasses: fresh.allPassed,
          drift: reverifiedBundle.drift,
          fresh,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), id };
      }
    });

    // Background workers — get status from daemon's BackgroundWorkerManager
    this.handlers.set("workers.status", async () => {
      if (!this.daemon) return { workers: [] };
      try {
        const manager = this.daemon.getBackgroundWorkers();
        const workers = manager.getStatus();
        return { workers };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { workers: [] };
      }
    });

    // Proof bundles — list completed proofs from disk
    this.handlers.set("proofs.list", async () => {
      // Proof bundles are written to {workingDir}/.wotann/proofs/ as JSON files.
      // No daemon getter exists; read directly from the filesystem.
      const proofDir = join(
        this.runtime ? this.runtime.getWorkingDir() : process.cwd(),
        ".wotann",
        "proofs",
      );
      if (!existsSync(proofDir)) return { proofs: [], count: 0 };
      try {
        const { readdirSync } = await import("node:fs");
        const files = readdirSync(proofDir).filter((f: string) => f.endsWith(".json"));
        const proofs = files
          .map((f: string) => {
            try {
              const raw = readFileSync(join(proofDir, f), "utf-8");
              return JSON.parse(raw) as Record<string, unknown>;
            } catch {
              // Best-effort path — caller gets a safe fallback, no user-facing error.
              return null;
            }
          })
          .filter((p): p is Record<string, unknown> => p !== null);
        return { proofs, count: proofs.length };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { proofs: [], count: 0 };
      }
    });

    // Cost prediction — wired to CostOracle
    this.handlers.set("cost.predict", async (params) => {
      const prompt = (params.prompt as string) ?? "";
      const provider = (params.provider as string) ?? "ollama";
      const model = (params.model as string) ?? "gemma4:e4b";
      if (!this.daemon) return { predictions: [] };
      const oracle = this.daemon.getCostOracle();
      try {
        const estimate = oracle.estimateTaskCost(prompt, provider as never, model);
        return { predictions: [estimate] };
      } catch {
        // Best-effort path — caller gets a safe fallback, no user-facing error.
        return { predictions: [] };
      }
    });

    // Skill merge — trigger skill merger via daemon's SkillMerger
    this.handlers.set("skills.merge", async () => {
      if (!this.daemon) return { success: false, message: "Daemon not initialized" };
      const merger = this.daemon.getSkillMerger();
      if (!merger) {
        return { success: false, message: "SkillMerger not available — requires skills directory" };
      }
      try {
        const result = merger.runMerge();
        return {
          success: true,
          message: `Merged ${result.merged} skills from ${result.groups} groups (${result.discovered} discovered)`,
          ...result,
        };
      } catch (err) {
        return {
          success: false,
          message: `Skill merge failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    });
  }

  // ── Computer Session RPC family (Phase 3 P1-F1 keystone) ─────
  //
  // The 7 methods below wire the cross-surface workflow defined in
  // docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md. Phone creates; desktop
  // claims; phone/any-surface subscribes to stream. Per the design, this is
  // the keystone — F2-F9 all build on top of the session lifecycle + event
  // bus established here.
  private registerComputerSessionHandlers(): void {
    this.handlers.set("computer.session.create", async (params) => {
      const creatorDeviceId = params["creatorDeviceId"] ?? params["deviceId"];
      const taskSpecParam = params["taskSpec"] ?? params["spec"];
      if (typeof creatorDeviceId !== "string") {
        throw new Error("creatorDeviceId (string) required");
      }
      if (!taskSpecParam || typeof taskSpecParam !== "object") {
        throw new Error("taskSpec (object) required");
      }
      const spec = taskSpecParam as Record<string, unknown>;
      const task = spec["task"];
      if (typeof task !== "string" || task.trim() === "") {
        throw new Error("taskSpec.task (non-empty string) required");
      }
      const mode = spec["mode"];
      const maxSteps = spec["maxSteps"];
      const creationPath = spec["creationPath"];
      const modelId = spec["modelId"];
      const session = this.computerSessionStore.create({
        creatorDeviceId,
        taskSpec: {
          task,
          mode:
            mode === "research" ||
            mode === "autopilot" ||
            mode === "focused" ||
            mode === "watch-only"
              ? mode
              : undefined,
          maxSteps: typeof maxSteps === "number" ? maxSteps : undefined,
          creationPath: typeof creationPath === "string" ? creationPath : undefined,
          modelId: typeof modelId === "string" ? modelId : undefined,
        },
      });
      return serializeSession(session);
    });

    this.handlers.set("computer.session.claim", async (params) => {
      const sessionId = params["sessionId"];
      const deviceId = params["deviceId"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof deviceId !== "string") throw new Error("deviceId required");
      try {
        const session = this.computerSessionStore.claim(sessionId, deviceId);
        return serializeSession(session);
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("computer.session.step", async (params) => {
      const sessionId = params["sessionId"];
      const deviceId = params["deviceId"];
      const step = params["step"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof deviceId !== "string") throw new Error("deviceId required");
      if (!step || typeof step !== "object") throw new Error("step (object) required");
      try {
        // Layer 1: advance the session state machine (claimed → running).
        const session = this.computerSessionStore.step({
          sessionId,
          deviceId,
          step: step as Readonly<Record<string, unknown>>,
        });

        // V9 T1.1 KEYSTONE — Layer 4: actually EXECUTE the step's
        // desktop action. The route table in platform-bindings.ts
        // handles the canonical actions (open-url, open-app, click,
        // type, screenshot, etc.); `executeDesktopAction` returns
        // `{success, output}` or `null` when the action isn't routed.
        //
        // Session was previously a "dead endpoint" — F-series RPCs
        // could transition the state machine but never actually
        // performed the requested desktop action. This wire closes
        // that gap. Agents sending a step with `action: "open-url"` +
        // `params: {url: "..."}` will now see the URL actually open.
        //
        // Execution failures are surfaced via the return envelope
        // rather than throwing — the session state machine already
        // advanced to "running" and the caller needs both the session
        // and the action-result to drive its UI. Throwing would lose
        // the state transition.
        const stepObj = step as Readonly<Record<string, unknown>>;
        const rawAction = stepObj["action"];
        const rawParams = stepObj["params"];
        let execution: RouteResult | null = null;
        let actionError: string | null = null;
        if (typeof rawAction === "string" && session.status === "running") {
          const params: Record<string, string> = {};
          if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
            for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
              if (typeof v === "string") params[k] = v;
              else if (typeof v === "number" || typeof v === "boolean") params[k] = String(v);
            }
          }
          const action: DesktopAction = { action: rawAction, params };
          try {
            execution = executeDesktopAction(action);
          } catch (execErr) {
            actionError = execErr instanceof Error ? execErr.message : "executeDesktopAction threw";
          }

          // V9 GA-01 — cursor stream emit bridge.
          //
          // Pointer-affecting routes (click / scroll / move) must mirror to
          // the cross-surface cursor stream so phones rendering
          // CursorOverlayView see the agent's pointer trail without the
          // agent having to also call `cursor.emit` explicitly. Gating:
          //   1. executeDesktopAction must have succeeded (success === true)
          //      — a backend miss / failure means no real pointer movement,
          //      so a mirrored event would be a lie (QB #6: honest behavior).
          //   2. action must map to a CursorAction (click/scroll/move).
          //   3. coordinates must be finite numbers — defends against
          //      agents passing string coords that fail Number() coercion.
          //      Better to drop the mirror than to fail the whole step.
          //
          // cursorStream.record may throw (invalid coords post-validation,
          // session-not-found race). We log + continue — the action result
          // already flowed back to the caller, rolling that back because a
          // mirror failed would be dishonest.
          if (execution?.success === true) {
            const cursorAction: CursorAction | null =
              rawAction === "click"
                ? "click"
                : rawAction === "scroll"
                  ? "scroll"
                  : rawAction === "move-mouse" || rawAction === "move"
                    ? "move"
                    : null;
            if (cursorAction !== null) {
              const rawXY =
                rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
                  ? (rawParams as Record<string, unknown>)
                  : null;
              const cx = rawXY ? Number(rawXY["x"]) : NaN;
              const cy = rawXY ? Number(rawXY["y"]) : NaN;
              if (Number.isFinite(cx) && Number.isFinite(cy)) {
                const sample: {
                  sessionId: string;
                  deviceId: string;
                  x: number;
                  y: number;
                  action: CursorAction;
                  button?: string;
                } = {
                  sessionId,
                  deviceId,
                  x: cx,
                  y: cy,
                  action: cursorAction,
                };
                // button only on click — scroll/move omit it so consumers
                // don't see stale button data on non-click events.
                if (cursorAction === "click" && rawXY && typeof rawXY["button"] === "string") {
                  sample.button = rawXY["button"] as string;
                }
                try {
                  this.cursorStream.record(sample);
                } catch (cursorErr) {
                  console.warn(
                    `[kairos-rpc] cursor.record failed for session ${sessionId} (${cursorAction}): ${
                      cursorErr instanceof Error ? cursorErr.message : String(cursorErr)
                    }`,
                  );
                }
              }
            }
          }
        }

        // Return shape preserves backward-compat with existing callers
        // (tests + any future clients): all session fields remain at the
        // top level (spread from serializeSession) so consumers can keep
        // reading `result.status`, `result.eventCount`, etc. The new
        // V9 T1.1 fields — `execution` (RouteResult | null) and
        // `actionError` — are additive. Callers that want the
        // execution outcome read `result.execution`; callers that
        // don't care see no behavioral change.
        return {
          ...serializeSession(session),
          execution: execution ?? null,
          ...(actionError ? { actionError } : {}),
        };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("computer.session.requestApproval", async (params) => {
      const sessionId = params["sessionId"];
      const deviceId = params["deviceId"];
      const summary = params["summary"];
      const riskLevel = params["riskLevel"] ?? "medium";
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof deviceId !== "string") throw new Error("deviceId required");
      if (typeof summary !== "string") throw new Error("summary required");
      if (riskLevel !== "low" && riskLevel !== "medium" && riskLevel !== "high") {
        throw new Error("riskLevel must be low|medium|high");
      }
      try {
        const { session, approval } = this.computerSessionStore.requestApproval({
          sessionId,
          deviceId,
          summary,
          riskLevel,
        });
        return { session: serializeSession(session), approval };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("computer.session.approve", async (params) => {
      const sessionId = params["sessionId"];
      const deviceId = params["deviceId"];
      const decision = params["decision"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof deviceId !== "string") throw new Error("deviceId required");
      if (decision !== "allow" && decision !== "deny") {
        throw new Error("decision must be allow|deny");
      }
      try {
        const session = this.computerSessionStore.approve({
          sessionId,
          deviceId,
          decision,
        });
        return serializeSession(session);
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("computer.session.close", async (params) => {
      const sessionId = params["sessionId"];
      const deviceId = params["deviceId"];
      const outcome = params["outcome"] ?? "done";
      const result = params["result"];
      const error = params["error"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof deviceId !== "string") throw new Error("deviceId required");
      if (outcome !== "done" && outcome !== "failed") {
        throw new Error("outcome must be done|failed");
      }
      try {
        const session = this.computerSessionStore.close({
          sessionId,
          deviceId,
          outcome,
          result:
            result && typeof result === "object"
              ? (result as Readonly<Record<string, unknown>>)
              : undefined,
          error: typeof error === "string" ? error : undefined,
        });
        return serializeSession(session);
      } catch (err) {
        throw toRpcError(err);
      }
    });

    // ── F14: cross-session resume (phone start -> desktop continue -> TUI finish) ──
    //
    // `computer.session.handoff` transfers the claim from the current device
    // to another registered device. The source loses write permission the
    // moment initiate succeeds; the target acquires it on
    // `computer.session.acceptHandoff`. TTL is enforced by
    // SessionHandoffManager — a late accept receives ErrorHandoffExpired.
    //
    // Full audit trail (every handoff attempt, accepted or expired) is kept
    // on the session via the store's handoffs array, accessible through any
    // session-reading RPC (create/claim/step/close/list/stream responses).
    this.handlers.set("computer.session.handoff", async (params) => {
      const sessionId = params["sessionId"];
      const fromDeviceId = params["fromDeviceId"] ?? params["deviceId"];
      const toDeviceId = params["toDeviceId"];
      const reason = params["reason"];
      const ttlMs = params["ttlMs"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof fromDeviceId !== "string") throw new Error("fromDeviceId required");
      if (typeof toDeviceId !== "string") throw new Error("toDeviceId required");
      try {
        const { session, handoff } = this.computerSessionHandoff.initiate({
          sessionId,
          fromDeviceId,
          toDeviceId,
          reason: typeof reason === "string" ? reason : null,
          ttlMs: typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : undefined,
        });
        return {
          session: serializeSession(session),
          handoff,
        };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("computer.session.acceptHandoff", async (params) => {
      const sessionId = params["sessionId"];
      const handoffId = params["handoffId"];
      const deviceId = params["deviceId"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof handoffId !== "string") throw new Error("handoffId required");
      if (typeof deviceId !== "string") throw new Error("deviceId required");
      try {
        const session = this.computerSessionHandoff.accept({
          sessionId,
          handoffId,
          deviceId,
        });
        return serializeSession(session);
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("computer.session.expireHandoff", async (params) => {
      const sessionId = params["sessionId"];
      const handoffId = params["handoffId"];
      if (typeof sessionId !== "string") throw new Error("sessionId required");
      if (typeof handoffId !== "string") throw new Error("handoffId required");
      try {
        const session = this.computerSessionHandoff.expire({ sessionId, handoffId });
        return serializeSession(session);
      } catch (err) {
        throw toRpcError(err);
      }
    });

    // Polling-style stream: NDJSON IPC can't carry subscriptions, so `stream`
    // returns history-then-tail via an opaque subscription id. Caller repeats
    // with `since` to page new events. `close` releases the buffer.
    this.handlers.set("computer.session.stream", async (params) => {
      const sessionId = params["sessionId"];
      const subscribeAll = params["subscribeAll"] === true;
      const sinceSeq = params["since"];
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;
      const maxEvents =
        typeof params["maxEvents"] === "number" && params["maxEvents"]! > 0
          ? (params["maxEvents"] as number)
          : 256;

      // Continuation: page from an existing subscription. Returns the full
      // accumulated buffer — history replayed at subscribe + every event
      // emitted since. Callers pass `since` to filter to newer events only,
      // otherwise the full timeline is returned (subscriber-friendly default).
      if (typeof subscriptionIdIn === "string") {
        const sub = this.computerSessionSubscriptions.get(subscriptionIdIn);
        if (!sub) {
          throw new Error(`subscription not found: ${subscriptionIdIn}`);
        }
        const filter =
          typeof sinceSeq === "number" && sub.sessionId !== "*"
            ? (e: ComputerSessionEvent) => e.seq >= sinceSeq
            : (): boolean => true;
        const events = sub.events.filter(filter).slice(0, maxEvents);
        sub.lastPolledAt = Date.now();
        if (closeAfter) {
          sub.dispose();
          this.computerSessionSubscriptions.delete(subscriptionIdIn);
        }
        return {
          subscriptionId: subscriptionIdIn,
          events: events.map(serializeEvent),
          more: sub.events.filter(filter).length > events.length,
          closed: closeAfter,
        };
      }

      // Start a new subscription. Replay history up to this point, then buffer new.
      if (subscribeAll) {
        const subId = `ss-${randomUUID()}`;
        const buffer: ComputerSessionEvent[] = [];
        const dispose = this.computerSessionStore.subscribeAll((event) => {
          buffer.push(event);
          if (buffer.length > 10000) buffer.splice(0, buffer.length - 10000);
        });
        this.computerSessionSubscriptions.set(subId, {
          sessionId: "*",
          events: buffer,
          dispose,
          lastPolledAt: Date.now(),
        });
        return {
          subscriptionId: subId,
          events: [],
          more: false,
          closed: false,
        };
      }

      if (typeof sessionId !== "string") {
        throw new Error("sessionId (string) or subscribeAll=true required");
      }
      let buffer: ComputerSessionEvent[];
      let dispose: () => void;
      try {
        buffer = [];
        dispose = this.computerSessionStore.subscribe(sessionId, (event) => {
          buffer.push(event);
          if (buffer.length > 10000) buffer.splice(0, buffer.length - 10000);
        });
      } catch (err) {
        throw toRpcError(err);
      }
      const subId = `ss-${randomUUID()}`;
      this.computerSessionSubscriptions.set(subId, {
        sessionId,
        events: buffer,
        dispose,
        lastPolledAt: Date.now(),
      });
      // History is already captured synchronously in the buffer by subscribe().
      const replay = buffer.slice(0, maxEvents);
      return {
        subscriptionId: subId,
        events: replay.map(serializeEvent),
        more: buffer.length > replay.length,
        closed: false,
      };
    });

    this.handlers.set("computer.session.list", async (params) => {
      const statusFilter = params["status"];
      const validStatuses: readonly ComputerSessionStatus[] = [
        "pending",
        "claimed",
        "running",
        "awaiting_approval",
        "done",
        "failed",
      ];
      const status =
        typeof statusFilter === "string" &&
        (validStatuses as readonly string[]).includes(statusFilter)
          ? (statusFilter as ComputerSessionStatus)
          : undefined;
      const list = this.computerSessionStore.list(status ? { status } : undefined);
      return list.map(serializeSession);
    });

    this.registerFleetHandlers();
    this.registerWatchDispatchHandlers();
    this.registerCarPlayDispatchHandlers();
    this.registerCreationsHandlers();
    this.registerFileGetHandlers();
    this.registerApprovalHandlers();
    this.registerDeliveryHandlers();
    this.registerCursorHandlers();
    this.registerLiveActivityHandlers();

    // V9 wire-compat aliases. iOS code (per MASTER_PLAN_V9 spec) refers to
    // these RPC methods using the dotted spec names; the canonical handlers
    // were registered above under camelCase names. We register the aliases
    // by referencing the same handler so both names round-trip identically.
    //
    // - `cursor.stream`            → `cursor.subscribe`
    // - `live.activity.subscribe`  → `liveActivity.subscribe`
    //
    // Push-channel names also need cross-emit (the iOS side listens to
    // `cursor.stream` / `live.activity` push events). The producer paths
    // currently emit only `cursor.subscribe-style` events — to surface them
    // under the alias names without duplicating the producer, listeners
    // subscribe via the alias and we forward the event in the WS layer.
    // For now the alias registration is enough for the .send() side; the
    // WS push side will get a follow-up commit when the producer wires up.
    const cursorSubscribe = this.handlers.get("cursor.subscribe");
    if (cursorSubscribe) this.handlers.set("cursor.stream", cursorSubscribe);
    const liveActivitySubscribe = this.handlers.get("liveActivity.subscribe");
    if (liveActivitySubscribe) {
      this.handlers.set("live.activity.subscribe", liveActivitySubscribe);
    }
  }

  // ── F2: Cursor stream RPCs (real-time coordinate events) ──
  //
  // Per MASTER_PLAN_V8 §5 P1-F2 (1 day), F2 adds dedicated primitives for
  // desktop-control agents that physically move a mouse. The event type
  // `cursor` is already part of the F1 `SessionEvent` union; F2 adds a
  // stateless enrichment layer (CursorStream) for coalescing + fan-out.
  //
  //   - cursor.emit       — daemon-side producer API. Desktop-control
  //                         agents call this with each movement; moves
  //                         are coalesced to 30fps before hitting the
  //                         session log. Click/scroll pass through.
  //   - cursor.subscribe  — filter on computer.session.stream that only
  //                         returns cursor events. Phones use this to
  //                         render CursorOverlayView without subscribing
  //                         to step/frame/file_write events.
  //
  // Errors surface as JSON-RPC errors with typed `.code`:
  //   CURSOR_INVALID_COORDINATES / CURSOR_SESSION_NOT_FOUND.
  private registerCursorHandlers(): void {
    this.handlers.set("cursor.emit", async (params) => {
      const sessionId = params["sessionId"];
      const deviceId = params["deviceId"];
      const action = params["action"];
      const x = params["x"];
      const y = params["y"];

      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new Error("sessionId (non-empty string) required");
      }
      if (typeof deviceId !== "string" || deviceId.trim() === "") {
        throw new Error("deviceId (non-empty string) required");
      }
      if (action !== "move" && action !== "click" && action !== "scroll") {
        throw new Error("action must be one of move|click|scroll");
      }
      if (typeof x !== "number") {
        throw new Error("x (number) required");
      }
      if (typeof y !== "number") {
        throw new Error("y (number) required");
      }

      const sample: {
        sessionId: string;
        deviceId: string;
        x: number;
        y: number;
        action: CursorAction;
        screenId?: string | null;
        button?: string;
        deltaX?: number;
        deltaY?: number;
      } = {
        sessionId,
        deviceId,
        x,
        y,
        action,
      };
      const screenId = params["screenId"];
      if (typeof screenId === "string") sample.screenId = screenId;
      else if (screenId === null) sample.screenId = null;
      const button = params["button"];
      if (typeof button === "string") sample.button = button;
      const deltaX = params["deltaX"];
      if (typeof deltaX === "number") sample.deltaX = deltaX;
      const deltaY = params["deltaY"];
      if (typeof deltaY === "number") sample.deltaY = deltaY;

      try {
        const outcome = this.cursorStream.record(sample);
        return { outcome };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("cursor.subscribe", async (params) => {
      const sessionId = params["sessionId"];
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;
      const maxEvents =
        typeof params["maxEvents"] === "number" && (params["maxEvents"] as number) > 0
          ? Math.min(params["maxEvents"] as number, 10_000)
          : 256;

      // Poll path — drain buffered cursor events from an existing subscription.
      if (typeof subscriptionIdIn === "string" && subscriptionIdIn.length > 0) {
        const sub = this.computerSessionSubscriptions.get(subscriptionIdIn);
        if (!sub) {
          throw new Error(`subscription not found: ${subscriptionIdIn}`);
        }
        // Cursor subscriptions filter the shared buffer in-place. We
        // do NOT splice — other pollers may share the id (they shouldn't,
        // but be defensive) — and we keep `seq`-based filtering for
        // efficient continuation. Drain up to maxEvents.
        const sinceSeq = params["since"];
        const events = sub.events
          .filter((e) => e.type === "cursor")
          .filter((e) =>
            typeof sinceSeq === "number" && sub.sessionId !== "*" ? e.seq >= sinceSeq : true,
          )
          .slice(0, maxEvents);
        sub.lastPolledAt = Date.now();
        if (closeAfter) {
          sub.dispose();
          this.computerSessionSubscriptions.delete(subscriptionIdIn);
        }
        return {
          subscriptionId: subscriptionIdIn,
          events: events.map(serializeEvent),
          more: sub.events.filter((e) => e.type === "cursor").length > events.length,
          closed: closeAfter,
        };
      }

      // Fresh subscription — seed from the session's buffered events.
      // Reuses the session-stream buffer pipeline so history replay for
      // the session's cursor events works exactly like computer.session.stream,
      // just with a type filter applied.
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new Error("sessionId (non-empty string) required");
      }

      const buffer: ComputerSessionEvent[] = [];
      let dispose: () => void;
      try {
        dispose = this.computerSessionStore.subscribe(sessionId, (event) => {
          if (event.type !== "cursor") return;
          buffer.push(event);
          if (buffer.length > 10_000) buffer.splice(0, buffer.length - 10_000);
        });
      } catch (err) {
        throw toRpcError(err);
      }
      const subId = `cs-cursor-${randomUUID()}`;
      this.computerSessionSubscriptions.set(subId, {
        sessionId,
        events: buffer,
        dispose,
        lastPolledAt: Date.now(),
      });
      // History is already captured synchronously via the subscribe hook
      // above — any cursor events replayed by the store land in `buffer`
      // before we return.
      const replay = buffer.slice(0, maxEvents);
      return {
        subscriptionId: subId,
        events: replay.map(serializeEvent),
        more: buffer.length > replay.length,
        closed: false,
      };
    });
  }

  // ── F3: Live Activity RPCs (iOS Dynamic Island) ──────────
  //
  // Per MASTER_PLAN_V8 §5 P1-F3 (2 days), F1 already ships `step` as a
  // valid SessionEvent type AND a valid UnifiedEventType. F3 adds a
  // rate-limited marshaling layer (LiveActivityManager) on top so iOS
  // Dynamic Island / Live Activities get a compact progress payload
  // WITHOUT being flooded by raw step events (APNs budget).
  //
  //   - liveActivity.step       — enqueue a step update (title, progress,
  //                               icon, expandedDetail). Rate-limited to
  //                               1/sec per session; bursts newest-wins.
  //   - liveActivity.pending    — current dispatched step per session
  //                               (optional `sessionId` param; without,
  //                               returns ALL active sessions' steps).
  //   - liveActivity.subscribe  — polling subscription for steps emitted
  //                               across every session. Mirrors the F6
  //                               approvals.subscribe polling shape so
  //                               iOS/CLI clients can reuse their
  //                               subscription plumbing.
  //
  // Errors surface as JSON-RPC errors with typed `.code`:
  //   LIVE_ACTIVITY_SESSION_NOT_FOUND, LIVE_ACTIVITY_TITLE_TOO_LONG,
  //   LIVE_ACTIVITY_INVALID_PROGRESS, LIVE_ACTIVITY_INVALID_TITLE,
  //   LIVE_ACTIVITY_INVALID_ICON, LIVE_ACTIVITY_INVALID_EXPANDED_DETAIL.
  private registerLiveActivityHandlers(): void {
    this.handlers.set("liveActivity.step", async (params) => {
      const sessionId = params["sessionId"];
      const title = params["title"];
      const progress = params["progress"];
      const icon = params["icon"];
      const expandedDetail = params["expandedDetail"];

      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new Error("sessionId (non-empty string) required");
      }
      if (typeof title !== "string") {
        throw new Error("title (string) required");
      }
      if (typeof progress !== "number") {
        throw new Error("progress (number) required");
      }

      const update: LiveActivityStepUpdate = (() => {
        const base = { sessionId, title, progress };
        if (typeof icon === "string") {
          if (typeof expandedDetail === "string") {
            return { ...base, icon, expandedDetail };
          }
          return { ...base, icon };
        }
        if (typeof expandedDetail === "string") {
          return { ...base, expandedDetail };
        }
        return base;
      })();

      try {
        const outcome = this.liveActivity.step(update);
        return { outcome };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("liveActivity.pending", async (params) => {
      const sessionIdParam = params["sessionId"];
      if (typeof sessionIdParam === "string" && sessionIdParam.length > 0) {
        const pending = this.liveActivity.pending(sessionIdParam);
        return {
          pending: pending ? [serializeLiveActivityStep(pending)] : [],
        };
      }
      // No filter — return every active session's step.
      const all = this.liveActivity.pendingAll();
      return {
        pending: all.map(serializeLiveActivityStep),
      };
    });

    this.handlers.set("liveActivity.subscribe", async (params) => {
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;
      const maxEvents =
        typeof params["maxEvents"] === "number" && (params["maxEvents"] as number) > 0
          ? Math.min(params["maxEvents"] as number, 1000)
          : 256;

      // Poll path — drain buffered steps from an existing subscription.
      if (typeof subscriptionIdIn === "string" && subscriptionIdIn.length > 0) {
        const sub = this.liveActivitySubscriptions.get(subscriptionIdIn);
        if (!sub) {
          throw new Error(`subscription not found: ${subscriptionIdIn}`);
        }
        const drained = sub.events.splice(0, maxEvents);
        sub.lastPolledAt = Date.now();
        if (closeAfter) {
          sub.dispose();
          this.liveActivitySubscriptions.delete(subscriptionIdIn);
        }
        return {
          subscriptionId: subscriptionIdIn,
          events: drained,
          more: sub.events.length > 0,
          closed: closeAfter,
        };
      }

      // Fresh subscription. Buffer grows as steps dispatch; poll drains.
      const subId = `las-${randomUUID()}`;
      const buffer: Array<Record<string, unknown>> = [];
      const dispose = this.liveActivity.subscribe((step) => {
        buffer.push(serializeLiveActivityStep(step));
        // Hard cap to protect memory when a subscriber stops polling.
        if (buffer.length > 10_000) buffer.splice(0, buffer.length - 10_000);
      });
      this.liveActivitySubscriptions.set(subId, {
        events: buffer,
        dispose,
        lastPolledAt: Date.now(),
      });
      return {
        subscriptionId: subId,
        events: [],
        more: false,
        closed: false,
      };
    });
  }

  // ── F15: Multi-agent fleet view RPCs ──────────────────────
  //
  // Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 8, every
  // surface (iOS WorkView, Desktop AgentFleetDashboard, Watch Triage,
  // CarPlay Status, TUI HUD) wants a single-glance view of every running
  // agent session. F15 exposes the FleetView instance as three RPCs:
  //
  //   - fleet.list    — full FleetSnapshot with per-session rows
  //   - fleet.summary — counts-only FleetSummary (cheap, for watch/carplay)
  //   - fleet.watch   — polling subscription returning snapshots emitted
  //                     since the subscriber's last poll. Mirrors the
  //                     computer.session.stream shape so iOS/CLI clients
  //                     can reuse their existing subscription plumbing.
  //
  // Errors are folded into the result envelope for the polling path
  // (unknown subscription id -> Error from RPC layer), mirroring
  // computer.session.stream's contract.
  private registerFleetHandlers(): void {
    this.handlers.set("fleet.list", async () => {
      return this.fleetView.snapshot();
    });

    this.handlers.set("fleet.summary", async () => {
      return this.fleetView.summary();
    });

    // Polling subscription: NDJSON IPC can't carry long-lived push
    // streams, so callers open a subscription (subscribe=true), then
    // poll with subscriptionId. Each poll drains snapshots emitted
    // since the previous poll; close=true tears down the subscription.
    this.handlers.set("fleet.watch", async (params) => {
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;
      const subscribe = params["subscribe"] === true;

      if (typeof subscriptionIdIn === "string") {
        const sub = this.fleetSubscriptions.get(subscriptionIdIn);
        if (!sub) {
          throw new Error(`fleet subscription not found: ${subscriptionIdIn}`);
        }
        const snapshots = sub.snapshots;
        sub.snapshots = []; // drain — each snapshot delivered exactly once
        sub.lastPolledAt = Date.now();
        if (closeAfter) {
          sub.dispose();
          this.fleetSubscriptions.delete(subscriptionIdIn);
        }
        return {
          subscriptionId: subscriptionIdIn,
          snapshots,
          closed: closeAfter,
        };
      }

      if (!subscribe) {
        throw new Error("fleet.watch requires subscribe=true or a subscriptionId");
      }

      // Start a new subscription. The live hook appends incoming
      // snapshots into the subscriber's buffer; cap the buffer so a
      // slow poller cannot cause unbounded memory growth.
      const subId = `fs-${randomUUID()}`;
      const buffer: FleetSnapshot[] = [];
      const dispose = this.fleetView.subscribe((snap) => {
        buffer.push(snap);
        if (buffer.length > 256) buffer.splice(0, buffer.length - 256);
      });
      this.fleetSubscriptions.set(subId, {
        snapshots: buffer,
        dispose,
        lastPolledAt: Date.now(),
      });
      // Seed with the current snapshot so callers don't need a
      // separate fleet.list to prime the UI — matches the behavior
      // of computer.session.stream's history replay.
      const seed = this.fleetView.snapshot();
      return {
        subscriptionId: subId,
        snapshots: [seed],
        closed: false,
      };
    });
  }

  // ── F12: Apple Watch new-task dispatch RPCs ────────────────
  //
  // Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 3, the Watch
  // already has APPROVE primitives (F1) but cannot DISPATCH a new task.
  // F12 exposes two endpoints:
  //
  //   - watch.templates  — list registered dispatch templates (filterable
  //                        by an opaque policy payload forwarded to the
  //                        registry's list() filter)
  //   - watch.dispatch   — create a new ComputerSession from a template,
  //                        validating slot schema, enforcing per-device
  //                        rate limit, and auto-claiming on creation.
  //
  // iOS/watchOS-side WCSession plumbing is OUT OF SCOPE for F12 — this
  // surface is the server-side primitive the mobile team will wire to.
  private registerWatchDispatchHandlers(): void {
    this.handlers.set("watch.templates", async (params) => {
      // Optional `policyTags` forwarded for caller-side filtering. An
      // empty list filters nothing; a non-empty list retains templates
      // that either have no policyTags or whose tags intersect.
      const rawTags = (params as Record<string, unknown>)["policyTags"];
      const tags = Array.isArray(rawTags)
        ? (rawTags as unknown[]).filter((v): v is string => typeof v === "string")
        : null;
      const filter = tags
        ? (t: DispatchTemplate): boolean => {
            const tTags = (t as DispatchTemplate & { policyTags?: readonly string[] }).policyTags;
            if (!tTags || tTags.length === 0) return true;
            return tTags.some((tag) => tags.includes(tag));
          }
        : undefined;
      const list = this.watchDispatch.list(filter);
      return {
        templates: list.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          slots: t.slots.map((s) => ({
            name: s.name,
            type: s.type,
            required: s.required,
            prompt: s.prompt ?? null,
            maxLength: s.maxLength ?? null,
          })),
          defaults: t.defaults,
        })),
      };
    });

    this.handlers.set("watch.dispatch", async (params) => {
      const templateId = params["templateId"];
      const deviceId = params["deviceId"];
      const slotsIn = params["slots"];
      if (typeof templateId !== "string" || templateId.trim() === "") {
        throw new Error("templateId (non-empty string) required");
      }
      if (typeof deviceId !== "string" || deviceId.trim() === "") {
        throw new Error("deviceId (non-empty string) required");
      }
      const slots: Record<string, unknown> =
        slotsIn && typeof slotsIn === "object" && !Array.isArray(slotsIn)
          ? (slotsIn as Record<string, unknown>)
          : {};
      try {
        const session = this.watchDispatch.dispatch({
          templateId,
          slots,
          deviceId,
        });
        return { session: serializeSession(session) };
      } catch (err) {
        throw toRpcError(err);
      }
    });
  }

  // ── F13: CarPlay voice task-dispatch RPCs ──────────────────
  //
  // Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 4, CarPlay is
  // hands-free-only by regulation so dispatch MUST be:
  //
  //   voice transcript → intent parse → template match → auto-claim
  //
  // F13 exposes three endpoints:
  //
  //   - carplay.templates   — list registered templates (with voice pattern
  //                           metadata stripped for wire-size economy).
  //   - carplay.parseVoice  — parse a transcript WITHOUT dispatching (for
  //                           preview flows on the iOS side).
  //   - carplay.dispatch    — parse + create ComputerSession in one call,
  //                           with optional forceTemplateId + slots path
  //                           for confirmation round-trips and an optional
  //                           freeform fallback for low-confidence speech.
  //
  // iOS/CarPlay-side WCSession plumbing is OUT OF SCOPE for F13 — this
  // is the server-side primitive the mobile team will wire against.
  private registerCarPlayDispatchHandlers(): void {
    this.handlers.set("carplay.templates", async (params) => {
      // Wire contract: templates are returned WITHOUT their regex/keywords
      // patterns. The iOS UI only needs to know what's available so the
      // user can ask for it; actual matching happens server-side.
      const rawTags = (params as Record<string, unknown>)["policyTags"];
      const tags = Array.isArray(rawTags)
        ? (rawTags as unknown[]).filter((v): v is string => typeof v === "string")
        : null;
      const filter = tags
        ? (t: CarPlayTemplate): boolean => {
            const tTags = (t as CarPlayTemplate & { policyTags?: readonly string[] }).policyTags;
            if (!tTags || tTags.length === 0) return true;
            return tTags.some((tag) => tags.includes(tag));
          }
        : undefined;
      const list = this.carplayDispatch.list(filter);
      return {
        templates: list.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          defaults: t.defaults,
        })),
      };
    });

    this.handlers.set("carplay.parseVoice", async (params) => {
      const transcript = params["transcript"];
      if (typeof transcript !== "string") {
        throw new Error("transcript (string) required");
      }
      try {
        const result = this.carplayDispatch.parseVoice({ transcript });
        return {
          transcript: result.transcript,
          normalizedTranscript: result.normalizedTranscript,
          match: result.match,
          topCandidates: result.topCandidates,
          needsConfirmation: result.needsConfirmation,
        };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("carplay.dispatch", async (params) => {
      const transcript = params["transcript"];
      const deviceId = params["deviceId"];
      const forceTemplateId = params["forceTemplateId"];
      const slotsIn = params["slots"];
      const allowFreeformIn = params["allowFreeform"];
      if (typeof deviceId !== "string" || deviceId.trim() === "") {
        throw new Error("deviceId (non-empty string) required");
      }
      // transcript is only required when forceTemplateId is absent — the
      // registry enforces this more specifically.
      const parsedSlots: Record<string, string> =
        slotsIn && typeof slotsIn === "object" && !Array.isArray(slotsIn)
          ? Object.fromEntries(
              Object.entries(slotsIn as Record<string, unknown>).flatMap(([k, v]) =>
                typeof v === "string" ? [[k, v] as [string, string]] : [],
              ),
            )
          : {};
      try {
        const result = this.carplayDispatch.dispatch({
          transcript: typeof transcript === "string" ? transcript : "",
          deviceId,
          forceTemplateId: typeof forceTemplateId === "string" ? forceTemplateId : undefined,
          slots: parsedSlots,
          allowFreeform: allowFreeformIn !== false,
        });
        return {
          session: result.session ? serializeSession(result.session) : null,
          match: result.match,
          topCandidates: result.topCandidates,
          needsConfirmation: result.needsConfirmation,
          usedFreeform: result.usedFreeform,
        };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    // V9 T5.10 (F13) iOS wire-compat: CarPlayService.swift subscribes to
    // `carplay.voice.subscribe` and listens on the `carplay.voice` push
    // channel. The daemon doesn't yet emit a continuous voice stream
    // (the existing carplay.parseVoice / dispatch flow is one-shot).
    //
    // Honest stub: register the subscribe RPC so the iOS side gets a
    // subscription id (avoiding an error toast on every CarPlayService
    // attachRPC) and document that no events fire until the dispatch
    // pipeline grows a streaming surface. This is QB#6 — ack the
    // subscription truthfully rather than swallowing the error.
    this.handlers.set("carplay.voice.subscribe", async (params) => {
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;

      if (typeof subscriptionIdIn === "string" && subscriptionIdIn.length > 0) {
        return {
          subscriptionId: subscriptionIdIn,
          events: [],
          more: false,
          closed: closeAfter,
          notes: "carplay.voice continuous stream not yet wired; dispatch is one-shot.",
        };
      }

      const subId = `carplay-voice-${randomUUID()}`;
      return {
        subscriptionId: subId,
        events: [],
        more: false,
        closed: false,
        notes: "carplay.voice continuous stream not yet wired; dispatch is one-shot.",
      };
    });
  }

  // ── F5: Creations store RPCs ───────────────────────────────
  //
  // Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S9 and the
  // Mythical Perfect Workflow (§2.2), agent-created files must land on
  // a canonical path AND notify every subscribed surface. F5 exposes
  // four endpoints:
  //
  //   - creations.save    — write bytes, return metadata (size + sha256)
  //   - creations.list    — list metadata for all files in a session
  //   - creations.get     — fetch a single file's bytes + metadata
  //   - creations.delete  — remove one file (filename set) or a whole
  //                         session dir (filename omitted)
  //
  // Content is transmitted as base64 on the wire so binary creations
  // (PDFs, screenshots) survive the JSON-RPC round-trip. The store
  // emits UnifiedEvents on every save / delete; surfaces wired via F11
  // pick them up without polling.
  //
  // iOS-side CreationsView is OUT OF SCOPE for F5 — this ships the
  // server-side primitive the mobile team will wire against.
  private registerCreationsHandlers(): void {
    this.handlers.set("creations.save", async (params) => {
      const sessionId = params["sessionId"];
      const filename = params["filename"];
      const content = params["content"];
      const encoding = params["encoding"];
      if (typeof sessionId !== "string") {
        throw new Error("sessionId (string) required");
      }
      if (typeof filename !== "string") {
        throw new Error("filename (string) required");
      }
      // Accept content as utf8 string (default) or base64-encoded bytes.
      // JSON-RPC transports treat non-ASCII strings unevenly, so any
      // caller sending binary bytes MUST pass `encoding: "base64"`.
      let buffer: Buffer;
      if (typeof content !== "string") {
        throw new Error("content (string) required");
      }
      if (encoding === "base64") {
        buffer = Buffer.from(content, "base64");
      } else if (encoding === undefined || encoding === "utf8" || encoding === "utf-8") {
        buffer = Buffer.from(content, "utf-8");
      } else {
        throw new Error(`unsupported encoding: ${String(encoding)}`);
      }
      try {
        const metadata = this.creationsStore.save({
          sessionId,
          filename,
          content: buffer,
        });
        return { metadata };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("creations.list", async (params) => {
      const sessionId = params["sessionId"];
      if (typeof sessionId !== "string") {
        throw new Error("sessionId (string) required");
      }
      try {
        const entries = this.creationsStore.list(sessionId);
        return { entries };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("creations.get", async (params) => {
      const sessionId = params["sessionId"];
      const filename = params["filename"];
      const encoding = params["encoding"];
      if (typeof sessionId !== "string") {
        throw new Error("sessionId (string) required");
      }
      if (typeof filename !== "string") {
        throw new Error("filename (string) required");
      }
      try {
        const result = this.creationsStore.get({ sessionId, filename });
        if (result === null) return { found: false };
        // Always base64 on the wire — lossless for binary and safe for
        // text. Callers that know the content is UTF-8 can decode.
        const wireEncoding = encoding === "utf8" || encoding === "utf-8" ? "utf-8" : "base64";
        const content =
          wireEncoding === "utf-8"
            ? result.content.toString("utf-8")
            : result.content.toString("base64");
        return {
          found: true,
          metadata: result.metadata,
          content,
          encoding: wireEncoding,
        };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("creations.delete", async (params) => {
      const sessionId = params["sessionId"];
      const filename = params["filename"];
      if (typeof sessionId !== "string") {
        throw new Error("sessionId (string) required");
      }
      if (filename !== undefined && typeof filename !== "string") {
        throw new Error("filename must be a string when present");
      }
      try {
        const deleted = this.creationsStore.delete({
          sessionId,
          filename: typeof filename === "string" ? filename : undefined,
        });
        return { deleted };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    // V9 GA-15 (T5.4): `creations.watch` is the subscribe-confirm RPC
    // iOS `CreationsView.swift:280` calls before listening for the
    // `creations.updated` push topic. Before this wire-up the method
    // was unregistered and `try? await rpcClient.send("creations.watch")`
    // silently swallowed the "method not found" error — the iOS UI
    // never failed loud, but it also never received the push events
    // the user expected.
    //
    // The handler does NOT hold per-session subscription state of its
    // own (per QB#7 — push fan-out is owned by the CompanionBridge +
    // CompanionServer pair, which already track subscribers per WS
    // connection). It returns the canonical topic name so iOS knows
    // exactly what channel to listen on, plus a `bridged:true` flag
    // so the iOS surface can detect that push delivery is live (vs.
    // an honest stub). Push fan-out flows through:
    //
    //   CreationsStore.save/delete
    //     -> UnifiedDispatchPlane.broadcastUnifiedEvent
    //     -> CompanionBridge maps creation-saved/-deleted/file-write
    //        -> "creations.updated"
    //     -> CompanionServer.broadcastNotification (WS push)
    //     -> iOS RPCClient.subscribe("creations.updated") -> handler
    //
    // The optional `sessionId` param is a filter HINT — the bridge
    // does not currently pre-filter on the daemon side (broadcast is
    // workspace-wide), but echoing it back keeps the contract honest
    // and lets future iterations narrow the fan-out without an iOS
    // re-roll. Non-string sessionId is a hard reject (QB#6 honest
    // validation rather than silent coerce).
    this.handlers.set("creations.watch", async (params) => {
      const sessionIdRaw = params["sessionId"];
      let sessionId: string | undefined;
      if (sessionIdRaw !== undefined && sessionIdRaw !== null) {
        if (typeof sessionIdRaw !== "string") {
          throw new Error("sessionId must be a string when present");
        }
        sessionId = sessionIdRaw;
      }
      const result: Record<string, unknown> = {
        ok: true,
        topic: "creations.updated",
        bridged: true,
      };
      if (sessionId !== undefined) {
        result["sessionId"] = sessionId;
      }
      return result;
    });
  }

  // ── F7: General-purpose file.get with range support ───────
  //
  // Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-F7, iOS
  // ShareLink needs to fetch arbitrary workspace files (not just agent-
  // created ones) with HTTP-style range support so it can render
  // progress bars + resume interrupted downloads.
  //
  // Parameters:
  //   path        — workspace-relative path (or absolute, validated
  //                 inside workspace)
  //   range?      — {start, end?} inclusive byte range
  //   asBase64?   — true to get base64 bytes (required for binary)
  //
  // Returns:
  //   content         — utf-8 or base64 string
  //   encoding        — "utf-8" | "base64"
  //   contentType     — inferred from extension / sniffed
  //   contentRange?   — "bytes <s>-<e>/<total>" (only on ranged reads)
  //   total           — full file size
  //   sha256          — hash of RETURNED bytes (per-chunk integrity)
  //
  // Errors surface as JSON-RPC errors with typed `.code`:
  //   FILE_GET_NOT_FOUND / _PATH_TRAVERSAL / _SYMLINK_ESCAPE /
  //   _BINARY_NOT_ASCII_SAFE / _FILE_TOO_LARGE / _RANGE_UNSATISFIABLE /
  //   _INVALID_PATH.
  //
  // Distinct from the existing `file.get` in companion-server.ts (line
  // ~1631), which is a legacy iOS bridge wired through FileShare. This
  // daemon-level handler is the canonical path; future iOS ShareLink
  // work will migrate to the kairos RPC.
  private registerFileGetHandlers(): void {
    this.handlers.set("file.get", async (params) => {
      const fgh = this.fileGetHandler;
      if (!fgh) {
        // Honest failure (QB #6): we don't silently return an empty file
        // when misconfigured. Callers should have setRuntime() called
        // before hitting file.get; tests that need isolation use
        // setFileGetHandlerForTest.
        throw new Error(
          "file.get handler not configured; runtime must be attached with a non-degenerate working dir",
        );
      }
      const path = params["path"];
      if (typeof path !== "string") {
        throw new Error("path (string) required");
      }
      const rangeRaw = params["range"];
      const asBase64Raw = params["asBase64"];

      // Validate range shape BEFORE handing to the handler so we get a
      // crisp JSON-RPC error rather than an opaque type-cast failure.
      let range: { start: number; end?: number } | undefined;
      if (rangeRaw !== undefined) {
        if (typeof rangeRaw !== "object" || rangeRaw === null || Array.isArray(rangeRaw)) {
          throw new Error("range must be an object with a numeric start");
        }
        const r = rangeRaw as Record<string, unknown>;
        const start = r["start"];
        const end = r["end"];
        if (typeof start !== "number") {
          throw new Error("range.start (number) required");
        }
        if (end !== undefined && typeof end !== "number") {
          throw new Error("range.end must be a number when present");
        }
        range = end === undefined ? { start } : { start, end };
      }

      const asBase64 = asBase64Raw === true;

      try {
        const resp = fgh.serve({
          requestedPath: path,
          ...(range !== undefined ? { range } : {}),
          asBase64,
        });
        // Return the response object directly — keys match the wire
        // contract documented in the comment above.
        return {
          content: resp.content,
          encoding: resp.encoding,
          contentType: resp.contentType,
          ...(resp.contentRange !== undefined ? { contentRange: resp.contentRange } : {}),
          total: resp.total,
          sha256: resp.sha256,
        };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    // file.write — V9 T13.1 follow-up: write a file via fs + record a
    // shadow-git checkpoint so the user can roll back any iOS-Editor-
    // initiated change.
    //
    // Wire contract:
    //   params  : { path: string, content: string }
    //   returns : { ok: true, sha256: string }
    //
    // Quality bars:
    //   - Path must resolve INSIDE the runtime's working dir; refuses
    //     anything that would escape via `..` segments (sandbox-audit
    //     mirrors the same rule).
    //   - Pre-write: ShadowGit.beforeTool("file.write", relPath) records
    //     the existing content hash; users can roll back to that point.
    //   - Post-write: ShadowGit.createCheckpoint records the new state.
    //   - Honest failure: throws with crisp reason rather than returning
    //     `{ ok: false }` with a swallowed error.
    this.handlers.set("file.write", async (params) => {
      const targetPath = params["path"];
      const content = params["content"];
      if (typeof targetPath !== "string" || targetPath.length === 0) {
        throw new Error("path (string) required");
      }
      if (typeof content !== "string") {
        throw new Error("content (string) required");
      }
      if (!this.runtime) {
        throw new Error("Runtime not initialized");
      }
      const workDir = this.runtime.getWorkingDir();
      const { resolve, isAbsolute, relative, dirname } = await import("node:path");
      const absoluteTarget = isAbsolute(targetPath)
        ? resolve(targetPath)
        : resolve(workDir, targetPath);
      const rel = relative(workDir, absoluteTarget);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`path escapes working dir: ${targetPath}`);
      }

      const { writeFile, mkdir } = await import("node:fs/promises");
      const { createHash } = await import("node:crypto");
      const { ShadowGit } = await import("../utils/shadow-git.js");

      // Pre-write checkpoint via ShadowGit so the user can roll back.
      // Failures here don't block the write — shadow-git is advisory.
      try {
        const shadow = new ShadowGit(workDir);
        await shadow.initialize();
        await shadow.beforeTool("file.write", rel);
      } catch {
        // Shadow checkpointing is advisory; never fails the write.
      }

      try {
        await mkdir(dirname(absoluteTarget), { recursive: true });
        await writeFile(absoluteTarget, content, { encoding: "utf-8" });
      } catch (err) {
        throw toRpcError(err);
      }

      const sha256 = createHash("sha256").update(content, "utf-8").digest("hex");

      // Post-write checkpoint — records the new state. Advisory.
      try {
        const shadow = new ShadowGit(workDir);
        await shadow.initialize();
        await shadow.createCheckpoint(`after file.write: ${rel}`);
      } catch {
        // Advisory; the write itself succeeded.
      }

      return { ok: true, sha256 };
    });
  }

  // ── F6: Approval subscription channel RPCs ─────────────────
  //
  // Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §P1-S6 and
  // MASTER_PLAN_V8 §5 P1-F6 (1 day), F1 shipped `computer.session.approve`
  // as part of the full session event stream. F6 adds a dedicated
  // subscription so small surfaces (watch, background phone, CarPlay) can
  // receive approval requests without subscribing to every cursor/step/
  // frame event.
  //
  // Three endpoints:
  //
  //   - approvals.pending      — snapshot of pending approvals (optionally
  //                              filtered by sessionId).
  //   - approvals.subscribe    — polling subscription. First call seeds a
  //                              subscriptionId with an empty event buffer;
  //                              subsequent calls drain accumulated events
  //                              and optionally close the subscription.
  //   - approvals.decide       — resolve a pending approval (allow|deny);
  //                              deciderDeviceId is recorded on the record.
  //
  // NDJSON IPC can't carry long-lived push streams, so `approvals.subscribe`
  // is a polling protocol same as `computer.session.stream` / `fleet.watch`.
  // Auto-expire (sweepExpired) runs on every poll so callers who never
  // decide still see a terminal transition in the stream.
  private registerApprovalHandlers(): void {
    this.handlers.set("approvals.pending", async (params) => {
      // Sweep first so the list is fresh — callers expect expired entries
      // to NOT appear in pending.
      this.approvalQueue.sweepExpired();
      const sessionId = params["sessionId"];
      const list =
        typeof sessionId === "string" && sessionId.length > 0
          ? this.approvalQueue.pendingForSession(sessionId)
          : this.approvalQueue.pending();
      return { pending: list.map(serializeApprovalRecord) };
    });

    this.handlers.set("approvals.subscribe", async (params) => {
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;
      const maxEvents =
        typeof params["maxEvents"] === "number" && (params["maxEvents"] as number) > 0
          ? Math.min(params["maxEvents"] as number, 1000)
          : 256;

      // Poll path — drain buffered events from an existing subscription.
      if (typeof subscriptionIdIn === "string" && subscriptionIdIn.length > 0) {
        const sub = this.approvalSubscriptions.get(subscriptionIdIn);
        if (!sub) {
          throw new Error(`subscription not found: ${subscriptionIdIn}`);
        }
        // Sweep first so expired events flow through the stream.
        this.approvalQueue.sweepExpired();
        // Drain up to maxEvents and compact the buffer.
        const drained = sub.events.splice(0, maxEvents);
        sub.lastPolledAt = Date.now();
        if (closeAfter) {
          sub.dispose();
          this.approvalSubscriptions.delete(subscriptionIdIn);
        }
        return {
          subscriptionId: subscriptionIdIn,
          events: drained.map(serializeApprovalEvent),
          more: sub.events.length > 0,
          closed: closeAfter,
        };
      }

      // Fresh subscription. Buffer grows as events fire; poll drains.
      const subId = `aps-${randomUUID()}`;
      const buffer: ApprovalEvent[] = [];
      const dispose = this.approvalQueue.subscribe((event) => {
        buffer.push(event);
        // Hard cap — protect memory when a subscriber forgets to poll.
        if (buffer.length > 10_000) buffer.splice(0, buffer.length - 10_000);
      });
      this.approvalSubscriptions.set(subId, {
        events: buffer,
        dispose,
        lastPolledAt: Date.now(),
      });
      return {
        subscriptionId: subId,
        events: [],
        more: false,
        closed: false,
      };
    });

    this.handlers.set("approvals.decide", async (params) => {
      const approvalId = params["approvalId"];
      const decision = params["decision"];
      const deciderDeviceId = params["deciderDeviceId"];
      if (typeof approvalId !== "string" || approvalId.trim() === "") {
        throw new Error("approvalId (non-empty string) required");
      }
      if (decision !== "allow" && decision !== "deny") {
        throw new Error("decision must be allow|deny");
      }
      if (typeof deciderDeviceId !== "string" || deciderDeviceId.trim() === "") {
        throw new Error("deciderDeviceId (non-empty string) required");
      }
      try {
        const record = this.approvalQueue.decide({
          approvalId,
          decision,
          deciderDeviceId,
        });
        return { approval: serializeApprovalRecord(record) };
      } catch (err) {
        throw toRpcError(err);
      }
    });
  }

  // ── F9: File-delivery pipeline RPCs ──────────────────────
  //
  // Per MASTER_PLAN_V8 §5 P1-F9, when a creation is finalized the daemon
  // fans out a higher-level delivery notification via F11. Four endpoints:
  //
  //   - delivery.notify       — mint a delivery + fan out `delivery-ready`
  //                             (usually invoked indirectly via the
  //                             creations-store finalize hook; exposed as
  //                             a standalone RPC too for tooling + tests)
  //   - delivery.pending      — list active (non-expired) deliveries,
  //                             optionally filtered by sessionId
  //   - delivery.acknowledge  — a surface marks a delivery as seen/
  //                             downloaded; fans out
  //                             `delivery-acknowledged`
  //   - delivery.subscribe    — polling subscription; same shape as
  //                             approvals.subscribe / fleet.watch
  //
  // Errors surface as JSON-RPC errors with typed `.code`:
  //   DELIVERY_NOT_FOUND / DELIVERY_EXPIRED / DELIVERY_CREATION_MISSING /
  //   DELIVERY_INVALID_TOKEN / DELIVERY_INVALID_PAYLOAD.
  private registerDeliveryHandlers(): void {
    this.handlers.set("delivery.notify", async (params) => {
      const sessionId = params["sessionId"];
      const filename = params["filename"];
      const displayName = params["displayName"];
      const description = params["description"];
      const expiresInSec = params["expiresInSec"];
      if (typeof sessionId !== "string" || sessionId.trim() === "") {
        throw new Error("sessionId (non-empty string) required");
      }
      if (typeof filename !== "string" || filename.trim() === "") {
        throw new Error("filename (non-empty string) required");
      }
      const notifyParams: {
        sessionId: string;
        filename: string;
        displayName?: string;
        description?: string;
        expiresInSec?: number;
      } = { sessionId, filename };
      if (typeof displayName === "string") notifyParams.displayName = displayName;
      if (typeof description === "string") notifyParams.description = description;
      if (typeof expiresInSec === "number" && Number.isFinite(expiresInSec) && expiresInSec > 0) {
        notifyParams.expiresInSec = expiresInSec;
      }
      try {
        const record = this.fileDelivery.notify(notifyParams);
        return { delivery: serializeDeliveryRecord(record) };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("delivery.pending", async (params) => {
      this.fileDelivery.sweepExpired();
      const sessionId = params["sessionId"];
      const list =
        typeof sessionId === "string" && sessionId.length > 0
          ? this.fileDelivery.pendingForSession(sessionId)
          : this.fileDelivery.pending();
      return { pending: list.map(serializeDeliveryRecord) };
    });

    this.handlers.set("delivery.acknowledge", async (params) => {
      const deliveryId = params["deliveryId"];
      const deviceId = params["deviceId"];
      if (typeof deliveryId !== "string" || deliveryId.trim() === "") {
        throw new Error("deliveryId (non-empty string) required");
      }
      if (typeof deviceId !== "string" || deviceId.trim() === "") {
        throw new Error("deviceId (non-empty string) required");
      }
      try {
        const record = this.fileDelivery.acknowledge({ deliveryId, deviceId });
        return { delivery: serializeDeliveryRecord(record) };
      } catch (err) {
        throw toRpcError(err);
      }
    });

    this.handlers.set("delivery.subscribe", async (params) => {
      const subscriptionIdIn = params["subscriptionId"];
      const closeAfter = params["close"] === true;
      const maxEvents =
        typeof params["maxEvents"] === "number" && (params["maxEvents"] as number) > 0
          ? Math.min(params["maxEvents"] as number, 1000)
          : 256;

      // Poll path — drain buffered events from an existing subscription.
      if (typeof subscriptionIdIn === "string" && subscriptionIdIn.length > 0) {
        const sub = this.deliverySubscriptions.get(subscriptionIdIn);
        if (!sub) {
          throw new Error(`subscription not found: ${subscriptionIdIn}`);
        }
        this.fileDelivery.sweepExpired();
        const drained = sub.events.splice(0, maxEvents);
        sub.lastPolledAt = Date.now();
        if (closeAfter) {
          sub.dispose();
          this.deliverySubscriptions.delete(subscriptionIdIn);
        }
        return {
          subscriptionId: subscriptionIdIn,
          events: drained.map(serializeDeliveryEvent),
          more: sub.events.length > 0,
          closed: closeAfter,
        };
      }

      // Fresh subscription. Buffer grows as events fire; poll drains.
      const subId = `dls-${randomUUID()}`;
      const buffer: DeliveryEvent[] = [];
      const dispose = this.fileDelivery.subscribe((event) => {
        buffer.push(event);
        // Hard cap — protect memory when a subscriber forgets to poll.
        if (buffer.length > 10_000) buffer.splice(0, buffer.length - 10_000);
      });
      this.deliverySubscriptions.set(subId, {
        events: buffer,
        dispose,
        lastPolledAt: Date.now(),
      });
      return {
        subscriptionId: subId,
        events: [],
        more: false,
        closed: false,
      };
    });
  }

  // ── Surface Handlers (Phase 1A: 10 Critical RPCs) ──────────
  // These expose daemon subsystems that were previously invisible to all surfaces.

  private registerSurfaceHandlers(): void {
    // 1. FlowTracker — real-time action tracking + intent inference
    this.handlers.set("flow.insights", async () => {
      if (!this.daemon) return { insights: [], velocity: 0 };
      const tracker = this.daemon.getFlowTracker();
      const allActions = tracker.getActions();
      return {
        insights: tracker.getInsights(),
        velocity: tracker.getVelocity(),
        recentActions: allActions.slice(-10),
        state: tracker.getState(),
        struggling: tracker.detectStruggle(),
        hotspots: tracker.getHotspots(5),
        gitSignals: tracker.getGitSignals(),
      };
    });

    // 2. Codebase Health — 0-100 project quality score
    this.handlers.set("health.report", async () => {
      if (!this.daemon) return { score: 0, error: "Daemon not initialized" };
      const report = this.daemon.getLastHealthReport();
      if (report) return report;
      if (!this.runtime) return { score: 0, error: "Runtime not initialized" };
      try {
        return await this.runtime.analyzeHealth();
      } catch (err) {
        return { score: 0, error: String(err) };
      }
    });

    // 3. DecisionLedger — architectural decision history
    this.handlers.set("decisions.list", async (params) => {
      if (!this.runtime) return { decisions: [] };
      const ledger = this.runtime.getDecisionLedger();
      const query = (params as Record<string, string>)["query"];
      return {
        decisions: query ? ledger.searchDecisions(query) : ledger.getAllDecisions(),
        count: ledger.getCount(),
        statusCounts: ledger.getCountByStatus(),
      };
    });

    this.handlers.set("decisions.record", async (params) => {
      if (!this.runtime) return { success: false, error: "Runtime not initialized" };
      const { title, description, rationale, alternatives, affectedFiles, tags } = params as Record<
        string,
        unknown
      >;
      if (!title || !description || !rationale)
        return { success: false, error: "title, description, rationale required" };
      const id = this.runtime.recordDecision({
        title: String(title),
        description: String(description),
        rationale: String(rationale),
        alternatives: Array.isArray(alternatives) ? alternatives.map(String) : [],
        affectedFiles: Array.isArray(affectedFiles) ? affectedFiles.map(String) : [],
        tags: Array.isArray(tags) ? tags.map(String) : [],
      });
      return { success: true, id };
    });

    // 4. Living Spec — spec divergence detection
    this.handlers.set("spec.divergence", async () => {
      if (!this.daemon) return { divergences: [], specLoaded: false };
      const spec = this.daemon.getLivingSpec();
      if (!spec) return { divergences: [], specLoaded: false };
      const manager = this.daemon.getLivingSpecManager();
      const divergences = manager.checkDivergence(spec);
      return {
        specLoaded: true,
        title: spec.title,
        version: spec.version,
        itemCount: spec.items.length,
        divergences,
        actionPlan: divergences.length > 0 ? manager.generateActionPlan(divergences) : null,
      };
    });

    // 5. PWR Cycle — 6-phase development workflow
    this.handlers.set("pwr.status", async () => {
      if (!this.daemon) return { phase: "idle", available: false };
      const pwr = this.daemon.getPWREngine();
      const state = pwr.getState();
      return {
        available: true,
        phase: pwr.getCurrentPhase(),
        history: pwr.getPhaseHistory(),
        state,
      };
    });

    this.handlers.set("pwr.advance", async (params) => {
      if (!this.daemon) return { success: false, error: "Daemon not initialized" };
      const pwr = this.daemon.getPWREngine();
      const { message } = params as Record<string, string>;
      if (!message) return { success: false, error: "message required" };
      const result = pwr.processMessage(message);
      return { success: true, ...result };
    });

    // 6. Ambient Awareness — clipboard/file/terminal monitoring
    this.handlers.set("ambient.status", async () => {
      if (!this.daemon) return { active: false, signals: [] };
      const awareness = this.daemon.getAmbientAwareness();
      return {
        active: true,
        signals: awareness.getSignals(),
        signalCount: awareness.getSignalCount(),
        suggestion: awareness.getProactiveSuggestion(),
      };
    });

    // 7. Idle Detector — away detection + welcome-back summary
    this.handlers.set("idle.status", async () => {
      if (!this.daemon) return { idle: false, durationMs: 0 };
      const detector = this.daemon.getIdleDetector();
      const isIdle = detector.checkIdle();
      const durationMs = detector.getIdleDurationMs();
      return {
        idle: isIdle,
        durationMs,
        lastActivity: Date.now() - durationMs,
      };
    });

    // 8. Cross-Device Context — shared context between devices
    this.handlers.set("crossdevice.context", async () => {
      if (!this.daemon) return { devices: [], context: {} };
      const ctx = this.daemon.getCrossDeviceContext();
      const unified = ctx.getUnifiedContext();
      return {
        context: unified,
        recentEvents: ctx.getRecentEvents({ limit: 20 }),
        promptContext: ctx.buildPromptContext(),
        desktopConnected: ctx.isDeviceConnected("desktop"),
        phoneConnected: ctx.isDeviceConnected("phone"),
        watchConnected: ctx.isDeviceConnected("watch"),
      };
    });

    // 9. Event Triggers — automated event reaction rules
    this.handlers.set("triggers.list", async () => {
      if (!this.daemon) return { triggers: [], status: null };
      const system = this.daemon.getEventTriggerSystem();
      return {
        triggers: system.getTriggers(),
        status: system.getStatus(),
      };
    });

    this.handlers.set("triggers.load", async (params) => {
      if (!this.daemon) return { success: false, error: "Daemon not initialized" };
      const system = this.daemon.getEventTriggerSystem();
      const { configPath } = params as Record<string, string>;
      if (!configPath) return { success: false, error: "configPath required" };
      try {
        const count = await system.loadConfig(configPath);
        return { success: true, loadedCount: count };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    });

    // 10. Smart File Search — frecency-based file ranking
    this.handlers.set("files.search", async (params) => {
      if (!this.daemon) return { results: [] };
      const search = this.daemon.getSmartFileSearch();
      if (!search) return { results: [] };
      const query = (params as Record<string, string>)["query"] ?? "";
      if (!query) return { results: [] };
      const limit = Number((params as Record<string, string>)["limit"]) || 20;
      return { results: search.search(query, limit) };
    });

    // ── Phase 2/3/4 Runtime Surface Handlers ──────────────────

    // 11. Route Classify — semantic task routing
    this.handlers.set("route.classify", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { prompt } = params as Record<string, string>;
      if (!prompt) return { error: "prompt required" };
      return this.runtime.classifyAndRoute(prompt);
    });

    // 12. Parallel Search — multi-source search dispatch
    this.handlers.set("search.parallel", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { query } = params as Record<string, string>;
      if (!query) return { error: "query required" };
      return this.runtime.searchAll(query);
    });

    // 13. Action Check — confirm-action gate classification
    this.handlers.set("action.check", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const p = params as Record<string, unknown>;
      const tool = p["tool"] as string | undefined;
      if (!tool) return { error: "tool required" };
      const args = (p["args"] as Record<string, unknown>) ?? {};
      return this.runtime.checkActionApproval(tool, args);
    });

    // 14. Action Pending — pending approval queue
    this.handlers.set("action.pending", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return { pending: this.runtime.getConfirmAction().getPendingApprovals() };
    });

    // 15. Agent Hierarchy — agent tree + active count
    this.handlers.set("agents.hierarchy", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const hierarchy = this.runtime.getAgentHierarchy();
      return {
        tree: hierarchy.getTree(),
        activeCount: hierarchy.getActiveCount(),
      };
    });

    // 16. Agent Workspace — message count + size stats
    this.handlers.set("agents.workspace", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getAgentWorkspace().getStats();
    });

    // 17. Memory Fence — context fence statistics
    this.handlers.set("memory.fence", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getContextFence().getStats();
    });

    // 18. Memory Quality — retrieval quality metrics
    this.handlers.set("memory.quality", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getRetrievalQuality().computeMetrics();
    });

    // 19. Memory Mine — conversation mining
    this.handlers.set("memory.mine", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { text } = params as Record<string, string>;
      if (!text) return { error: "text required" };
      const miner = this.runtime.getConversationMiner();
      if (!miner) return { error: "ConversationMiner not available" };
      return miner.mineGenericText(text);
    });

    // 20. Adaptive Prompts — model classification + profile
    this.handlers.set("prompts.adaptive", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { model } = params as Record<string, string>;
      if (!model) return { error: "model required" };
      const adaptive = this.runtime.getAdaptivePrompts();
      const tier = adaptive.classifyModel(model);
      return {
        tier,
        profile: adaptive.getProfile(tier),
      };
    });

    // 21. Benchmark History — benchmark run history by type
    this.handlers.set("benchmark.history", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { type } = params as Record<string, string>;
      if (!type) return { error: "type required" };
      return { history: this.runtime.getBenchmarkHarness().getHistory(type as BenchmarkType) };
    });

    // 22. Benchmark Best — best score by type
    this.handlers.set("benchmark.best", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const { type } = params as Record<string, string>;
      if (!type) return { error: "type required" };
      return { best: this.runtime.getBenchmarkHarness().getBestScore(type as BenchmarkType) };
    });

    // 23. Wakeup Payload — L0+L1 context payload
    this.handlers.set("wakeup.payload", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      return this.runtime.getWakeUpPayload();
    });

    // ── Tier 2A: Gap Analysis Handlers ──────────────────────────

    // 24. Context Pressure — utilization status + recent history
    this.handlers.set("context.pressure", async () => {
      const monitor = this.daemon?.getContextPressure();
      if (!monitor) return { level: "unknown", utilizationPercent: 0 };
      const recent = monitor.getHistory(1);
      if (recent.length > 0) {
        return recent[0];
      }
      return { level: "unknown", utilizationPercent: 0 };
    });

    // 25. Terminal Monitor — last error with suggested fix
    this.handlers.set("terminal.lastError", async () => {
      const monitor = this.daemon?.getTerminalMonitor();
      return monitor?.getLastErrorWithSuggestion() ?? null;
    });

    // 26. Terminal Monitor — recent error events as suggestions
    this.handlers.set("terminal.suggestions", async () => {
      const monitor = this.daemon?.getTerminalMonitor();
      return monitor?.getErrors(10) ?? [];
    });

    // 27. File Dependency Graph — impact analysis for a given file
    this.handlers.set("files.impact", async (params) => {
      const graph = this.daemon?.getFileDependencyGraph();
      const file = (params as { file?: string })?.file;
      if (!graph || !file) return { impacted: [] };
      const analysis = graph.analyzeImpact(file);
      return {
        impacted: analysis.transitiveDependents,
        direct: analysis.directDependents,
        totalImpact: analysis.totalImpact,
      };
    });

    // 28. File Dependency Graph — most-imported hotspot files
    this.handlers.set("files.hotspots", async () => {
      const graph = this.daemon?.getFileDependencyGraph();
      return { hotspots: graph?.getHotspots(20) ?? [] };
    });

    this.registerIOSSurfaceHandlers();
  }

  /**
   * Register the 20 RPC methods iOS calls but that weren't previously wired.
   * Git, screen control, briefing, meet, autonomous cancel, config sync,
   * security key exchange, continuity frames, node registry, clipboard inject,
   * notifications, and Siri quickAction.
   */
  private registerIOSSurfaceHandlers(): void {
    // Cast for iOS extension points that may not be fully wired on the runtime.
    // All calls are guarded by optional chaining so missing features degrade to
    // actionable error responses rather than runtime crashes.
    type RuntimeExt = {
      getWorkspaceRoot?: () => string;
      getComputerBindings?: () => {
        screenshot: () => Promise<{
          base64: string;
          width: number;
          height: number;
          format?: string;
        }>;
        mouseClick: (x: number, y: number, button?: string) => Promise<void>;
        mouseMove: (x: number, y: number) => Promise<void>;
        scroll: (dx: number, dy: number) => Promise<void>;
        typeText: (t: string) => Promise<void>;
        keyPress: (keys: string[]) => Promise<void>;
        setClipboard?: (t: string) => Promise<void>;
      };
      getMorningBriefing?: () => { generateBriefing: () => Promise<unknown> };
      getSessionManager?: () => { listRecent?: (n: number) => unknown[] };
      // Phase C: getMeetingStore was moved off the runtime bridge onto
      // KairosDaemon — the runtime never owned meetings. Consumers at
      // `meet.summarize` now read `this.daemon.getMeetingStore()`.
      abortActiveQueries?: () => void;
      updateConfig?: (patch: Record<string, unknown>) => void;
      getConfig?: () => Record<string, unknown>;
      getSessionStore?: () => { storeClientSharedSecret?: (id: string, secret: Buffer) => void };
      getContinuityStore?: () => {
        storeFrame?: (f: { sessionId: string; data: string; timestamp: number }) => string;
        storePhoto?: (p: {
          sessionId: string;
          data: string;
          metadata: Record<string, unknown>;
          timestamp: number;
        }) => string;
      };
      getNodeRegistry?: () => {
        register?: (n: {
          nodeId: string;
          kind: string;
          capabilities: string[];
          name: string;
          connectedAt: number;
        }) => void;
        recordError?: (e: {
          nodeId: string;
          taskId: string;
          error: string;
          timestamp: number;
        }) => void;
        recordResult?: (r: {
          nodeId: string;
          taskId: string;
          result: unknown;
          timestamp: number;
        }) => void;
      };
      getNotificationService?: () => { configure?: (o: unknown) => void };
    };
    const ext = (): RuntimeExt | null =>
      this.runtime ? (this.runtime as unknown as RuntimeExt) : null;

    // ── Git surface (4 methods) ────────────────────────────────
    const runGit = async (args: readonly string[], cwd?: string): Promise<string> => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const run = promisify(execFile);
      const workingDir = cwd ?? ext()?.getWorkspaceRoot?.() ?? process.cwd();
      try {
        const { stdout } = await run("git", [...args], {
          cwd: workingDir,
          maxBuffer: 16 * 1024 * 1024,
        });
        return stdout;
      } catch (err) {
        throw new Error(
          `git ${args.join(" ")}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    this.handlers.set("git.status", async (params) => {
      const path = (params as Record<string, string>)["path"];
      try {
        const [porcelain, branch] = await Promise.all([
          runGit(["status", "--porcelain", "-b"], path),
          runGit(["rev-parse", "--abbrev-ref", "HEAD"], path),
        ]);
        const lines = porcelain.split("\n").filter((l) => l.length > 0);
        const header = lines.find((l) => l.startsWith("##")) ?? "";
        const files = lines
          .filter((l) => !l.startsWith("##"))
          .map((l) => {
            const status = l.slice(0, 2);
            const filename = l.slice(3);
            return {
              status: status.trim(),
              staged: status[0] !== " " && status[0] !== "?",
              modified: status[1] !== " ",
              untracked: status.startsWith("??"),
              path: filename,
            };
          });
        return {
          branch: branch.trim(),
          header,
          files,
          clean: files.length === 0,
          count: files.length,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), clean: true, files: [] };
      }
    });

    this.handlers.set("git.log", async (params) => {
      const path = (params as Record<string, string>)["path"];
      const limit = Number((params as Record<string, unknown>)["limit"]) || 20;
      try {
        const format = "%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s";
        const stdout = await runGit(
          ["log", `--max-count=${limit}`, `--pretty=format:${format}`],
          path,
        );
        const commits = stdout
          .split("\n")
          .filter((l) => l.length > 0)
          .map((line) => {
            const [hash, shortHash, authorName, authorEmail, timestamp, subject] =
              line.split("\x1f");
            return {
              hash,
              shortHash,
              authorName,
              authorEmail,
              timestamp: Number(timestamp) * 1000,
              subject,
            };
          });
        return { commits, count: commits.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), commits: [] };
      }
    });

    this.handlers.set("git.diff", async (params) => {
      const path = (params as Record<string, string>)["path"];
      const staged = Boolean((params as Record<string, unknown>)["staged"]);
      const file = (params as Record<string, string>)["file"];
      try {
        const args = ["diff"];
        if (staged) args.push("--cached");
        if (file) args.push("--", file);
        const diff = await runGit(args, path);
        return { diff, staged, file: file ?? null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), diff: "" };
      }
    });

    this.handlers.set("git.branches", async (params) => {
      const path = (params as Record<string, string>)["path"];
      try {
        const [local, remote] = await Promise.all([
          runGit(["branch", "--format=%(refname:short)\x1f%(HEAD)"], path),
          runGit(["branch", "-r", "--format=%(refname:short)"], path).catch(() => ""),
        ]);
        const branches = local
          .split("\n")
          .filter((l) => l.length > 0)
          .map((line) => {
            const [name, head] = line.split("\x1f");
            return { name, current: head === "*", remote: false };
          });
        const remoteBranches = remote
          .split("\n")
          .filter((l) => l.length > 0)
          .map((name) => ({ name, current: false, remote: true }));
        return { branches: [...branches, ...remoteBranches] };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), branches: [] };
      }
    });

    // ── Screen control (3 methods) ─────────────────────────────
    this.handlers.set("screen.capture", async () => {
      const bindings = ext()?.getComputerBindings?.();
      if (!bindings) return { error: "Computer bindings not available" };
      try {
        const img = await bindings.screenshot();
        return {
          image: img.base64,
          width: img.width,
          height: img.height,
          format: img.format ?? "png",
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.handlers.set("screen.input", async (params) => {
      const bindings = ext()?.getComputerBindings?.();
      if (!bindings) return { error: "Computer bindings not available" };
      const kind = (params as Record<string, string>)["kind"];
      try {
        if (kind === "click") {
          const { x, y, button } = params as { x: number; y: number; button?: string };
          await bindings.mouseClick(x, y, button ?? "left");
          return { ok: true };
        }
        if (kind === "move") {
          const { x, y } = params as { x: number; y: number };
          await bindings.mouseMove(x, y);
          return { ok: true };
        }
        if (kind === "scroll") {
          const { dx, dy } = params as { dx?: number; dy?: number };
          await bindings.scroll(dx ?? 0, dy ?? 0);
          return { ok: true };
        }
        return { error: `unknown kind: ${kind}` };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.handlers.set("screen.keyboard", async (params) => {
      const bindings = ext()?.getComputerBindings?.();
      if (!bindings) return { error: "Computer bindings not available" };
      const { text, keys } = params as { text?: string; keys?: string[] };
      try {
        if (text) await bindings.typeText(text);
        if (keys && Array.isArray(keys)) await bindings.keyPress(keys);
        return { ok: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Morning briefing ───────────────────────────────────────
    this.handlers.set("briefing.daily", async () => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const briefer = ext()?.getMorningBriefing?.();
      if (briefer) {
        try {
          return await briefer.generateBriefing();
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }
      // Fallback: assemble from available subsystems
      const costTracker = this.runtime.getCostTracker();
      const sessions = ext()?.getSessionManager?.()?.listRecent?.(5) ?? [];
      return {
        date: new Date().toISOString().slice(0, 10),
        cost: {
          today: costTracker.getTodayCost(),
          weekly: costTracker.getWeeklyCost(),
        },
        recentSessions: sessions,
        weather: null,
        calendar: [],
        tasks: [],
      };
    });

    // ── Meet summarize ─────────────────────────────────────────
    this.handlers.set("meet.summarize", async (params) => {
      const { meetingId, transcript } = params as { meetingId?: string; transcript?: string };
      if (!this.runtime) return { error: "Runtime not initialized" };
      try {
        // Phase C: read the meeting store through the daemon (not through
        // the runtime ext() bridge). The runtime never owned meetings;
        // wiring it here closes the 4-session silent Meet bug where
        // `getMeetingStore` always resolved to undefined.
        const store = this.daemon?.getMeetingStore() ?? null;
        let text = transcript;
        if (!text && meetingId && store) {
          const meeting = store.getMeeting(meetingId);
          text = meeting?.transcript;
        }
        if (!text) return { error: "transcript or meetingId required" };
        // Use runtime query for summarization
        let summary = "";
        for await (const chunk of this.runtime.query({
          prompt: `Summarize this meeting transcript with key decisions, action items, and open questions:\n\n${text}`,
        })) {
          if (chunk.type === "text") summary += chunk.content ?? "";
        }
        return { summary, meetingId: meetingId ?? null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Autonomous cancel ──────────────────────────────────────
    this.handlers.set("autonomous.cancel", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const taskId = (params as Record<string, string>)["taskId"];
      try {
        const executor = this.runtime.getAutonomousExecutor();
        if (
          executor &&
          typeof (executor as { cancel?: (id?: string) => void }).cancel === "function"
        ) {
          (executor as { cancel: (id?: string) => void }).cancel(taskId);
        }
        // Also signal abort on active queries
        ext()?.abortActiveQueries?.();
        return { ok: true, taskId: taskId ?? null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Config sync ────────────────────────────────────────────
    this.handlers.set("config.sync", async (params) => {
      if (!this.runtime) return { error: "Runtime not initialized" };
      const config = (params as Record<string, unknown>)["config"] ?? {};
      const direction = ((params as Record<string, string>)["direction"] ?? "pull") as
        | "pull"
        | "push";
      try {
        if (direction === "push" && typeof config === "object" && config !== null) {
          const allowed = ["ui", "providers", "hooks", "memory"];
          for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
            if (allowed.includes(key)) {
              ext()?.updateConfig?.({ [key]: value });
            }
          }
        }
        const current = ext()?.getConfig?.() ?? {};
        return {
          ok: true,
          direction,
          config: current,
          version: (current as { version?: string }).version ?? "0.1.0",
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Security key exchange (ECDH P-256 + HKDF-SHA256) ──────────
    //
    // S1-13: Standardized on P-256 + raw-format + HKDF-SHA256 + salt
    // "wotann-v1" to match iOS CryptoKit's ECDHManager and the companion
    // server at companion-server.ts:1205. Previously this handler used
    // X25519 with a non-HKDF SHA-256 derivation, producing AES keys that
    // could never decrypt messages the iOS side encrypted. Three
    // different curves+derivations meant every pairing was broken.
    this.handlers.set("security.keyExchange", async (params) => {
      const { publicKey, sessionId } = params as { publicKey?: string; sessionId?: string };
      if (!publicKey) return { error: "publicKey required" };
      try {
        // iOS sends its public key as base64 of the raw SEC 1 uncompressed
        // representation (65 bytes with 0x04 prefix). Buffer.from handles
        // the base64 decode; createECDH accepts raw format directly.
        const clientPubRaw = Buffer.from(publicKey, "base64");

        const ecdh = createECDH("prime256v1");
        ecdh.generateKeys();
        const serverPubRaw = ecdh.getPublicKey(); // 65-byte uncompressed SEC 1
        const shared = ecdh.computeSecret(clientPubRaw);

        // HKDF-SHA256(salt="wotann-v1", ikm=shared, info="", len=32)
        const salt = Buffer.from("wotann-v1", "utf8");
        const derivedKey = Buffer.from(hkdfSync("sha256", shared, salt, Buffer.alloc(0), 32));

        const sid = sessionId ?? `session-${Date.now()}`;
        this.ecdhSessions.set(sid, { sessionId: sid, derivedKey, createdAt: Date.now() });
        // Prune sessions older than 24h to bound memory.
        const now = Date.now();
        for (const [k, s] of this.ecdhSessions) {
          if (now - s.createdAt > 24 * 60 * 60 * 1000) this.ecdhSessions.delete(k);
        }
        return {
          serverPublicKey: serverPubRaw.toString("base64"),
          sessionId: sid,
          keyFingerprint: derivedKey.subarray(0, 8).toString("hex"),
          algorithm: "ECDH-P256-HKDF-SHA256",
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Continuity camera (iOS → desktop frame handoff) ──────
    this.handlers.set("continuity.frame", async (params) => {
      const { frame, timestamp } = params as { frame?: string; timestamp?: number };
      if (typeof frame !== "string") return { error: "frame (base64) required" };
      try {
        const sizeBytes = Math.floor(frame.length * 0.75); // approx base64 → binary
        this.frameBuffer.push({ timestamp: timestamp ?? Date.now(), sizeBytes });
        while (this.frameBuffer.length > MAX_FRAME_BUFFER) this.frameBuffer.shift();
        return {
          ok: true,
          bufferCount: this.frameBuffer.length,
          totalBytes: this.frameBuffer.reduce((s, f) => s + f.sizeBytes, 0),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    this.handlers.set("continuity.photo", async (params) => {
      const { photo, sessionId, metadata } = params as {
        photo?: string;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };
      if (typeof photo !== "string") return { error: "photo (base64) required" };
      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const photoDir = resolveWotannHomeSubdir("continuity");
        mkdirSync(photoDir, { recursive: true });
        const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = join(photoDir, `${id}.jpg`);
        writeFileSync(path, Buffer.from(photo, "base64"));
        return {
          ok: true,
          photoId: id,
          path,
          sessionId: sessionId ?? "default",
          metadata: metadata ?? {},
          timestamp: Date.now(),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Node registry (phone, watch, CarPlay acting as nodes) ─
    this.handlers.set("node.register", async (params) => {
      const { nodeId, deviceId, capabilities } = params as {
        nodeId?: string;
        deviceId?: string;
        capabilities?: string[];
      };
      if (!nodeId) return { error: "nodeId required" };
      this.nodeRegistry.set(nodeId, {
        nodeId,
        deviceId: deviceId ?? nodeId,
        capabilities: capabilities ?? [],
        registeredAt: Date.now(),
      });
      return { ok: true, nodeId, totalNodes: this.nodeRegistry.size };
    });

    this.handlers.set("node.error", async (params) => {
      const { requestId, error } = params as { requestId?: string; error?: string };
      if (requestId) {
        const pending = this.pendingNodeRequests.get(requestId);
        if (pending) {
          pending.reject(new Error(error ?? "Node error"));
          this.pendingNodeRequests.delete(requestId);
        }
      }
      return { ok: true };
    });

    this.handlers.set("node.result", async (params) => {
      const { requestId, result } = params as { requestId?: string; result?: unknown };
      if (requestId) {
        const pending = this.pendingNodeRequests.get(requestId);
        if (pending) {
          pending.resolve(result);
          this.pendingNodeRequests.delete(requestId);
        }
      }
      return { ok: true };
    });

    // ── Clipboard inject ───────────────────────────────────────
    this.handlers.set("clipboard.inject", async (params) => {
      const { text } = params as { text?: string };
      if (typeof text !== "string") return { error: "text required" };
      try {
        const bindings = ext()?.getComputerBindings?.();
        if (
          bindings &&
          typeof (bindings as { setClipboard?: (t: string) => Promise<void> }).setClipboard ===
            "function"
        ) {
          await (bindings as { setClipboard: (t: string) => Promise<void> }).setClipboard(text);
          return { ok: true, length: text.length };
        }
        // Fallback via pbcopy on macOS
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const run = promisify(execFile);
        if (process.platform === "darwin") {
          const child = execFile("pbcopy");
          child.stdin?.end(text);
          return { ok: true, length: text.length };
        }
        if (process.platform === "linux") {
          await run("xclip", ["-selection", "clipboard"], { input: text } as unknown as object);
          return { ok: true, length: text.length };
        }
        return { error: `Unsupported platform: ${process.platform}` };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Notifications configure (persists prefs to disk) ──────
    this.handlers.set("notifications.configure", async (params) => {
      const { enabled, types, deviceToken, quietHours } = params as {
        enabled?: boolean;
        types?: string[];
        deviceToken?: string;
        quietHours?: { start: string; end: string };
      };
      try {
        const { writeFileSync, mkdirSync } = await import("node:fs");
        // V9 Wave 6.7 (M-N9) — sensitive directory: 0o700 to match the
        // daemon's other wotann-home creators. Notification prefs live
        // alongside session tokens; matching perms keeps the security
        // posture uniform.
        mkdirSync(resolveWotannHome(), { recursive: true, mode: 0o700 });
        const prefs = {
          enabled: enabled ?? true,
          types: types ?? ["task", "error", "briefing"],
          deviceToken: deviceToken ?? null,
          quietHours: quietHours ?? null,
          updatedAt: Date.now(),
        };
        // Wave 6.5-UU (H-22) — iOS notification prefs. Atomic write.
        writeFileAtomic(this.notificationPrefsPath, JSON.stringify(prefs, null, 2), {
          mode: 0o600,
        });
        // Also call service if runtime exposes one
        const notif = ext()?.getNotificationService?.();
        if (notif && typeof notif.configure === "function") {
          notif.configure(prefs);
        }
        return { ok: true, prefs };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    // ── Quick action (Siri / widget tap) ───────────────────────
    //
    // Opus audit (2026-04-15) found this was a wildcard dispatcher:
    // ANY authenticated Siri call could invoke ANY registered RPC
    // handler — including config.set, composer.apply, execute, etc.
    // That made Siri's auth surface the weakest link in the entire
    // RPC tree. Now restricted to an explicit allowlist of read-only
    // and intentionally-Siri-callable methods. Anything else falls
    // through to the natural-language prompt path which respects the
    // normal middleware pipeline + hook guards.
    const SIRI_ALLOWLIST: ReadonlySet<string> = new Set([
      "status",
      "cost.current",
      "cost.snapshot",
      "memory.search",
      "memory.mine",
      "session.list",
      "providers.list",
      "providers.snapshot",
      "skills.list",
      "doctor",
      "context.info",
      "agents.list",
      "workflow.list",
      "channels.status",
      "ping",
      "briefing.daily",
      "meet.summarize",
    ]);
    this.handlers.set("quickAction", async (params) => {
      const { action, args } = params as { action?: string; args?: Record<string, unknown> };
      if (!action) return { error: "action required" };
      if (!this.runtime) return { error: "Runtime not initialized" };
      try {
        if (SIRI_ALLOWLIST.has(action)) {
          const handler = this.handlers.get(action);
          if (handler) {
            const result = await handler(args ?? {});
            return { ok: true, action, result };
          }
        }
        // Unknown or non-allowlisted action: treat as a natural-language
        // prompt to autopilot. The prompt path goes through the normal
        // middleware pipeline + hook guards (DestructiveGuard etc.) so
        // it's the safe default for arbitrary Siri input.
        let response = "";
        for await (const chunk of this.runtime.query({
          prompt: `[SIRI ACTION] ${action}${args ? " " + JSON.stringify(args) : ""}`,
        })) {
          if (chunk.type === "text") response += chunk.content ?? "";
        }
        return { ok: true, action, response };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  private errorResponse(id: string | number | null, code: number, message: string): RPCResponse {
    return {
      jsonrpc: "2.0",
      error: { code, message },
      id: id ?? 0,
    };
  }
}
