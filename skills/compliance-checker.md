---
name: compliance-checker
description: GDPR, SOC 2, HIPAA, PCI-DSS verification for WOTANN user data flows
context: fork
paths: []
---

# Compliance Checker

## When to Use

- Auditing WOTANN Memory (SQLite + FTS5) for personal data under GDPR.
- Reviewing the Bridge payload schema for PII before logging enters the Engine daemon.
- Preparing a SOC 2 evidence package for a customer security review.
- Implementing deletion and export endpoints for a right-to-erasure request.
- Verifying encryption at rest (`~/.wotann/`) and in transit (Bridge TLS).

## Rules

- Never log PII (email, tokens, user prompts) outside encrypted Memory.
- Data minimization: each field collected must be justified in `privacy.md`.
- Consent timestamps stored alongside every record that requires opt-in.
- Cryptographic keys rotated on a documented schedule; rotation automated.
- Every third-party data processor enumerated in `privacy/processors.md`.
- Deletion flows are irreversible and must cascade to backups within SLA.

## Patterns

- **GDPR**: data minimization, right to erasure, portability (JSON export), consent logs.
- **SOC 2**: least-privilege IAM, audit logging, change management, incident response.
- **HIPAA**: BAAs with any processor touching PHI, encryption at rest and in transit.
- **PCI-DSS**: never store PAN; tokenize via Stripe/Adyen; segment card-data environment.
- **Retention**: explicit TTLs on every data category; automated purge jobs.

## Example

```
Compliance audit: WOTANN 1.2 - 2026-04-13

GDPR:
  [PASS]  Memory DB encrypted at rest (AES-256-GCM, key in Keychain).
  [PASS]  'wotann memory export --user' produces JSON + cryptographic hash.
  [FAIL]  Deletion does not cascade to shadow-git snapshots. Fix: purge shadow refs.
SOC 2 CC6.1:
  [PASS]  Audit log written to append-only SQLite with hash chain.
  [WARN]  Hook events lack operator identity when run non-interactively.
PCI-DSS:
  [N/A]   No card data handled; Stripe Elements isolates PAN.
```

## Checklist

- [ ] All PII-bearing fields have a justification in `privacy.md`.
- [ ] Deletion cascades to backups/shadows within documented SLA.
- [ ] Audit log is append-only and tamper-evident.
- [ ] Third-party processors enumerated and DPAs signed.

## Common Pitfalls

- Encrypting the main DB but leaving swap/journal files plaintext on disk.
- Forgetting shadow-git history; deleted data persists in snapshots.
- Logging full prompts to stdout for "debugging"; stdout often lands in analytics.
