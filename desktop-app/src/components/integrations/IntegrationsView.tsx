/**
 * IntegrationsView — unified panel for Channels, Connectors, MCP, Skills.
 * Apple-dark palette: #000 bg, #1C1C1E surfaces, #0A84FF accent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChannelsTab } from "./ChannelsTab";
import { ConnectorsTab } from "./ConnectorsTab";
import { MCPTab } from "./MCPTab";
import { SkillsTab } from "./SkillsTab";

export type IntegrationTab = "channels" | "connectors" | "mcp" | "skills";

const TABS: readonly { readonly id: IntegrationTab; readonly label: string }[] = [
  { id: "channels", label: "Channels" },
  { id: "connectors", label: "Connectors" },
  { id: "mcp", label: "MCP" },
  { id: "skills", label: "Skills" },
] as const;

export const PALETTE = {
  bg: "#000000",
  surface: "#1C1C1E",
  surface2: "#2C2C2E",
  accent: "#0A84FF",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(235, 235, 245, 0.60)",
  textTertiary: "rgba(235, 235, 245, 0.30)",
  divider: "rgba(255, 255, 255, 0.08)",
  green: "#30D158",
  grey: "rgba(235, 235, 245, 0.30)",
  danger: "#FF453A",
} as const;

type Counts = Readonly<{ channels: number; connectors: number; mcp: number; skills: number }>;

export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try { return (await invoke<T>(cmd, args)) ?? null; } catch { return null; }
}

async function tryList<T>(cmd: string): Promise<readonly T[]> {
  const r = await safeInvoke<readonly T[]>(cmd);
  return r ?? [];
}

export function IntegrationsView() {
  const [active, setActive] = useState<IntegrationTab>("channels");
  const [counts, setCounts] = useState<Counts>({ channels: 0, connectors: 0, mcp: 0, skills: 0 });

  const refresh = useCallback(async () => {
    const [ch, co, mc, sk] = await Promise.all([
      tryList<{ connected?: boolean }>("get_channels_status"),
      tryList<{ connected?: boolean }>("get_connectors"),
      tryList<{ enabled?: boolean }>("mcp.list"), // TODO: register get_mcp_list command in src-tauri
      tryList<unknown>("get_skills"),
    ]);
    setCounts({
      channels: ch.filter((c) => c.connected === true).length,
      connectors: co.filter((c) => c.connected === true).length,
      mcp: mc.filter((m) => m.enabled !== false).length,
      skills: sk.length,
    });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeIndex = useMemo(() => TABS.findIndex((t) => t.id === active), [active]);

  return (
    <div
      className="h-full flex flex-col"
      style={{
        background: PALETTE.bg,
        color: PALETTE.textPrimary,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif",
      }}
    >
      <header style={{ borderBottom: `1px solid ${PALETTE.divider}`, padding: "20px 24px 0 24px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: PALETTE.textPrimary }}>
          Integrations
        </h1>
        <p style={{ fontSize: 12, color: PALETTE.textSecondary, margin: "4px 0 16px 0" }}>
          Channels, connectors, MCP servers, and skills — unified.
        </p>
        <TabRow active={active} activeIndex={activeIndex} counts={counts} onSelect={setActive} />
      </header>
      <main style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {active === "channels" && <ChannelsTab onRefresh={refresh} />}
        {active === "connectors" && <ConnectorsTab onRefresh={refresh} />}
        {active === "mcp" && <MCPTab onRefresh={refresh} />}
        {active === "skills" && <SkillsTab onRefresh={refresh} />}
      </main>
    </div>
  );
}

interface TabRowProps {
  readonly active: IntegrationTab;
  readonly activeIndex: number;
  readonly counts: Counts;
  readonly onSelect: (id: IntegrationTab) => void;
}

function TabRow({ active, activeIndex, counts, onSelect }: TabRowProps) {
  const tabCount = TABS.length;
  const slidePct = (100 / tabCount) * activeIndex;
  const widthPct = 100 / tabCount;
  return (
    <div
      style={{ position: "relative", display: "flex", width: "100%", maxWidth: 480 }}
      role="tablist"
      aria-label="Integrations sections"
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        const count = counts[t.id];
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.id)}
            style={{
              flex: 1,
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 12px",
              background: "transparent",
              border: "none",
              color: isActive ? PALETTE.textPrimary : PALETTE.textSecondary,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              transition: "color 180ms ease",
            }}
          >
            <span>{t.label}</span>
            {count > 0 && (
              <span
                aria-label={`${count} active`}
                style={{
                  minWidth: 20, height: 18, padding: "0 6px", borderRadius: 9,
                  background: isActive ? PALETTE.accent : PALETTE.surface2,
                  color: isActive ? "#FFFFFF" : PALETTE.textSecondary,
                  fontSize: 11, fontWeight: 600,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 0,
          left: `${slidePct}%`,
          width: `${widthPct}%`,
          height: 2,
          background: PALETTE.accent,
          borderRadius: 2,
          transition: "left 240ms cubic-bezier(0.32, 0.72, 0, 1), width 240ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      />
    </div>
  );
}
