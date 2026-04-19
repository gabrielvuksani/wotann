# 21 — Handoff bundle schema (what Claude Design must produce)

Source: `wotann/src/design/handoff-receiver.ts` + `wotann/src/design/design-tokens-parser.ts` + `wotann/src/design/component-importer.ts`.

This document describes EXACTLY what Claude Design's output ZIP must contain. The WOTANN CLI ships a receiver at `wotann import-design <bundle.zip>`. If the bundle does not match this schema, the import fails loudly with a descriptive error — not silently.

## Bundle layout

```
bundle.zip
├── manifest.json              REQUIRED
├── design-system.json         REQUIRED (W3C Design Tokens)
├── tokens.json                OPTIONAL (alias for design-system.json)
├── components.json            OPTIONAL (but required for component import)
├── figma.json                 OPTIONAL (raw Figma JSON export)
├── code-scaffold/             OPTIONAL (React/Vue/HTML starter files)
│   ├── Button.tsx
│   ├── Card.tsx
│   └── ...
└── assets/                    OPTIONAL (images, SVGs, fonts)
    ├── logos/
    ├── runes/
    └── fonts/
```

## 1. `manifest.json` — REQUIRED

Schema (from `handoff-receiver.ts:24-32`):

```json
{
  "name": "string — required",
  "version": "string — required (semver)",
  "author": "string — optional",
  "exported_from": "string — optional (which tool generated it)",
  "bundle_version": "string — required (WOTANN receiver checks this)",
  "created_at": "ISO-8601 date — optional",

  "competitor_inspirations": [
    {
      "surface": "desktop | tui | ios",
      "variant": "variant-1 | variant-2 | variant-3",
      "borrowed_from": ["linear", "superhuman", "glass"],
      "specific_pattern": "tab underline slide motion",
      "wotann_innovation": "underline is gold not blue; extended to 4-tab not 2-tab"
    }
  ],
  "surfaces": ["tui", "desktop", "ios"],
  "variant_count_per_surface": 3,
  "scope_extensions": []
}
```

Supported `bundle_version`: `1`, `1.0`, `1.0.0`. Anything else emits a warning but does not fatal (`handoff-receiver.ts:57`).

**Required fields that MUST exist**:
- `name` — non-empty string,
- `version` — non-empty string (WOTANN recommends semver),
- `bundle_version` — non-empty string matching one of the supported versions.

If any required field is missing or empty, the receiver throws: `"manifest.json is missing required string field 'name'"` (or version / bundle_version).

## 2. `design-system.json` — REQUIRED

W3C Design Tokens Community Group format, v6.3 (as shipped by Claude Design 2026-04-17). Schema: https://design-tokens.github.io/community-group/format/.

A token is a leaf with `$value` and optional `$type`. Groups are any non-leaf object. Aliases are `{group.subgroup.token}` strings.

Example:
```json
{
  "$description": "WOTANN target design system",
  "colors": {
    "mimir": {
      "bg": {
        "canvas": {
          "$value": "#07090F",
          "$type": "color"
        }
      }
    }
  },
  "motion": {
    "duration": {
      "base": {
        "$value": "240ms",
        "$type": "duration"
      }
    }
  }
}
```

The parser (`design-tokens-parser.ts`) extracts 5 categories:
1. **colors** — any `$type` "color",
2. **typography** — any `$type` "typography",
3. **spacing** — any `$type` "dimension" under a `spacing` or `space` group,
4. **borderRadius** — under `radius` or `radii`,
5. **shadows** — `$type` "shadow".

Everything else goes in `extras`.

**Aliases are resolved** — `"{colors.mimir.accent.rune}"` gets looked up and replaced with the referenced value.

**Typography tokens expand** — a composite `{"fontFamily": "Inter", "fontSize": "14px", "fontWeight": 400}` becomes 3 CSS properties via the emitter.

### See `15-design-tokens-current.json` for the current-state W3C export.

## 3. `tokens.json` — OPTIONAL (alias)

If present, parsed with the same W3C parser. If absent, defaults to `design-system.json`. Receiver: `handoff-receiver.ts:169`.

## 4. `components.json` — OPTIONAL (but strict when present)

JSON array of component descriptors (`component-importer.ts:91-154`).

Schema:

```json
[
  {
    "name": "string — required, becomes PascalCase TSX filename",
    "type": "string — optional, defaults to 'component'",
    "props": [
      {
        "name": "string — required",
        "type": "string | number | boolean | node | function",
        "required": "boolean — defaults to false",
        "default": "string | number | boolean — optional",
        "description": "string — optional, rendered as JSDoc"
      }
    ],
    "variants": [
      {
        "name": "string",
        "props": {
          "variant": "primary",
          "size": "large"
        }
      }
    ],
    "html": "string — raw HTML; ALWAYS treated as untrusted and exported as RAW_HTML",
    "css": "string — raw CSS; ALWAYS treated as untrusted and exported as RAW_CSS"
  }
]
```

The receiver writes each component as `<output-dir>/components/<PascalName>.tsx` with:
- A typed `PropsType` interface,
- `RAW_HTML` / `RAW_CSS` exports (raw, untrusted — caller must run through DOMPurify / equivalent sanitizer before rendering),
- `VARIANT_NAMES` array,
- A default metadata-only render (does NOT inject raw HTML directly — the receiver is intentionally safe against XSS).

Security note: the receiver's design decision (`component-importer.ts:15-18`) is that RAW_HTML / RAW_CSS are exported as string constants and the default render path shows metadata only. Any consumer that wants to render the raw HTML must explicitly sanitize it first. See `component-importer.ts:196-258` for the exact TSX template the receiver generates.

## 5. `figma.json` — OPTIONAL

Raw Figma JSON export (whatever `/v1/files/:file_key` returns). The receiver preserves it as `bundle.figma` for downstream workshop tools to consume.

## 6. `code-scaffold/` — OPTIONAL

Starter React / Vue / HTML files. Each file is decoded as UTF-8 text. Binary scaffolds are not a recognized shape today.

Receiver reads everything under `code-scaffold/` into `bundle.codeScaffold: CodeScaffoldFile[]`.

## 7. `assets/` — OPTIONAL

Images, SVGs, fonts, audio. Each preserved as `bundle.assets: HandoffAsset[]` with:
- `path` — relative path (e.g. `assets/logos/wotann.svg`),
- `size` — bytes,
- `data` — Buffer (base64-decoded on import).

WOTANN's receiver does NOT write assets to disk automatically. The workshop view shows them; the operator chooses where to place them.

## Complete example ZIP

```
bundle.zip (approx 850 KB)
├── manifest.json                     (~2 KB)
├── design-system.json                (~38 KB — all 5 themes, full W3C format)
├── components.json                   (~65 KB — approx 50 component descriptors)
├── figma.json                        (~180 KB — raw Figma export)
├── code-scaffold/
│   ├── Button.tsx                    (~4 KB)
│   ├── Card.tsx                      (~3 KB)
│   ├── Block.tsx                     (~8 KB — Warp-style)
│   ├── Runering.tsx                  (~5 KB)
│   ├── SealedScroll.tsx              (~7 KB)
│   ├── CapabilityChips.tsx           (~4 KB)
│   ├── TwinRavenView.tsx             (~9 KB)
│   ├── RavenFlight.tsx               (~6 KB)
│   ├── SigilStamp.tsx                (~3 KB)
│   ├── ValknutSpinner.tsx            (~2 KB)
│   ├── RuneForge.tsx                 (~4 KB)
│   ├── CommandPalette.tsx            (~12 KB)
│   └── ... approx 40 more
└── assets/
    ├── logos/
    │   ├── wotann-mimir.svg          (~3 KB)
    │   ├── wotann-yggdrasil.svg      (~3 KB)
    │   ├── wotann-runestone.svg      (~3 KB)
    │   ├── wotann-bifrost.svg        (~4 KB)
    │   └── wotann-valkyrie.svg       (~3 KB)
    ├── runes/                        (24 Elder Futhark svgs + 8 alchemical)
    │   ├── ansuz.svg
    │   ├── raidho.svg
    │   ├── kenaz.svg
    │   └── ...
    └── fonts/
        └── (Inter / JetBrains Mono / Geist — if self-hosted)
```

## Receiver behavior (what happens when Gabriel runs `wotann import-design bundle.zip`)

1. Reads ZIP (`zip-reader.ts`),
2. Parses `manifest.json` — throws if missing or malformed,
3. Parses `design-system.json` via W3C parser,
4. Parses `components.json` if present (strict: throws on malformed arrays or missing names),
5. Collects `code-scaffold/*` and `assets/*`,
6. Returns a `HandoffBundle` object,
7. Emits:
   - `<output-dir>/wotann-tokens.css` (from `emitTokensCss(tokens)`),
   - `<output-dir>/components/*.tsx` (one per component),
   - `<output-dir>/assets/*` (unchanged),
   - `<output-dir>/scaffold/*` (from code-scaffold).

Failure modes (all loud):
- Missing `manifest.json` → "handoff bundle is missing required manifest.json"
- Missing required manifest field → "manifest.json is missing required string field 'name'"
- Invalid JSON in any file → "components.json is not valid JSON: <parser error>"
- `components.json` malformed item → "components[3] is missing required field 'name'"
- Tokens not an object → "design tokens must be a JSON object"

## What Claude Design must generate

The output ZIP must:

1. **Match the schema exactly** — no invented top-level files, no undocumented keys.
2. **Include all three surfaces in one bundle** — TUI / desktop / iOS all covered.
3. **Have three variants per surface** documented in `manifest.competitor_inspirations`.
4. **Pass validation** — `wotann import-design bundle.zip --require-components` must succeed.
5. **Emit Canva / PDF / PPTX / HTML exports** (Claude Design's native export) alongside the ZIP — for visual review.

## Validation command

```bash
wotann import-design bundle.zip --require-components --output-dir=/tmp/wotann-design-test
```

Expected output:

```
Importing bundle.zip...
ok: manifest.json parsed (name=wotann-redesign-2026, version=1.0.0)
ok: design-system.json parsed (127 color tokens, 11 typography tokens, 12 spacing, 5 radii, 15 shadows)
ok: components.json parsed (47 components)
ok: 5 logos, 32 rune SVGs, 0 fonts in assets/
ok: 12 code-scaffold files read
Writing tokens.css... ok
Writing components/... 47 files
Writing assets/... 37 files
Writing scaffold/... 12 files

Import complete. Bundle ready at /tmp/wotann-design-test.
```

If any step fails, the command exits with non-zero and a descriptive error. This is the receiver's contract with Claude Design.

---

*End of 21-handoff-bundle-schema.*
