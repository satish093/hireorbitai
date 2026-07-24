# Security policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems. Instead:

1. Open a private advisory on this repo's GitHub Security tab, **or**
2. Email the maintainers at `security@hireorbitai.com` with `[SECURITY]` in the subject.

Include:

- A description of the issue and the impact you've established
- Steps to reproduce (or a proof of concept)
- The commit SHA or deployed URL where you observed it
- Whether you'd like credit in the fix announcement

We aim to acknowledge reports within **3 business days** and ship a fix or mitigation within **14 days** for high-severity issues. We'll keep you posted as the fix progresses and credit you in the release notes unless you'd rather stay anonymous.

## What's in scope

- The `hireorbitai` codebase (this repo)
- The production deployment at `hireorbitai.com` and `api.hireorbitai.com`
- Authentication, session handling, rate limiting, authorization bypasses
- Stored XSS, CSRF, SQL injection, SSRF, IDOR
- Secret exposure (server-side or client-side)

## Out of scope

- Vulnerabilities in third-party services (Brevo, Anthropic) — report those upstream
- Social engineering of staff or users
- DDoS / volumetric attacks
- Issues requiring physical access to a user's device
- Self-XSS, missing security headers without an exploitable impact, clickjacking on pages with no sensitive actions

## Supported versions

Only `main` is supported with security fixes. We don't backport to older tags.

## Disclosure

We follow coordinated disclosure: please give us a reasonable window (typically 90 days, less for critical issues already being exploited) before publishing details. Once a fix is deployed, we'll publish an advisory crediting the reporter.
