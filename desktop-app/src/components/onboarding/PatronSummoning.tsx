/**
 * PatronSummoning — V9 T14.4 motif #5.
 *
 * Onboarding screen with four patron cards. The user picks one and the
 * pick shapes the agent's default persona vibe across the rest of the
 * app. Cards use a tarot-style flip-on-hover (CSS 3D transform).
 *
 * Patron archetypes:
 *
 *   Thor  — blunt, action-first, no preamble.
 *   Odin  — deep, archival, asks "have we seen this before?".
 *   Loki  — clever, tries unconventional approaches first.
 *   Freya — collaborative, surfaces tradeoffs explicitly.
 *
 * Each card has:
 *   - A face (rune glyph + name + epithet).
 *   - A back (traits list + select button) revealed on hover/focus.
 *
 * The component is self-contained — the parent only supplies the
 * `onSelect` callback.
 */

import { useCallback, useState, type JSX } from "react";
import "../../styles/norse-motifs.css";

// ── Types ────────────────────────────────────────────────

export type Patron = "thor" | "odin" | "loki" | "freya";

export interface PatronSummoningProps {
  /** Called with the selected patron's id when the user picks one. */
  readonly onSelect: (patron: Patron) => void;
  /** Optional initial selection (e.g., from a saved profile). */
  readonly initial?: Patron;
  /** Optional className merged onto the root container. */
  readonly className?: string;
}

interface PatronProfile {
  readonly id: Patron;
  readonly name: string;
  readonly epithet: string;
  readonly glyph: string;       // Elder Futhark rune
  readonly summary: string;
  readonly traits: readonly string[];
}

// ── Profiles ─────────────────────────────────────────────

const PATRONS: readonly PatronProfile[] = [
  {
    id: "thor",
    name: "Thor",
    epithet: "Hammer-bearer",
    glyph: "ᚦ",      // Thurisaz — giant / undertaking
    summary: "Blunt, action-first, no preamble.",
    traits: [
      "Skips warm-up and starts coding immediately.",
      "Offers the simplest path that ships.",
      "Calls out blockers in the first sentence.",
      "Default for: rapid prototyping, hotfixes.",
    ],
  },
  {
    id: "odin",
    name: "Odin",
    epithet: "All-father",
    glyph: "ᚨ",      // Ansuz — messenger / wisdom
    summary: "Deep, archival, asks 'have we seen this before?'",
    traits: [
      "Searches memory before suggesting an approach.",
      "Surfaces past decisions that constrain the new one.",
      "Recommends documenting the why, not just the what.",
      "Default for: long-running projects, refactors.",
    ],
  },
  {
    id: "loki",
    name: "Loki",
    epithet: "Sky-walker",
    glyph: "ᚲ",      // Kenaz — flame / insight
    summary: "Clever, tries unconventional approaches first.",
    traits: [
      "Proposes 2-3 wildcard alternatives before the obvious one.",
      "Optimises for elegance and surprise.",
      "Calls attention to non-obvious side effects.",
      "Default for: greenfield design, creative tooling.",
    ],
  },
  {
    id: "freya",
    name: "Freya",
    epithet: "Vanir-queen",
    glyph: "ᚹ",      // Wunjo — joy / validation
    summary: "Collaborative, surfaces tradeoffs explicitly.",
    traits: [
      "Lays out trade-offs so you can pick.",
      "Asks one clarifying question before non-trivial work.",
      "Names risk and effort alongside the recommendation.",
      "Default for: team workflows, planning sessions.",
    ],
  },
];

// ── Card ─────────────────────────────────────────────────

interface PatronCardProps {
  readonly profile: PatronProfile;
  readonly selected: boolean;
  readonly onSelect: (id: Patron) => void;
}

function PatronCard({ profile, selected, onSelect }: PatronCardProps): JSX.Element {
  // Manual flip state for keyboard users — hover handles mouse users via CSS.
  const [flipped, setFlipped] = useState(false);

  const handleClick = useCallback(() => {
    setFlipped((v) => !v);
  }, []);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setFlipped((v) => !v);
      }
    },
    [],
  );

  const handleSelect = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onSelect(profile.id);
    },
    [onSelect, profile.id],
  );

  return (
    <div
      className="patron-card"
      data-patron={profile.id}
      data-selected={selected ? "true" : "false"}
      data-flipped={flipped ? "true" : "false"}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${profile.name} — ${profile.epithet}`}
      onClick={handleClick}
      onKeyDown={handleKey}
    >
      <div className="patron-card__inner">
        <div className="patron-card__face">
          <header>
            <div className="patron-card__name">{profile.name}</div>
            <div className="patron-card__epithet">{profile.epithet}</div>
          </header>
          <div className="patron-card__glyph" aria-hidden="true">
            {profile.glyph}
          </div>
          <p
            style={{
              fontSize: 13,
              color: "var(--wotann-ink-secondary, #9fb1c8)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            {profile.summary}
          </p>
        </div>
        <div className="patron-card__back">
          <header>
            <div className="patron-card__name" style={{ fontSize: 18 }}>
              {profile.name}'s ways
            </div>
            <div className="patron-card__epithet">{profile.epithet}</div>
          </header>
          <ul
            className="patron-card__traits"
            aria-label={`${profile.name} traits`}
            style={{ paddingLeft: 16, listStyle: "disc" }}
          >
            {profile.traits.map((trait, i) => (
              <li key={i}>{trait}</li>
            ))}
          </ul>
          <button
            type="button"
            className="patron-card__select"
            onClick={handleSelect}
            aria-label={`Select ${profile.name} as patron`}
          >
            {selected ? "Selected" : `Choose ${profile.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ────────────────────────────────────────────

export function PatronSummoning({
  onSelect,
  initial,
  className,
}: PatronSummoningProps): JSX.Element {
  const [selected, setSelected] = useState<Patron | null>(initial ?? null);

  const handlePick = useCallback(
    (id: Patron) => {
      setSelected(id);
      onSelect(id);
    },
    [onSelect],
  );

  return (
    <section
      className={`patron-summoning${className ? ` ${className}` : ""}`}
      aria-label="Choose a patron"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: 32,
        background: "var(--wotann-bg-canvas, #07090f)",
        color: "var(--wotann-ink-primary, #e8eef7)",
        minHeight: "100%",
      }}
    >
      <header style={{ textAlign: "center", maxWidth: 640, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--wotann-font-display, system-ui)",
            fontSize: 28,
            fontWeight: 700,
            margin: "0 0 8px",
            letterSpacing: "0.02em",
          }}
        >
          Choose your patron
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--wotann-ink-secondary, #9fb1c8)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Each patron shapes the default vibe of WOTANN's responses. Hover or focus a card
          to see how they work. You can change this later in Settings.
        </p>
      </header>
      <div
        role="radiogroup"
        aria-label="Patrons"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 20,
          maxWidth: 1080,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {PATRONS.map((p) => (
          <PatronCard
            key={p.id}
            profile={p}
            selected={selected === p.id}
            onSelect={handlePick}
          />
        ))}
      </div>
    </section>
  );
}
