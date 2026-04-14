# WOTANN Design System — Obsidian Precision

## Theme
- Primary: **OLED black** (`#000000`) base — true black for pixel efficiency
- 4 variants: Dark (default), Midnight, True Black, Light
- Accent: **Apple system blue** (`#0A84FF`) used sparingly — active indicator, send button, focus ring, selection
- Glass panels: `backdrop-filter: blur(40px) saturate(1.5)`

## Palette
- Background: `#000000` (base) → `#1C1C1E` (Apple gray elevated, cards/panels) → `#2C2C2E` (interactive surfaces)
- Text: `#FFFFFF` (primary), `#EBEBF5` at 60% (secondary), `#EBEBF5` at 30% (muted), `#EBEBF5` at 18% (dim), `#EBEBF5` at 10% (ghost)
- Borders: `rgba(255,255,255,0.04)` (whisper), `rgba(255,255,255,0.08)` (default), `rgba(255,255,255,0.14)` (emphasis)
- Status: `#30D158` (connected/done — Apple green), `#0A84FF` (working — system blue), `#FFD60A` (pending — Apple yellow), `#FF453A` (error — Apple red)
- Surfaces: 3 depth levels via Apple's elevated-gray ladder (`#1C1C1E` / `#2C2C2E` / `#3A3A3C`)

## Navigation Architecture
- Header: 44px height — iOS-standard navigation bar dimension
- 4 top-level pills: **Chat** | **Editor** | **Workshop** | **Exploit**
- Terminal: bottom panel, toggles independently (Cmd+J)
- Diff/Changes: right panel, toggles independently (Cmd+Shift+D)
- Worker Pill: compact ambient indicator at sidebar bottom
- Compare / Settings / Memory / Cost / Schedule: accessed via Cmd+K command palette

## Typography
- UI: **SF Pro Text** → `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", system-ui, sans-serif`
- Display: **SF Pro Display** for headings `>=` 20px
- Code: **SF Mono** → `"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Code", monospace`
- OpenType: `font-feature-settings: "ss01", "ss02", "cv11"` — SF Pro's stylistic sets
- Scale: 2xs (10px), xs (11px), detail (12px), sm (13px), base (15px — iOS body), lg (17px — iOS headline), xl (20px), 2xl (24px)
- Letter spacing: `-0.01em` body, `-0.02em` display, `0.00em` code
- Tabular numerals: `font-variant-numeric: tabular-nums` on all number displays

## Layout
- Header pills: 36px tall inside a 44px header bar
- Sidebar: 260px Apple-grey panel with project groups, no sub-tabs
- Context panel: 288px glass, collapsible
- Status bar: 24px compact
- Terminal: bottom panel with draggable divider
- Diff: right panel with draggable divider
- 8pt grid spacing — base unit `0.5rem` = 8px

## Components
- Cards: `border-radius: 10px`, `border: 1px solid rgba(255,255,255,0.06)`, `background: #1C1C1E`
- Buttons:
  - Primary: `background: #0A84FF`, `color: #FFFFFF`
  - Secondary: `background: #2C2C2E`, `border: 1px solid rgba(255,255,255,0.06)`
  - Gradient send: `linear-gradient(135deg, #0A84FF, #0066CC)`
  - Press state: `scale(0.97)` on `:active`
- Inputs: `border-radius: 10px`, `background: #1C1C1E`, focus glow ring `0 0 0 3px rgba(10,132,255,0.20)`
- Tool calls: minimal single-line (`2.5px dot + tool_name + details`), dot color `#0A84FF` when active
- Message bubbles: user = `rgba(10,132,255,0.14)` tinted bg, assistant = transparent bg
- Worker Pill: compact ambient indicator at sidebar bottom

## Depth
- Level 0: `#000000` base background
- Level 1: `#1C1C1E` — subtle elevation, cards
- Level 2: `#2C2C2E` — interactive surfaces, inputs, hover
- Level 3: `#3A3A3C` — pressed state, popover tops
- Glass: `rgba(28,28,30,0.86)` + `blur(40px)` — sidebar, overlays, command palette

## Icons
- SF Symbols-style hand-drawn SVG — no icon library dependency
- Stroke width: 1.2-1.5px for detail sizes, 1.75-2px for nav
- Sizes: 10px (inline), 12px (buttons), 16px (nav), 20px (primary actions)
- No emojis in UI chrome

## Animation
- Micro (60-100ms): button press, hover state
- Meso (150-200ms): panel toggle, view transitions
- Macro (250-400ms): welcome screen entrance, modal present
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) — Apple's UIKit default
- Always respect `prefers-reduced-motion`

## Responsive
- Sidebar collapses at `<` 1000px window width
- Context panel hides at `<` 800px
- Minimum window: 800x600

## Guardrails
- No hardcoded hex colors in components — use CSS variables (`--bg-0`, `--blue-500`, etc.)
- No emojis — use SVG icons
- No `onMouseOver` / `onMouseOut` JS — use CSS `:hover`
- No inline font declarations — use `var(--font-sans)` or `var(--font-mono)`
- All interactive elements must have `aria-label`
- All color combinations must meet WCAG AA 4.5:1 contrast (7:1 for small text)
- Borders at whisper-level opacity (`0.04`-`0.08`), never heavy
- Blue is scarce — reserve `#0A84FF` for genuine active / primary-action / focus states only
