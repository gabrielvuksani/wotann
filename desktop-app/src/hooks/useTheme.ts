/**
 * Theme hook — applies the 4-tier theme system via CSS classes.
 * Themes defined in globals.css: default (dark), .theme-midnight, .theme-true-black, .theme-light
 * Also listens for OS theme changes when theme is "system".
 * Applies accent color by updating --accent and related CSS variables.
 */

import { useEffect } from "react";
import { useStore } from "../store";

const THEME_CLASSES = ["theme-midnight", "theme-true-black", "theme-light"] as const;

/** Accent color palettes — each maps to primary/hover/muted/glow values */
const ACCENT_PALETTES: Record<
  string,
  {
    readonly primary: string;
    readonly hover: string;
    readonly rgb: string;
    readonly muted: string;
    readonly glow: string;
    readonly glowStrong: string;
    readonly gradient: string;
    readonly gradientHover: string;
    readonly gradientBorder: string;
    readonly gradientText: string;
  }
> = {
  violet: {
    primary: "#0A84FF",
    hover: "#0066CC",
    rgb: "10, 132, 255",
    muted: "rgba(10, 132, 255, 0.08)",
    glow: "rgba(10, 132, 255, 0.15)",
    glowStrong: "rgba(10, 132, 255, 0.25)",
    gradient: "linear-gradient(135deg, #0A84FF, #5AC8FA)",
    gradientHover: "linear-gradient(135deg, #0066CC, #0066CC)",
    gradientBorder: "linear-gradient(135deg, rgba(10, 132, 255, 0.5), rgba(10, 132, 255, 0.5))",
    gradientText: "linear-gradient(135deg, #5AC8FA, #5AC8FA)",
  },
  blue: {
    primary: "#3b82f6",
    hover: "#2563eb",
    rgb: "59, 130, 246",
    muted: "rgba(59, 130, 246, 0.08)",
    glow: "rgba(59, 130, 246, 0.15)",
    glowStrong: "rgba(59, 130, 246, 0.25)",
    gradient: "linear-gradient(135deg, #3b82f6, #2563eb)",
    gradientHover: "linear-gradient(135deg, #2563eb, #1d4ed8)",
    gradientBorder: "linear-gradient(135deg, rgba(59, 130, 246, 0.5), rgba(37, 99, 235, 0.5))",
    gradientText: "linear-gradient(135deg, #93c5fd, #60a5fa)",
  },
  emerald: {
    primary: "#10b981",
    hover: "#059669",
    rgb: "16, 185, 129",
    muted: "rgba(16, 185, 129, 0.08)",
    glow: "rgba(16, 185, 129, 0.15)",
    glowStrong: "rgba(16, 185, 129, 0.25)",
    gradient: "linear-gradient(135deg, #10b981, #059669)",
    gradientHover: "linear-gradient(135deg, #059669, #047857)",
    gradientBorder: "linear-gradient(135deg, rgba(16, 185, 129, 0.5), rgba(5, 150, 105, 0.5))",
    gradientText: "linear-gradient(135deg, #6ee7b7, #34d399)",
  },
  amber: {
    primary: "#f59e0b",
    hover: "#d97706",
    rgb: "245, 158, 11",
    muted: "rgba(245, 158, 11, 0.08)",
    glow: "rgba(245, 158, 11, 0.15)",
    glowStrong: "rgba(245, 158, 11, 0.25)",
    gradient: "linear-gradient(135deg, #f59e0b, #d97706)",
    gradientHover: "linear-gradient(135deg, #d97706, #b45309)",
    gradientBorder: "linear-gradient(135deg, rgba(245, 158, 11, 0.5), rgba(217, 119, 6, 0.5))",
    gradientText: "linear-gradient(135deg, #fcd34d, #fbbf24)",
  },
  rose: {
    primary: "#f43f5e",
    hover: "#e11d48",
    rgb: "244, 63, 94",
    muted: "rgba(244, 63, 94, 0.08)",
    glow: "rgba(244, 63, 94, 0.15)",
    glowStrong: "rgba(244, 63, 94, 0.25)",
    gradient: "linear-gradient(135deg, #f43f5e, #e11d48)",
    gradientHover: "linear-gradient(135deg, #e11d48, #be123c)",
    gradientBorder: "linear-gradient(135deg, rgba(244, 63, 94, 0.5), rgba(225, 29, 72, 0.5))",
    gradientText: "linear-gradient(135deg, #fda4af, #fb7185)",
  },
  cyan: {
    primary: "#06b6d4",
    hover: "#0891b2",
    rgb: "6, 182, 212",
    muted: "rgba(6, 182, 212, 0.08)",
    glow: "rgba(6, 182, 212, 0.15)",
    glowStrong: "rgba(6, 182, 212, 0.25)",
    gradient: "linear-gradient(135deg, #06b6d4, #0891b2)",
    gradientHover: "linear-gradient(135deg, #0891b2, #0e7490)",
    gradientBorder: "linear-gradient(135deg, rgba(6, 182, 212, 0.5), rgba(8, 145, 178, 0.5))",
    gradientText: "linear-gradient(135deg, #67e8f9, #22d3ee)",
  },
};

function applyAccentColor(accentColor: string): void {
  const root = document.documentElement;
  const palette = ACCENT_PALETTES[accentColor] ?? ACCENT_PALETTES["violet"]!;

  root.style.setProperty("--color-primary", palette.primary);
  root.style.setProperty("--color-primary-hover", palette.hover);
  root.style.setProperty("--accent-muted", palette.muted);
  root.style.setProperty("--accent-glow", palette.glow);
  root.style.setProperty("--accent-glow-strong", palette.glowStrong);
  root.style.setProperty("--ambient-glow", `rgba(${palette.rgb}, 0.03)`);
  root.style.setProperty("--gradient-accent", palette.gradient);
  root.style.setProperty("--gradient-accent-hover", palette.gradientHover);
  root.style.setProperty("--gradient-border", palette.gradientBorder);
  root.style.setProperty("--gradient-text", palette.gradientText);
  root.style.setProperty("--border-focus", `rgba(${palette.rgb}, 0.3)`);
  root.style.setProperty("--color-badge-bg", `rgba(${palette.rgb}, 0.15)`);
  root.style.setProperty("--shadow-glow", `0 0 20px rgba(${palette.rgb}, 0.15)`);
  root.style.setProperty("--shadow-glow-strong", `0 0 30px rgba(${palette.rgb}, 0.25)`);
  root.style.setProperty("--gradient-context-bar", `linear-gradient(90deg, ${palette.primary}, ${palette.hover})`);
}

export function useTheme() {
  const theme = useStore((s) => s.settings.theme);
  const accentColor = useStore((s) => s.settings.accentColor);

  useEffect(() => {
    const root = document.documentElement;

    // Remove all theme classes first
    THEME_CLASSES.forEach((cls) => root.classList.remove(cls));

    // Resolve "system" to dark or light based on OS preference
    let resolvedTheme = theme;
    if (theme === "system") {
      resolvedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    // Apply the appropriate CSS class
    // "dark" = no class (default :root styles apply)
    // "midnight", "true-black", "light" = add .theme-{name}
    if (resolvedTheme === "midnight") {
      root.classList.add("theme-midnight");
    } else if (resolvedTheme === "true-black") {
      root.classList.add("theme-true-black");
    } else if (resolvedTheme === "light") {
      root.classList.add("theme-light");
    }
    // "dark" = default, no class needed

    // Listen for OS theme changes when in "system" mode
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        THEME_CLASSES.forEach((cls) => root.classList.remove(cls));
        if (!mediaQuery.matches) {
          root.classList.add("theme-light");
        }
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  // Apply accent color whenever it changes
  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);
}
