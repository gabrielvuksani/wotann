/**
 * SettingsAdvancedSection — V9 R-05 Settings entry point that hosts
 * the PatronSummoningButton.
 *
 * The existing `AdvancedSection` inside `SettingsView.tsx` is the
 * canonical Advanced settings panel and is owned by another agent
 * (it covers Engine controls, Diagnostics, Model Updates, etc.).
 * This file is the dedicated host for the new R-05 entry point so
 * the producer-consumer wire is grep-able from a single filename:
 *
 *   - Producer: PatronSummoningButton (this component renders it)
 *   - Consumer: App.tsx's `wotann:open-patron` window listener
 *
 * The component renders a single labelled subsection — "Onboarding"
 * — with a short helper sentence and the Choose-Patron button.
 * Imported from anywhere the Settings UX wants to surface the entry
 * point (the Advanced section is the default, but Onboarding /
 * General are equally valid hosts).
 *
 * USAGE
 * ─────
 *
 *     import { SettingsAdvancedSection } from "./SettingsAdvancedSection";
 *
 *     return (
 *       <div>
 *         {/* ...existing Advanced section content... *\/}
 *         <SettingsAdvancedSection />
 *       </div>
 *     );
 *
 * QUALITY BARS
 * ────────────
 *  - QB #6 honest stubs: when the button's onClick hits an
 *    environment without `window`, the panel still renders — the
 *    button is the one that no-ops the dispatch (see
 *    PatronSummoningButton.tsx).
 *  - QB #11 sibling-site safety: this is the SOLE Settings host
 *    for the PatronSummoningButton. If a future Settings UX wants
 *    the button in a different section, prefer importing this
 *    panel rather than re-rendering the button in two places —
 *    keeps the producer count at exactly one Settings home.
 */

import { type CSSProperties, type JSX } from "react";
import { PatronSummoningButton } from "../onboarding/PatronSummoningButton";

// ── Public types ────────────────────────────────────────────

export interface SettingsAdvancedSectionProps {
  /**
   * Optional className merged onto the section root. Lets the
   * Settings panel apply its own card / border styling without the
   * section shipping with opinionated chrome.
   */
  readonly className?: string;
  /**
   * Optional inline style merged onto the section root.
   */
  readonly style?: CSSProperties;
}

// ── Default styles ──────────────────────────────────────────

const SECTION_STYLE: CSSProperties = {
  padding: "12px 0",
};

const HEADER_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-text-primary, #f6f6f8)",
  margin: "0 0 6px",
};

const HELPER_STYLE: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-muted, rgba(255,255,255,0.6))",
  margin: "0 0 10px",
  lineHeight: 1.4,
};

const ROW_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

// ── Component ───────────────────────────────────────────────

/**
 * Self-contained Settings sub-section that surfaces the
 * Choose-Patron entry point.
 *
 * The section is rendered as a labelled block (header + helper
 * sentence + button) so a Settings consumer can drop it in without
 * needing to write any Patron-specific copy.
 */
export function SettingsAdvancedSection(
  props: SettingsAdvancedSectionProps = {},
): JSX.Element {
  const { className, style } = props;
  return (
    <section
      className={className}
      style={{ ...SECTION_STYLE, ...style }}
      aria-label="Onboarding settings"
      data-wotann-section="settings-advanced-onboarding"
    >
      <h3 style={HEADER_STYLE}>Onboarding</h3>
      <p style={HELPER_STYLE}>
        Choose or change your patron. Each patron shapes the default
        vibe of WOTANN's responses across every surface.
      </p>
      <div style={ROW_STYLE}>
        <PatronSummoningButton label="Choose patron" />
      </div>
    </section>
  );
}
