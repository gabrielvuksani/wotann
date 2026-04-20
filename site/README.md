# wotann.com — marketing site

Static HTML + CSS + ~60 lines of vanilla JS. No build step, no framework, no tracker.

## Structure

```
site/
  index.html           — landing page (hero, features, compare, surfaces, install, pricing, CTA)
  assets/
    style.css          — full stylesheet, dark-default with light toggle via [data-theme]
    site.js            — theme toggle + copy-to-clipboard, zero dependencies
    favicon.svg        — 40×40 rune mark (navy + gold)
    og-image.svg       — 1200×630 Open Graph card
  robots.txt           — explicit allow for major AI/search crawlers
  sitemap.xml          — section anchors
  CNAME                — `wotann.com` (for GitHub Pages if that path is chosen)
  _headers             — security headers for Cloudflare Pages / Netlify
  vercel.json          — same headers for Vercel
  README.md            — this file
```

## Local preview

Any static server works. One-liners:

```bash
# Python 3
python3 -m http.server -d site 8080
# Node
npx serve site -l 8080
# Deno
deno run -A https://deno.land/std/http/file_server.ts site
```

Then open http://localhost:8080.

## Deployment — recommended order

The host ranking below favors "fast + free + 5-minute setup":

### 1. Cloudflare Pages (recommended)

- Connect repo, set `Build command` to empty, `Build output directory` to `site`.
- Add custom domain `wotann.com` — Cloudflare proxies DNS for you, certificate is automatic.
- Deploy time: ~2 minutes. Invalidation: global, instant.
- Headers from `site/_headers` are applied automatically.

### 2. Vercel

- Import repo, select `site/` as the project root.
- Build command: empty. Output directory: `./` (after selecting `site/` as root).
- Add `wotann.com` in the Vercel dashboard — requires `A` record to Vercel IP or `CNAME` to `cname.vercel-dns.com`.
- Headers in `site/vercel.json` are applied automatically.

### 3. Netlify

- Import repo, base directory `site/`, publish directory `site/`.
- Build command: empty.
- Add custom domain `wotann.com`, configure DNS to Netlify's load balancer or use their DNS.
- Headers in `site/_headers` are applied automatically.

### 4. GitHub Pages

- In repo Settings → Pages, set "Deploy from a branch", branch `main`, folder `/site`.
- The `CNAME` file is already in place.
- Add `CNAME` record for `wotann.com` → `gabrielvuksani.github.io`.
- Slower cache invalidation, no edge network compared to the above.

## DNS records Gabriel will need (at his registrar)

For Cloudflare Pages (recommended):
- Move nameservers to Cloudflare (free tier is fine), then add `CNAME wotann.com → <project>.pages.dev` in the Cloudflare dashboard.

For Vercel:
- `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`, or fully delegate DNS to Vercel.

For GitHub Pages:
- `CNAME www gabrielvuksani.github.io`, and for apex:
- `A @ 185.199.108.153`, `A @ 185.199.109.153`, `A @ 185.199.110.153`, `A @ 185.199.111.153`.

## Accessibility

- Semantic HTML (`header`, `nav`, `main`, `section`, `article`, `footer`).
- Skip-link to `#main`.
- Focus-visible outlines in CSS (`outline: 2px solid var(--accent)`).
- Color contrast ≥ 4.5 : 1 for body text on both themes.
- `prefers-reduced-motion` respected — animations collapse to instant.
- All interactive elements are keyboard-reachable with visible focus.
- SVGs that decorate use `aria-hidden="true"`.
- Theme toggle announces via `aria-label`.

## SEO / AI citability

- `<title>`, meta description, canonical URL, Open Graph, Twitter card all set.
- JSON-LD `SoftwareApplication` schema embedded.
- Sitemap + robots.txt with explicit allow for `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`.
- System fonts only — zero webfont requests, LCP-friendly.
- Static HTML — first paint is the final paint.
