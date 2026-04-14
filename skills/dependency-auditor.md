---
name: dependency-auditor
description: CVE scanning, supply-chain security, SBOM, license compliance
context: fork
paths: ["**/package.json", "**/Cargo.toml", "**/go.mod", "**/requirements.txt", "**/pyproject.toml", "**/Gemfile", "**/pom.xml"]
---

# Dependency Auditor

## When to Use
- Reviewing third-party deps before adding or upgrading.
- Responding to a CVE advisory (GitHub, OSV, NVD, Snyk).
- Generating a Software Bill of Materials for compliance.
- License review before product ship.
- Pre-release gate on new vulnerabilities.

## Rules
- Pin direct deps to exact versions; the lockfile pins transitives.
- Run `npm audit --production` / `pip-audit` / `cargo audit` / `govulncheck` on every PR.
- Treat CRITICAL or HIGH CVEs on runtime deps as release blockers.
- Track abandoned / deprecated packages — silent supply-chain risks.
- Ship a CycloneDX or SPDX SBOM with every binary release.

## Patterns
- **Pre-commit hook** running a fast audit with cached results.
- **Weekly CI job** with deep scan (Snyk, Trivy, Grype).
- **Dependabot / Renovate** for auto-PR patch upgrades.
- **License allow-list** (MIT, Apache-2.0, BSD, ISC); block strong copyleft unless project is compatible.
- **Vendoring** critical deps for reproducible, offline builds.

## Example
```bash
# Generate SBOM and fail build on HIGH+ severity.
npx @cyclonedx/cyclonedx-npm --output-file sbom.json
npx grype sbom:sbom.json --fail-on high
```

## Checklist
- [ ] No HIGH/CRITICAL CVEs on runtime deps.
- [ ] Lockfile committed and is the source of truth.
- [ ] SBOM generated and attached to each release.
- [ ] License report reviewed; no incompatible copyleft.
- [ ] Abandoned packages flagged and tracked (last commit > 18 months).

## Common Pitfalls
- **Running audit locally only** misses prod-only deps.
- **Ignoring transitive advisories** because the direct dep is fine.
- **"No known fix"** advisories still need mitigations (isolation, patching).
- **License ambiguity** (UNLICENSED, custom, proprietary) slipping through.
- **Pinning to `latest`** in Docker images — non-reproducible rebuilds.
