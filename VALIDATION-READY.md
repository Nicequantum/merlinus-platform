# Merlinus v3.0.0 — Validation Ready

**Date:** 2026-07-02  
**Status:** FINAL READY FOR VALIDATION  
**Prompt version:** 3.0.0

---

## Summary

Merlinus v3.0.0 completes the shop-floor release and pre-validation polish pass. The codebase is clean; staging configuration and shop-floor smoke tests are the remaining gate before go-live.

---

## Verification (final run)

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS — zero errors |
| `npm run lint` | PASS — exit 0 (14 pre-existing intentional warnings) |
| `npm test` | PASS — **401/401** unit tests |
| `npm run validate:pre-rollout` | **Code: PASS** · Config: 6 gaps without `.env.local` (expected) |

### Pre-rollout verdict (local)

```
✔ Code checks passed — no critical repository defects.
✖ CONFIG INCOMPLETE — 6 critical env/deployment gap(s).
```

All six config failures resolve once Vercel/staging environment variables are set.

---

## What shipped in v3.0.0

- Technician docs updated for current UI: **Generate MI 4.3**, **Diagnostic Evidence**, **Audit Story**, certification flow
- 7 SVG wireframe screenshots in `docs/images/` (replace with dealership captures before print)
- Pre-rollout validation separates **code** vs **config/env** failures in summary
- Phase 1 accepted risks documented in code (SSO/MFA, key rotation)
- README Vercel KV setup section
- Full audit hardening cycle (C1–C7, H1–H15, M1–M30, L1–L5) verified

See [CHANGELOG.md](./CHANGELOG.md) for full release notes.

---

## Phase 1 accepted risks (documented — do not block pilot)

| Risk | Location | Mitigation |
|------|----------|------------|
| **SSO / MFA not implemented** | `src/lib/auth.ts` | D7+password, bcrypt, session revocation, rate-limited login |
| **Manual key rotation only** | `src/lib/encryption.ts`, `scripts/reencrypt-legacy-data.ts` | Maintenance-window `npm run db:reencrypt`; see `docs/Reencryption-Runbook.md` |

---

## Tomorrow's validation checklist

### IT — before tablets (required)

1. Confirm all Vercel Production variables from `.env.example`:
   - `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`
   - `DATA_ENCRYPTION_KEY`, `SEARCH_HMAC_KEY`
   - `GROK_API_KEY`, `BLOB_READ_WRITE_TOKEN`
   - `KV_REST_API_URL`, `KV_REST_API_TOKEN`
2. Create and connect **Vercel KV** (README → Vercel KV setup)
3. Run pre-rollout against staging:
   ```bash
   MERLIN_BASE_URL=https://your-staging-url npm run validate:pre-rollout
   ```
   Target: **0 critical code failures** + **0 critical config failures**
4. Rotate seed passwords via Settings (not `.env.example` defaults)
5. Confirm xAI Data Processing Agreement is signed before real PII

### Shop-floor smoke tests

1. Login → open RO → open repair line
2. Voice: tap-toggle + push-to-talk on Technician notes
3. **Diagnostic Evidence**: queue photos → **Process images** → **Cancel** mid-batch (queue clears)
4. **Generate MI 4.3** → **Audit Story** → edit → certify → **Copy for CDK** → **Export PDF**
5. Customer Pay line: template apply (no AI) → copy to CDK
6. Disable Wi‑Fi: manual typing works; offline banner appears

### Optional before print distribution

- Replace SVG wireframes in `docs/images/` with redacted dealership tablet captures
- Laminate updated [Bay Reference Cards](./docs/Bay-Reference-Card.md)

---

## Key documents

| Audience | Document |
|----------|----------|
| Technicians | [Technician Quick Start](./docs/Technician-Quick-Start.md) · [Bay Reference Card](./docs/Bay-Reference-Card.md) |
| IT | [Admin Setup Guide](./docs/Admin-Setup-Guide.md) · [.env.example](./.env.example) |
| Leadership | [Production Readiness Checklist](./docs/Production-Readiness-Checklist.md) · [Go-Live Checklist](./docs/Go-Live-Checklist.md) |

---

## Stamp

```
╔══════════════════════════════════════════════════════╗
║     FINAL READY FOR VALIDATION                       ║
║     Merlinus v3.0.0 · Prompt v3.0.0                  ║
║     Code: clean · Tests: 401/401 · Docs: current     ║
╚══════════════════════════════════════════════════════╝
```

*Authorized Mercedes-Benz dealership use only.*