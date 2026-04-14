# WOTANN Desktop — "Depth" UI Redesign Spec

**Date:** 2026-04-05
**Direction:** "Depth" — Intention over decoration
**Status:** Approved

## Core Philosophy

Not decoration — intention. Every element earns its place through spatial hierarchy, considered typography, and the feeling that something intelligent is always just beneath the surface. Violet appears surgically in exactly 4 places: active sidebar indicator, focused input ring, primary buttons, connected status glow. Everything else is neutral grayscale.

## Design Tokens (Updated)

### Colors — Neutral Grayscale with Violet Accent
```
Base background:    #08080c (deeper than current #09090b — slightly blue-shifted)
Surface 1:          rgba(255,255,255, 0.015) — sidebar, panels
Surface 2:          rgba(255,255,255, 0.025) — cards, inputs, dropdowns
Surface 3:          rgba(255,255,255, 0.04)  — hover states, active items
Border subtle:      rgba(255,255,255, 0.05)  — card borders, dividers
Border default:     rgba(255,255,255, 0.08)  — input borders, separators
Border focus:       rgba(139,92,246, 0.3)    — focus rings only
Accent:             #8b5cf6 (unchanged)
Accent muted:       rgba(139,92,246, 0.08)   — active backgrounds
Ambient glow:       rgba(139,92,246, 0.03)   — background radial gradient
```

### Typography — Weight-Based Hierarchy
```
Font:       Inter / SF Pro Display / system-ui
H1:         24px, weight 700, color #f4f4f5, letter-spacing -0.5px
H2:         18px, weight 600, color #e5e5e5
Body:       14px, weight 400, color #d4d4d8
Secondary:  13px, weight 400, color #a1a1aa
Muted:      12px, weight 400, color #71717a
Tiny:       11px, weight 500, color #52525b (status bar, labels)
Code:       13px, JetBrains Mono / SF Mono, weight 400
```

### Spacing — 8px Grid, 24px Minimum Containers
```
Container padding:  24px (all panels, content areas)
Card padding:       14-16px
Input padding:      12-16px
Section gap:        16px
Item gap:           10px
Element gap:        6-8px
Status bar height:  32px
Header height:      48px
Sidebar width:      260px
Max content width:  768px (max-w-3xl) for chat
```

### Radius
```
Small:   6px (buttons, badges, input actions)
Medium:  8px (cards, inputs, sidebar items)
Large:   10-12px (panels, dropdowns, code blocks)
XL:      14px (input bar, modal)
```

### Transitions
```
Micro (hover, toggle):    150ms ease-out
Standard (panels):        200ms ease-in-out
Spring (cards, lifts):    200ms ease with translateY(-1px)
Focus ring:               200ms ease — border-color + box-shadow
```

## Screen-by-Screen Spec

### 1. Onboarding (5 steps)

**Layout:** Full-screen centered, max-w-2xl (672px), ambient radial glow top-right

**Step indicator:** Numbered circles (32px) connected by 48px lines. Active = violet gradient fill + glow shadow. Completed = violet fill + checkmark. Future = rgba(255,255,255,0.04) fill. Labels below in 11px weight 500.

**Welcome step:**
- Logo: 56px rounded-16 with gradient + shadow
- Heading: 24px weight 700 "What would you like to build?"
- Subtext: 14px muted, max-w-md
- Three feature pills: glass cards in a row (11 AI Providers, 100% Local, Zero Cost)
- CTA: 14px weight 600, violet gradient, 12px 28px padding, 10px radius

**System Check step:**
- DepRow cards: Surface 2 background, 14px padding, 8px radius
- Installed state: green dot + "Ready" label, subtle green border
- Missing state: muted X icon, "Install" button as violet ghost button
- Re-check after install automatically

**Engine step:** Status card centered, spinner or checkmark, "Start Engine" as primary button

**Providers step:** 6 provider cards, glass surface, API key inputs with mono font placeholder, "Get key ↗" links

**Done step:** Green checkmark with glow ring, "Start Using WOTANN →" as green gradient button

### 2. Main Layout (AppShell)

**Structure:** Sidebar (260px) | Main (flex) with Header (48px) + Content + Input Bar + StatusBar (32px)

**Ambient glow:** Radial gradient at top-right of main area, rgba(139,92,246,0.03), 400px radius. Barely perceptible.

**Disconnected banner:** Full-width amber bar at 32px height, amber dot + text + Reconnect button

### 3. Sidebar

**Background:** rgba(255,255,255, 0.015) — NOT glass. Just a very subtle elevation.
**Border-right:** rgba(255,255,255, 0.05)
**Padding:** 20px 14px

**Brand:** Logo (28px, gradient, 8px radius) + "WOTANN" (13px, weight 600)
**New Chat button:** Full-width, violet muted bg (0.08) + violet border (0.15), 8px radius
**Search:** 34px height, surface 2 bg, 8px radius
**Section labels:** 10px uppercase, letter-spacing 1px, #52525b
**Items:** 8px 10px padding, 8px radius, 13px text
- Hover: surface 3 bg, text brightens to #e5e5e5
- Active: violet muted bg (0.08), 3px violet left border bar (rounded), text #e5e5e5
**Footer:** 11px, border-top rgba(255,255,255,0.04), space-between

### 4. Header

**Height:** 48px, border-bottom rgba(255,255,255,0.04)
**Padding:** 0 24px

**Left:** Breadcrumb — strong text "Chat" + muted "› Fix auth module"
**Center:** Mode picker — pill container with surface bg, 3px padding, modes as 5px 14px buttons. Active = violet muted bg + #c4b5fd text
**Right:** Connected status pill (green dot + "Connected" in green), notification bell, ⌘K badge

### 5. Chat — Welcome State

**Centered content, max-w-xl (576px)**
- Logo: 56px, gradient, 16px radius, shadow
- Heading: "What would you like to build?" — 24px weight 700
- Subtext: 14px muted
- Quick actions: 2×2 grid, 10px gap, cards with 14px 16px padding, icon (34px, 8px radius) + label (13px weight 500) + desc (11px muted)
- Hover: translateY(-1px), border brightens, shadow deepens
- Hint: kbd tags for shortcuts

### 6. Chat — Messages

**Container:** max-w-3xl mx-auto, px-24
**User message:** Right-aligned, max-w-[75%], violet muted bg (0.06), 12px radius, 14px 18px padding
**Assistant message:** Left-aligned, max-w-[85%], surface 2 bg, 12px radius, 14px 18px padding
**Message meta:** Below message, 11px muted, tokens + cost with small icons
**Actions on hover:** Copy, Retry, Fork — 6px radius, surface 3 bg, CSS :hover only
**Code blocks:** surface bg, 1px border, 10px radius, header with language + copy button

### 7. Input Bar

**Padding:** 16px 24px 20px
**Container:** Surface 2 bg, 14px radius, 1px border
- Default: border rgba(255,255,255, 0.06)
- Hover: border rgba(255,255,255, 0.1)
- Focus: border rgba(139,92,246, 0.3) + box-shadow 0 0 0 3px rgba(139,92,246, 0.06)
**Actions:** Attach (📎), Enhance (✨), Voice (🎤), Send (↑ in violet gradient circle)

### 8. Status Bar

**Height:** 32px
**Background:** rgba(255,255,255, 0.01)
**Border-top:** rgba(255,255,255, 0.03)
**Content:** 11px, #3f3f46 — green dot + model name · mode · context bar (60px, 3px height) · session cost · daily cost

### 9. Command Palette

**Backdrop:** rgba(0,0,0, 0.5) + backdrop-filter blur(4px)
**Container:** max-w-xl (576px), surface 2 bg, 14px radius, shadow-lg
**Search input:** 48px height, 16px font, no border
**Results:** 8px padding, items at 10px padding, 8px radius. Selected = surface 3 bg + violet left border
**Category headers:** 10px uppercase, #52525b, with small icon

### 10. Settings, Arena, Agents, Memory, Cost Views

All follow the same pattern:
- **Container:** max-w-3xl mx-auto, py-24, px-24
- **Section headings:** 18px weight 600, mb-16
- **Cards:** Surface 2 bg, 1px border, 12px radius, 20-24px padding
- **Form inputs:** Surface 2 bg, border default, 8px radius, focus ring
- **Toggle switches:** 36px wide, violet when on, surface when off
- **Lists:** 10px gap between items, 14px padding per item

## Systemic Changes

1. **Replace ALL raw rgba() with CSS variables** — every component
2. **Replace ALL JS hover handlers with CSS :hover/:focus-visible** — every interactive element
3. **Replace ALL hardcoded Tailwind color classes** (bg-zinc-*, text-zinc-*, border-zinc-*) with CSS var references
4. **Apply consistent border-radius** — 8px for items, 12px for panels, 14px for input bar
5. **Apply 24px minimum padding** on all containers
6. **Remove max-w-lg, replace with max-w-2xl (onboarding) and max-w-3xl (chat)**
7. **Status bar from 24px to 32px**
8. **All font sizes use tokens** — no text-[10px] or text-[9px]
