# 22 — Constraints and antipatterns

Source: `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` §11 + session quality bars (`feedback_wotann_quality_bars.md`, `feedback_wotann_quality_bars_session2.md`, `feedback_wotann_quality_bars_session2.md` extended) + `wotann/CLAUDE.md`.

This is the "don't do" list. Every Claude Design variant must satisfy all 22 constraints. Any variant that violates any constraint is rejected.

## Visual antipatterns

### 1. No purple. Not a single shade, anywhere, ever.

From `UI_DESIGN_SPEC_2026-04-16.md` §11 rule 1.

- Violates: Ink default dark theme (`accent: "#a855f7"`), 10+ other Ink themes.
- Current state: `UI_UX_AUDIT.md` §5.4 — purple appears in `src/ui/themes.ts:55,95,101,110,120,122,127,133,143,149`.
- **Exception**: WOTANN's W logo gradient is a purple-to-violet fade — this is the brand mark itself, not "purple as accent." Logo is the only purple-permitted element.

### 2. No "AI sparkle" icon.

The messenger glyph is **ᚨ** (Ansuz). Never ✨, 🤖, 🧠, 🚀, or any emoji.

### 3. No chat bubble rounded-rectangle messages.

Messages are flush-left typographic blocks with a 3-char left-hairline accent rune. Think terminal, not iMessage. The Block component is the canonical message render.

### 4. No gradient avatar rings. No animated "thinking" avatars.

Providers are named, shown as flat chips: `[ Opus ◈ 1M ]`. No avatar. No halo. No glow-pulse.

### 5. No "This is experimental" disclaimers on stable features.

Either ship or hide. From session-1 quality bars.

If a feature is genuinely pre-v1, use the label `in early testing` in the feature's settings row — never as a toast or banner in the main UI.

### 6. No tooltips for discoverable features.

If a feature needs a tooltip to be discovered, it isn't designed right. The **exception**: icon buttons get `title="..."` tooltips for accessibility (keyboard focus), which is the correct fallback pattern.

### 7. No emoji in system UI.

Runes, sigils, alchemical marks — all custom SVG, in the type system. No `🚀 ✨ 🎉 🤖 🧠 📊 💰`.

### 8. No ghost onboarding text.

Not "Try asking me about...". The Welcome of Mimir (onboarding hook #1 from `UI_DESIGN_SPEC_2026-04-16.md` §7.1) asks a real question: "What would you like to build?"

### 9. No right-rail collapsed "agent scratchpad."

Agent thinking is in the conversation OR in a dedicated scratchpad panel. Never a mystery sidebar that users don't know exists.

### 10. No notifications badge counts without meaning.

Every badge has a reason a user can read on hover. `🔔 3` has to answer: "3 what?"

## Architectural antipatterns

### 11. No vendor-biased ?? fallbacks.

From session-1 quality bars. ProviderPicker sorts alphabetically (Anthropic, Google, Groq, Ollama, OpenAI, ...). Ollama appears first only when it is the free-tier recommendation, not because WOTANN favours it.

Example: `?? 'anthropic'` hardcoding is forbidden. Use `?? env.DEFAULT_PROVIDER ?? 'ollama'` (free-tier first) and log the decision.

### 12. No opt-out caps on free-tier behaviour.

If Ollama is local and running, WOTANN uses it by default for eligible tasks. Users can opt in to paid providers, never opt out of local.

### 13. No Sonnet-instead-of-Opus auto-downgrades.

Session-1 quality bar: "Sonnet not Haiku." Session-2 extended: Opus for audits, never silent model downgrades without a visible cost-control reason.

### 14. No skip-tasks-silently.

Session-1: "never skip tasks." If the harness can't run a task, it surfaces a concrete error, not a generic "skipped."

### 15. No silent success on honest stubs.

Session-2: honest stubs over silent success. The 5 `C6 stubs` in `commands.rs` (`process_pdf`, `get_lifetime_token_stats`, `get_marketplace_manifest`, `refresh_marketplace_catalog`, `get_camoufox_status`) return zero-valued payloads with explicit labels, never fabricated data.

### 16. No per-session state as module-global.

Session-2: per-session state must be scoped to a session, never module-level singletons. This affects the design of stateful UI (e.g. CommandPalette MRU).

## Copy antipatterns

### 17. No forbidden words.

See `17-copy-and-voice.md` for the full list: sorry / oops / something / we think / maybe / let me / I'll / I can help you / our AI / awesome / great / amazing / fantastic / perfect / exclamation marks in buttons / please (except for irreversible actions) / experimental (on stable features) / coming soon / almost there.

### 18. No passive error messages.

Every error names WHAT broke and WHAT to do next. See `11-states-inventory.md` §"Error state design rules."

### 19. No celebratory toasts for routine actions.

Celebrating "You sent a message!" cheapens the Sealed Scroll. Celebrations are the Sealed Scroll only, used 3 times: first task completed, first API key added, major version upgrade.

## Motion antipatterns

### 20. No animation over 600ms outside of the 3 opt-in exceptions.

From `14-motion-and-haptics.md`. Only:
- Sealed Scroll unroll (420ms — under budget),
- Raven's Flight (800ms — opt-in delight),
- Ember session-end (880ms — opt-in on quit).

Everything else respects the 80 / 150 / 240 / 400 / 600 budget.

### 21. No `transition: all`.

Target only specific properties (`transform`, `opacity`, `backdrop-filter`, `border-color`, etc.). `transition: all` animates layout properties the compositor hasn't warmed up for.

### 22. No parallax / auto-play for users with reduced motion.

`prefers-reduced-motion: reduce` zeros durations. Every animation must have a fallback.

## Theme antipatterns

### 23. Bifrost is NEVER a sustained work surface.

Onboarding only. Major version upgrade only. "Quest complete" celebration only. Never as a daily-driver theme.

### 24. Valkyrie is ONLY in Exploit tab.

Auto-activates on tab enter. Never in Chat, Editor, Workshop.

### 25. No inventing new themes.

Stick to the 5: Mimir / Yggdrasil / Runestone / Bifrost / Valkyrie. If Claude Design wants a 6th theme, it goes in `manifest.scope_extensions` with rationale, NEVER in the default variant.

## Brand antipatterns

### 26. No cosplay.

Norse-inspired, not World of Warcraft. No curved-sword icons, no shield backgrounds, no "epic loot" styling. Dieter Rams × Lewis Chessmen × Bloomberg Terminal — not a fantasy RPG UI kit.

### 27. No gratuitous runes.

Runic glyphs appear in 3-5 controlled places per view, never as decorative spam. If a rune has no semantic meaning in that spot (navigation, status, etc.), it doesn't belong there.

### 28. No claiming to be something WOTANN isn't.

WOTANN is not "a faster Cursor" or "an AI IDE." It's a unified AI agent harness. Copy must reflect that positioning (see `01-product-overview.md`).

## Architecture antipatterns (preserve during redesign)

### 29. Never assume "let the front-end fake it."

The Rust / Tauri layer is real. The KAIROS daemon is real. The iOS RPC layer is real. See `UI_PLATFORMS_DEEP_READ_2026-04-18.md` — "Tauri integration is FULLY REAL and production-grade. The Rust layer is ~7,500 LOC of real systems integration."

Claude Design must design for ACTUAL data, not mocked data.

### 30. Never couple UI to provider specifics.

The Chat tab renders messages regardless of which provider answered. The Council tab supports N=3-4 columns with any mix of providers. ProviderPicker lists 19 providers identically.

### 31. Never break the existing keyboard grid.

16 desktop shortcuts + 50+ TUI slash commands + macOS gestures + iOS VoiceOver. Every existing binding preserved unless explicitly rationalized in redesign notes.

### 32. Never remove Honest stubs.

The 5 labelled stubs (`process_pdf`, etc.) exist for a reason: they are features we have planned but haven't shipped, and we surface them honestly rather than fabricating. If Claude Design redesigns a view that references them, it preserves the "not yet shipped — here's what it'll do" pattern.

## Validation checklist (Claude Design must self-audit)

Before submitting the handoff bundle, Claude Design must verify:

- [ ] No hex color `#A855F7` or any purple shade in any non-logo token.
- [ ] No emoji anywhere in components.json or scaffold TSX.
- [ ] No `transition: all` in any CSS.
- [ ] Every animation has a `prefers-reduced-motion: reduce` fallback.
- [ ] Bifrost theme used only in Onboarding + Celebration components.
- [ ] Valkyrie theme used only in Exploit components.
- [ ] No "sorry" / "oops" / "something" / "we think" in any string.
- [ ] Every error state has {what + action}.
- [ ] Every empty state has a concrete CTA.
- [ ] 4-stop logo gradient (not 2-stop).
- [ ] All 5 themes defined for every color token.
- [ ] W3C Design Tokens format valid.
- [ ] `manifest.competitor_inspirations` populated for every variant.

Any variant that fails self-audit is rejected before entering Gabriel's grading rubric.

---

*End of 22-constraints-and-antipatterns.*
