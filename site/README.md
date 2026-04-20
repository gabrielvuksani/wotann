# wotann.com — marketing site

Static HTML + CSS + a small vanilla JS file. No build step. No framework. No tracker. Deploys to Cloudflare Pages.

## Structure

```
site/
  index.html           — landing page (hero, features, compare, surfaces, install, pricing, CTA)
  assets/
    style.css          — full stylesheet, dark-default with light toggle via [data-theme]
    site.js            — theme toggle + copy-to-clipboard, zero dependencies
    favicon.svg        — rune mark
    og-image.svg       — 1200x630 Open Graph card
  robots.txt           — explicit allow for major search + AI-citation crawlers
  sitemap.xml          — root + section anchors
  _headers             — Cloudflare Pages response headers (HSTS, CSP, cache-control)
  _redirects           — path rewrites (/docs -> GitHub, /download -> latest release, etc.)
  CNAME                — legacy, harmless on Cloudflare Pages
  README.md            — this file
```

## Local preview

Any static server works. One-liners:

```bash
# Python 3
python3 -m http.server -d site 8080
# Node
npx serve site -l 8080
```

Then open http://localhost:8080.

## Deploy — Cloudflare Pages (single path, no alternates)

The domain `wotann.com` is already registered on Cloudflare, so DNS is zero-config. The click-path below deploys from the GitHub repo and wires the apex and www records automatically.

### Exact click-path

1. Go to **https://dash.cloudflare.com** and sign in.
2. Left sidebar: **Workers & Pages**.
3. Click **Create** -> **Pages** tab -> **Connect to Git**.
4. Authorize Cloudflare for GitHub if prompted, then pick **`gabrielvuksani/wotann`**.
5. Click **Begin setup**.
6. **Project name**: `wotann` (this sets the preview URL to `wotann.pages.dev`).
7. **Production branch**: `main`.
8. **Framework preset**: **None** (the site is pre-built static HTML/CSS).
9. **Build command**: leave empty.
10. **Build output directory**: `site`
11. **Root directory (advanced)**: `/` (repo root — leave default).
12. Click **Save and Deploy**.

The first build runs immediately and publishes to `https://wotann.pages.dev` within ~60 seconds.

### Wire the custom domain

1. In the same Pages project: **Custom domains** tab -> **Set up a domain**.
2. Enter `wotann.com` -> **Continue** -> **Activate domain**.
3. Repeat for `www.wotann.com` if desired (Cloudflare can redirect www -> apex via a Redirect Rule or keep both).

Because the domain is already on Cloudflare's registrar, the CNAME records (`wotann.com` and `www.wotann.com`) are created automatically and SSL is provisioned within seconds.

### What the config files do

- **`_headers`** — applies HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, plus per-path `Cache-Control` (long-cache for `/assets/*`, short-cache for HTML). No code change needed on Cloudflare's side.
- **`_redirects`** — Cloudflare Pages natively supports the Netlify-style `_redirects` file: shortcuts like `/github` -> the repo, `/download` -> the latest release, `/docs` -> the `docs/` tree on GitHub. Edit this file and re-deploy to change redirects.

### Future pushes

Every push to `main` triggers an automatic deployment. Pull requests get preview URLs of the form `<hash>.wotann.pages.dev` so design changes can be reviewed before merge.

## Accessibility

- Semantic HTML (`header`, `nav`, `main`, `section`, `article`, `footer`).
- Skip-link to `#main`.
- Focus-visible outlines in CSS.
- Color contrast >= 4.5:1 for body text on both themes.
- `prefers-reduced-motion` respected — animations collapse to instant.
- All interactive elements are keyboard-reachable with visible focus.
- Decorative SVGs use `aria-hidden="true"`.
- Theme toggle announces via `aria-label`.

## SEO / AI citability

- `<title>`, meta description, canonical URL, Open Graph, Twitter card all set.
- JSON-LD `SoftwareApplication` schema embedded.
- Sitemap + robots.txt with explicit allow for `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`.
- System fonts only — zero webfont requests. LCP-friendly.
- Static HTML — first paint is the final paint.

## Brand compliance

The site follows `design-brief/02-brand-identity.md`, `04-design-principles.md`, `17-copy-and-voice.md`, and `22-constraints-and-antipatterns.md`:

- No purple in any non-logo element.
- No emoji in system UI. Feature icons use Elder Futhark runes (`ᚱ ᚲ ᛟ ᛏ ᛗ ᚠ ᚷ ᚨ ᛉ`) — each matches the semantic meaning of the card it labels.
- No forbidden words (audited: no "sorry" / "oops" / "something" / "awesome" / "great" / "amazing" / "perfect" / "coming soon" / "!" in buttons).
- No `transition: all`.
- Hearthgold accent `#d4af37` on obsidian/navy canvas matches the Runestone marketing palette.
- System fonts only; Norse typography restraint — no medieval kitsch.
