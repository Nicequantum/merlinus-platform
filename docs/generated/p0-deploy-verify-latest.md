# P0 Deploy Verify — latest run

**Generated:** 2026-08-01T12:37:10.165Z
**Verdict:** `P0_CODE_GATES_PASS`

| Pass | Warn | Fail | Skip | Critical fails |
|------|------|------|------|----------------|
| 10 | 4 | 0 | 1 | 0 |

## Results

| ID | Status | Check | Detail |
|----|--------|-------|--------|
| P0-1 | `pass` | KV binding resolution code | workersKv resolves KV_STORE via getCloudflareContext |
| P0-2a | `pass` | wrangler.toml bindings | KV_STORE=true DB=true APEX_R2=true AI_JOBS_QUEUE=true |
| P0-5a | `pass` | AI queue producer binding | AI_JOBS_QUEUE present in wrangler.toml |
| P0-3 | `pass` | MFA health probe code | Enrollment-aware MFA health + operatorMessage present |
| P0-6a | `pass` | No seed secrets in repo | check:seed-secrets clean |
| P0-T | `pass` | RLS tenant registry | check:rls-registry clean |
| P0-API | `pass` | API default-deny wrappers | check:api-routes clean |
| P0-6-SESSION_SECRET | `warn` | SESSION_SECRET | not set in this environment (ok for code-only P0; required on Worker) |
| P0-6-DATA_ENCRYPTION_KEY | `warn` | DATA_ENCRYPTION_KEY | not set in this environment (ok for code-only P0; required on Worker) |
| P0-6-SEARCH_HMAC_KEY | `warn` | SEARCH_HMAC_KEY | not set in this environment (ok for code-only P0; required on Worker) |
| P0-6-GROK_API_KEY | `warn` | GROK_API_KEY | not set in this environment (ok for code-only P0; required on Worker) |
| P0-6b | `pass` | OWNER_SEED_PASSWORD* absent | not set in this environment |
| P0-DOC | `pass` | Production Attack Plan | docs/PRODUCTION-ATTACK-PLAN.md present |
| P0-MATRIX | `pass` | Capability matrix generate | docs/generated/capability-matrix.json |
| P0-LIVE | `skip` | Live probes | Pass --live with MERLIN_BASE_URL to probe deployment |

## Next ops steps if live not green

1. Redeploy Worker after KV binding code fix.
2. Confirm `wrangler.toml` `KV_STORE` namespace id in Cloudflare dashboard.
3. Enroll managers in MFA Settings; then set `MERLIN_MFA_ENFORCE=true`.
4. Bind AI queue consumer; watch Control Center queueSignal.
5. Remove any `OWNER_SEED_PASSWORD*` from production secrets.

*Re-run: `npm run verify:p0` or `npm run verify:p0 -- --live`*
