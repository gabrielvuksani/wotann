/**
 * WotannThemePicker — surfaces the 5 signature themes shipped in
 * session 6 (`wotann-tokens.css`) as a live preview grid.
 *
 * Themes toggle via `document.documentElement.dataset.theme` which
 * the CSS reads as `[data-theme="mimir"|"yggdrasil"|...]`. A nullable
 * active slot hides the selection so the default rune theme loads.
 *
 * Persisted to localStorage under `wotann-theme-v1` so the choice
 * survives reload. Deliberately isolated from the existing
 * useTheme() hook — that one manages the legacy light/dark/midnight
 * cascade; this one scopes to the Norse palette layer that sits on
 * top of it.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import { color } from "../../design/tokens.generated";

export type WotannThemeId =
  | "mimir"
  | "yggdrasil"
  | "runestone"
  | "bifrost"
  | "valkyrie"
  | "none";

interface ThemeMeta {
  readonly id: WotannThemeId;
  readonly label: string;
  readonly description: string;
  readonly swatch: string;
  readonly accent: string;
}

// TODO(design-token): theme swatch/accent hex values ARE the theme identity
// (each Norse theme defines its own distinct palette). These literally
// cannot map to shared color.* tokens — they're swatch previews, not
// semantic colors.
const THEMES: readonly ThemeMeta[] = [
  {
    id: "none",
    label: "Default",
    description: "Legacy theme (no WOTANN palette)",
    swatch: "#0a0a0a",
    accent: "#0A84FF",
  },
  {
    id: "mimir",
    label: "Mimir's Well",
    description: "Deep indigo, reflective — the default rune theme",
    swatch: "#0B0E1A",
    accent: "#8C7DF7",
  },
  {
    id: "yggdrasil",
    label: "Yggdrasil",
    description: "Dawn light under the World Tree",
    swatch: "#F5F1E8",
    accent: "#4A6F3E",
  },
  {
    id: "runestone",
    label: "Runestone",
    description: "Weathered slate and gold inlay",
    swatch: "#24262B",
    accent: "#D4A853",
  },
  {
    id: "bifrost",
    label: "Bifröst",
    description: "Rainbow-bridge gradient accent",
    swatch: "#1B0B2B",
    accent: "#FF4D8F",
  },
  {
    id: "valkyrie",
    label: "Valkyrie",
    description: "Storm grey, silver chrome",
    swatch: "#1A1D24",
    accent: "#C0C6D0",
  },
];

const STORAGE_KEY = "wotann-theme-v1";

function readStored(): WotannThemeId {
  if (typeof window === "undefined") return "none";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && THEMES.some((t) => t.id === raw)) return raw as WotannThemeId;
  } catch {
    /* ignore */
  }
  return "none";
}

function applyTheme(id: WotannThemeId): void {
  if (typeof document === "undefined") return;
  if (id === "none") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = id;
  }
}

export function WotannThemePicker(): JSX.Element {
  const [active, setActive] = useState<WotannThemeId>(() => readStored());

  useEffect(() => {
    applyTheme(active);
  }, [active]);

  const select = useCallback((id: WotannThemeId) => {
    setActive(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* best-effort */
    }
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="WOTANN signature theme"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "12px",
        padding: "16px 0",
      }}
    >
      {THEMES.map((theme) => {
        const selected = theme.id === active;
        return (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => select(theme.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              padding: "12px",
              borderRadius: "var(--wotann-radius-md, 12px)",
              border: selected
                ? `2px solid ${color("accent")}`
                : "1px solid rgba(255,255,255,0.1)",
              background: `linear-gradient(135deg, ${theme.swatch} 0%, ${theme.swatch} 70%, ${theme.accent}22 100%)`,
              cursor: "pointer",
              // TODO(design-token): swatch-local contrast text — yggdrasil is a light theme,
              // others are dark; these literals intentionally mismatch the active theme tokens.
              color: theme.id === "yggdrasil" ? "#111" : "#fff",
              fontFamily: "var(--wotann-font-ui, system-ui)",
              textAlign: "left",
              transition: "transform 160ms ease, border-color 160ms ease",
              transform: selected ? "translateY(-2px)" : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                aria-hidden
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: theme.accent,
                  boxShadow: `0 0 8px ${theme.accent}99`,
                }}
              />
              <strong style={{ fontSize: "0.95rem" }}>{theme.label}</strong>
              {selected ? (
                <span aria-label="selected" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
                  ●
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: "0.78rem", opacity: 0.78 }}>{theme.description}</div>
          </button>
        );
      })}
    </div>
  );
}
