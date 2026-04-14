import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ChannelMessage } from "./gateway.js";
import type { WotannMode } from "../core/mode-cycling.js";
import type { WotannQueryOptions, ProviderName, SessionState } from "../core/types.js";
import type { RuntimeStatus } from "../core/runtime.js";
import { createRuntime } from "../core/runtime.js";
import { runRuntimeQuery } from "../cli/runtime-query.js";
import { restoreSession } from "../core/session.js";
import type { StreamChunk } from "../providers/types.js";

export interface DispatchRouteSnapshot {
  readonly routeKey: string;
  readonly senderId: string;
  readonly channelType: string;
  readonly policyId?: string;
  readonly label?: string;
  readonly workspaceDir?: string;
  readonly mode?: WotannMode;
  readonly sessionId?: string;
  readonly sessionPath?: string;
  readonly provider?: ProviderName;
  readonly model?: string;
  readonly messageCount: number;
  readonly lastActiveAt: string;
}

export interface DispatchRoutePolicy {
  readonly id: string;
  readonly label?: string;
  readonly channelType?: string;
  readonly channelId?: string;
  readonly senderId?: string;
  readonly workspaceDir?: string;
  readonly mode?: WotannMode;
  readonly provider?: ProviderName;
  readonly model?: string;
}

export interface DispatchStatus {
  readonly activeRoutes: number;
  readonly persistedRoutes: number;
  readonly policiesLoaded: number;
  readonly routes: readonly DispatchRouteSnapshot[];
}

interface RuntimeLike {
  query(options: WotannQueryOptions): AsyncGenerator<StreamChunk>;
  getStatus(): RuntimeStatus;
  restoreSession(session: SessionState): void;
  saveCurrentSession(): string | null;
  close(): void;
}

type DispatchInboundMessage =
  Pick<ChannelMessage, "content" | "channelType" | "senderId">
  & Partial<Pick<ChannelMessage, "channelId">>;

export interface ChannelDispatchManagerOptions {
  readonly workingDir: string;
  readonly initialMode?: WotannMode;
  readonly manifestPath?: string;
  readonly policyPath?: string;
  readonly policies?: readonly DispatchRoutePolicy[];
  readonly createRuntime?: (workingDir: string, initialMode?: WotannMode) => Promise<RuntimeLike>;
  readonly runQuery?: typeof runRuntimeQuery;
}

interface RouteManifest {
  readonly version: 1;
  readonly routes: readonly DispatchRouteSnapshot[];
}

interface PolicyManifest {
  readonly version: 1;
  readonly policies: readonly DispatchRoutePolicy[];
}

interface ResolvedDispatchRoute {
  readonly routeKey: string;
  readonly senderId: string;
  readonly channelType: string;
  readonly policyId?: string;
  readonly label?: string;
  readonly workspaceDir: string;
  readonly mode?: WotannMode;
  readonly provider?: ProviderName;
  readonly model?: string;
}

export class ChannelDispatchManager {
  private readonly manifestPath: string;
  private readonly policyPath: string;
  private readonly workingDir: string;
  private readonly initialMode?: WotannMode;
  private readonly createRuntimeImpl: NonNullable<ChannelDispatchManagerOptions["createRuntime"]>;
  private readonly runQueryImpl: NonNullable<ChannelDispatchManagerOptions["runQuery"]>;
  private readonly runtimes = new Map<string, RuntimeLike>();
  private readonly routes = new Map<string, DispatchRouteSnapshot>();
  private readonly policies = new Map<string, DispatchRoutePolicy>();

  constructor(options: ChannelDispatchManagerOptions) {
    this.workingDir = options.workingDir;
    this.initialMode = options.initialMode;
    this.manifestPath = options.manifestPath ?? join(options.workingDir, ".wotann", "dispatch", "routes.json");
    this.policyPath = options.policyPath ?? join(options.workingDir, ".wotann", "dispatch", "policies.json");
    this.createRuntimeImpl = options.createRuntime ?? ((workingDir, initialMode) => createRuntime(workingDir, initialMode));
    this.runQueryImpl = options.runQuery ?? runRuntimeQuery;
    this.loadManifest();
    this.loadPolicies();
    for (const policy of options.policies ?? []) {
      this.policies.set(policy.id, normalizePolicy(policy));
    }
    if ((options.policies?.length ?? 0) > 0) {
      this.persistPolicies();
    }
  }

  async handleMessage(
    message: DispatchInboundMessage,
    queryOverrides: Omit<WotannQueryOptions, "prompt"> = {},
  ): Promise<string> {
    const route = this.resolveRoute(message);
    const runtime = await this.getRuntime(route);
    const result = await this.runQueryImpl(runtime, {
      ...queryOverrides,
      provider: queryOverrides.provider ?? route.provider,
      model: queryOverrides.model ?? route.model,
      prompt: message.content,
    });

    const status = runtime.getStatus();
    const previous = this.routes.get(route.routeKey);
    const sessionPath = runtime.saveCurrentSession() ?? previous?.sessionPath;
    const snapshot: DispatchRouteSnapshot = {
      routeKey: route.routeKey,
      senderId: message.senderId,
      channelType: message.channelType,
      policyId: route.policyId,
      label: route.label,
      workspaceDir: route.workspaceDir,
      mode: route.mode ?? status.currentMode,
      sessionId: status.sessionId,
      sessionPath,
      provider: (result.provider as ProviderName | undefined) ?? status.activeProvider ?? undefined,
      model: result.model,
      messageCount: (previous?.messageCount ?? 0) + 1,
      lastActiveAt: new Date().toISOString(),
    };

    this.routes.set(route.routeKey, snapshot);
    this.persistManifest();

    return (result.output || result.errors.join("\n") || "No response generated.").trim();
  }

  getStatus(): DispatchStatus {
    const routes = [...this.routes.values()].sort((left, right) =>
      right.lastActiveAt.localeCompare(left.lastActiveAt),
    );

    return {
      activeRoutes: this.runtimes.size,
      persistedRoutes: routes.length,
      policiesLoaded: this.policies.size,
      routes,
    };
  }

  getPolicies(): readonly DispatchRoutePolicy[] {
    return [...this.policies.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  upsertPolicy(policy: DispatchRoutePolicy): DispatchRoutePolicy {
    const normalized = normalizePolicy(policy);
    this.policies.set(normalized.id, normalized);
    this.persistPolicies();
    return normalized;
  }

  removePolicy(id: string): boolean {
    const deleted = this.policies.delete(id);
    if (deleted) {
      this.persistPolicies();
    }
    return deleted;
  }

  async closeAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      runtime.close();
    }
    this.runtimes.clear();
    this.persistManifest();
  }

  private async getRuntime(route: ResolvedDispatchRoute): Promise<RuntimeLike> {
    const existing = this.runtimes.get(route.routeKey);
    if (existing) {
      return existing;
    }

    const runtime = await this.createRuntimeImpl(route.workspaceDir, route.mode ?? this.initialMode);
    const snapshot = this.routes.get(route.routeKey);
    if (snapshot?.sessionPath) {
      const restored = restoreSession(snapshot.sessionPath);
      if (restored) {
        runtime.restoreSession(restored);
      }
    }

    this.runtimes.set(route.routeKey, runtime);
    return runtime;
  }

  private resolveRoute(message: DispatchInboundMessage): ResolvedDispatchRoute {
    const policy = this.selectPolicy(message);
    const routeKey = policy
      ? `${policy.id}:${message.senderId}`
      : `${message.channelType}:${message.senderId}`;

    return {
      routeKey,
      senderId: message.senderId,
      channelType: message.channelType,
      policyId: policy?.id,
      label: policy?.label,
      workspaceDir: resolveWorkspace(this.workingDir, policy?.workspaceDir),
      mode: policy?.mode ?? this.initialMode,
      provider: policy?.provider,
      model: policy?.model,
    };
  }

  private selectPolicy(message: DispatchInboundMessage): DispatchRoutePolicy | undefined {
    const ranked = this.getPolicies()
      .filter((policy) => matchesPolicy(policy, message))
      .map((policy) => ({ policy, score: specificityScore(policy) }))
      .sort((left, right) => right.score - left.score || left.policy.id.localeCompare(right.policy.id));
    return ranked[0]?.policy;
  }

  private loadManifest(): void {
    if (!existsSync(this.manifestPath)) return;

    try {
      const parsed = JSON.parse(readFileSync(this.manifestPath, "utf-8")) as RouteManifest;
      for (const route of parsed.routes ?? []) {
        this.routes.set(route.routeKey, route);
      }
    } catch {
      // Ignore malformed manifests and rebuild on next write.
    }
  }

  private loadPolicies(): void {
    if (!existsSync(this.policyPath)) return;

    try {
      const parsed = JSON.parse(readFileSync(this.policyPath, "utf-8")) as PolicyManifest;
      for (const policy of parsed.policies ?? []) {
        this.policies.set(policy.id, normalizePolicy(policy));
      }
    } catch {
      // Ignore malformed policies and rebuild on next write.
    }
  }

  private persistManifest(): void {
    mkdirSync(dirname(this.manifestPath), { recursive: true });
    const manifest: RouteManifest = {
      version: 1,
      routes: [...this.routes.values()],
    };
    writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2));
  }

  private persistPolicies(): void {
    mkdirSync(dirname(this.policyPath), { recursive: true });
    const manifest: PolicyManifest = {
      version: 1,
      policies: this.getPolicies(),
    };
    writeFileSync(this.policyPath, JSON.stringify(manifest, null, 2));
  }
}

function normalizePolicy(policy: DispatchRoutePolicy): DispatchRoutePolicy {
  return {
    ...policy,
    workspaceDir: policy.workspaceDir?.trim() ? policy.workspaceDir.trim() : undefined,
    channelType: policy.channelType?.trim() ? policy.channelType.trim() : undefined,
    channelId: policy.channelId?.trim() ? policy.channelId.trim() : undefined,
    senderId: policy.senderId?.trim() ? policy.senderId.trim() : undefined,
    label: policy.label?.trim() ? policy.label.trim() : undefined,
    model: policy.model?.trim() ? policy.model.trim() : undefined,
  };
}

function matchesPolicy(
  policy: DispatchRoutePolicy,
  message: DispatchInboundMessage,
): boolean {
  if (policy.channelType && policy.channelType !== message.channelType) return false;
  if (policy.senderId && policy.senderId !== message.senderId) return false;
  if (policy.channelId && policy.channelId !== message.channelId) return false;
  return true;
}

function specificityScore(policy: DispatchRoutePolicy): number {
  let score = 0;
  if (policy.channelType) score += 1;
  if (policy.channelId) score += 2;
  if (policy.senderId) score += 4;
  if (policy.workspaceDir) score += 1;
  if (policy.provider) score += 1;
  if (policy.model) score += 1;
  return score;
}

function resolveWorkspace(baseDir: string, workspaceDir?: string): string {
  if (!workspaceDir) return baseDir;
  return isAbsolute(workspaceDir) ? workspaceDir : resolve(baseDir, workspaceDir);
}
