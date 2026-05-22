# Security scanning

Layered, low-cost checks. The first three run automatically; ZAP is opt-in.

## 1. Static pattern guard (automatic — part of `npm run verify`)

`backend/src/security/patterns.test.ts` is an executable form of
`.claude/rules/security.md`. It scans every controller and fails the build on a
**new** mass-assignment (`db.update/insert(req.body)` without a `.strict()` Zod
gate) or an `.ilike('email', ...)` lookup. Known pre-existing offenders are
baselined so the ratchet only blocks fresh regressions — see the `BASELINE`
maps in that file.

## 2. IDOR / authorization audit (on demand)

- Slash command: `/audit-controllers` — sweeps controllers for the patterns the
  prior security review fixed (mass-assignment, missing ownership checks,
  missing role gates, email `.ilike`, PostgREST `.or()` injection).
- Skill: `idor-audit` (auto-invokes when a new controller is added).
- Subagent: `controller-auditor` for a parallel, isolated pass.

## 3. Dependency audit (automatic — CI)

`.github/workflows/ci.yml` runs `npm audit --audit-level=high --omit=dev`.

## 4. OWASP ZAP baseline (opt-in, needs Docker + a running target)

Passive scan for missing security headers, cookie flags, and info leaks. Not in
`verify`/CI by design.

```powershell
# Local dev server (start it first: npm --prefix frontend run dev)
pwsh scripts/zap-baseline.ps1 -Target http://localhost:5173

# Staging (safe — passive only). Never point at production without authorization.
pwsh scripts/zap-baseline.ps1 -Target https://staging.hireorbitai.com
```

Reports land in `./zap-report/zap-baseline-report.html` (gitignored).

### Gaps

- ZAP baseline is **passive** — it does not fuzz auth/IDOR. The Vitest +
  pattern-guard layer is the active authorization check.
- There is no OpenAPI/Swagger spec in the repo, so automated API-spec scanning
  (schema-aware fuzzing) is not wired up. If a spec is added later, ZAP's
  `zap-api-scan.py` can consume it.
