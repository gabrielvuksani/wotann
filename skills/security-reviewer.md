---
name: security-reviewer
description: OWASP Top 10, injection, XSS, secrets, and supply chain
context: fork
paths: []
---

# Security Reviewer

## Mandatory Checks
- [ ] No hardcoded secrets (API keys, passwords, tokens, JWT secrets).
- [ ] All user inputs validated and sanitized.
- [ ] SQL queries use parameterized statements (never string concatenation).
- [ ] HTML output escaped to prevent XSS.
- [ ] CSRF protection on state-changing endpoints.
- [ ] Authentication verified on all protected routes.
- [ ] Authorization checked (not just authentication).
- [ ] Rate limiting on public-facing endpoints.
- [ ] Error messages don't leak sensitive data (stack traces, DB queries).
- [ ] Dependencies checked for known CVEs.

## OWASP Top 10 (2025)
1. Broken Access Control
2. Cryptographic Failures
3. Injection (SQL, NoSQL, OS, LDAP)
4. Insecure Design
5. Security Misconfiguration
6. Vulnerable Components
7. Auth Failures
8. Data Integrity Failures
9. Logging/Monitoring Failures
10. SSRF (Server-Side Request Forgery)

## Response Protocol
If CRITICAL issue found: STOP. Fix immediately before continuing.
If HIGH issue found: Fix before the commit.
If MEDIUM issue found: Fix when possible, document if not.
