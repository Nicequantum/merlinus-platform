# Merlinus — Compliance, Security, Audit & Legal

**Version:** 3.0.0  
**Audience:** Legal counsel, privacy officers, OEM security review, franchise compliance  
**Classification:** External — suitable for due diligence and security questionnaires

---

## 1. Executive summary

Merlinus implements defense-in-depth controls for Mercedes-Benz dealership environments handling customer PII, vehicle identifiers, diagnostic evidence, and warranty narratives. Sensitive data is encrypted at rest, AI inference is server-side only, and every material AI action produces a tamper-evident audit record suitable for OEM review and internal compliance.

---

## 2. Security control matrix

| Control | Implementation |
|---------|----------------|
| **Encryption at rest** | AES-256-GCM on customer name, VIN, complaints, technician notes, OCR text, diagnostic data, and warranty stories |
| **Search tokenization** | HMAC blind-index tokens for RO number search — separate key from encryption key |
| **Audit integrity** | Append-only SHA-256 hash chain per dealership; `promptVersion` stamped on every AI entry |
| **Session security** | JWT with server-side revocation on password change, deactivation, or logout |
| **Image access** | Private Vercel Blob storage; session-gated `/api/images` proxy with exact pathname verification |
| **AI safety** | Prompts use `[NOT DOCUMENTED]` / `[NOT PROVIDED]` — no fabricated test data |
| **Rate limiting** | Per-IP limits on all routes; Grok routes capped at 20/min + configurable daily AI cap per technician |
| **Distributed limits** | Vercel KV / Upstash Redis required in production for cross-instance rate limiting |
| **CSP & headers** | Content-Security-Policy, HSTS, frame denial, Permissions-Policy for microphone |
| **Request limits** | Bounded JSON bodies (1–2 MB) with Zod validation and sanitization on POST routes |
| **Maintenance mode** | `MERLIN_MAINTENANCE_MODE=true` blocks AI routes with technician-friendly banner |
| **Error monitoring** | Sentry integration; API keys and story bodies stripped from telemetry |
| **Bootstrap kill-switch** | Database seed endpoint hard-blocked in production runtime |

---

## 3. Audit trail specification

### 3.1 Hash chain

Each audit entry includes:

- Timestamp, actor (technician ID), action type, entity reference
- `promptVersion` on AI-related actions (warranty path only)
- SHA-256 hash of entry payload chained to previous entry hash
- Tamper detection: modified `promptVersion` or payload breaks chain verification

### 3.2 Critical audit actions (fail-closed)

If audit write fails, the operation aborts — no silent AI persistence:

| Action | Scope |
|--------|-------|
| `story.generate` | Warranty narrative generation |
| `story.score` | MI quality scoring |
| `story.review` | Story review pass |
| `story.edit` | Post-generation edits |
| `ro.extract` | RO vision extraction |
| `diagnostics.extract` | Xentry vision extraction |

### 3.3 Customer Pay audit separation

Customer Pay template application uses `customerPayTemplateApplied` with a compliance sentinel — **not** Merlin `promptVersion`. This preserves audit integrity without falsely attributing AI prompt versions to pre-written templates.

---

## 4. PII handling

| Field category | At-rest treatment | In transit |
|----------------|-------------------|------------|
| Customer name, VIN | AES-256-GCM encrypted columns | HTTPS/TLS 1.2+ |
| Complaints, notes, stories | AES-256-GCM encrypted columns | HTTPS |
| RO search | HMAC blind-index tokens only | HTTPS |
| Diagnostic images | Private blob storage | HTTPS via authenticated proxy |
| Grok API payloads | Transient server memory; not persisted raw | HTTPS to `api.x.ai` |

**Phase 5 (current):** Plaintext PII columns dropped; encrypted-only writes enforced at mapper layer with automated pre-deploy guards.

Legacy plaintext rows migrate via `npm run db:reencrypt` and `npm run db:migrate-pii` (dry-run first).

---

## 5. Authentication & access control

| Control | Detail |
|---------|--------|
| **Login** | D7 number + bcrypt password; rate-limited |
| **Roles** | Manager (admin capabilities) and Technician |
| **Session revocation** | `sessionVersion` increment on password change, deactivation, logout |
| **Route protection** | 46 API routes audited — all require authenticated session |
| **Compliance gating** | Privacy consent and legal disclaimer required before AI routes |
| **Manager-only endpoints** | Security status, usage dashboard, audit log export |

### Residual risks (documented)

| Risk | Compensating controls |
|------|----------------------|
| **SSO (SAML/OIDC) roadmap** | Native TOTP MFA for manager/owner; D7+password, bcrypt, session revocation, login rate limits |
| **Encryption key rotation ops** | Dual-key `DATA_ENCRYPTION_KEY` + `DATA_ENCRYPTION_KEY_PREVIOUS`; Manager UI + background re-encrypt; [Reencryption Runbook](./Reencryption-Runbook.md) |

---

## 6. AI subprocessor governance

Merlinus uses **xAI Grok** as a server-side inference subprocessor. Full data flow documentation:

**[Grok Subprocessor & Data Governance](./GROK-SUBPROCESSOR.md)**

### Production requirements

| Requirement | Status |
|-------------|--------|
| Signed **xAI Data Processing Agreement** before processing real customer/vehicle data | Required |
| `GROK_API_KEY` server-only (no client exposure) | Enforced at build time |
| Daily usage caps and per-IP rate limits | Configurable via environment |
| Audit fail-closed on AI write paths | Enforced in route handlers |

---

## 7. Seed credential security

| Control | Detail |
|---------|--------|
| **No hardcoded passwords** | Seed passwords read from `ADMIN_SEED_PASSWORD` / `TECH_SEED_PASSWORD` environment only |
| **First-login rotation** | Default seed credentials must be rotated via Settings before production go-live |
| **Security status endpoint** | Managers can verify no accounts still match canonical seed password |
| **Seed console output** | `npm run db:seed` does not log plaintext passwords |

---

## 8. Legal & licensing

| Item | Detail |
|------|--------|
| **License** | Proprietary — authorized Mercedes-Benz dealership use only |
| **Distribution** | Not licensed for resale, sublicensing, or non-dealership deployment without written agreement |
| **Data ownership** | Dealership retains ownership of repair order and customer data entered into Merlinus |
| **AI output** | Generated narratives are advisory; technician certification required before DMS submission |
| **OEM relationship** | Merlinus is independent dealership software; not affiliated with or endorsed by Mercedes-Benz AG unless separately contracted |

---

## 9. Compliance verification commands

```bash
# Environment and security key validation
npm run validate:env

# Full pre-rollout suite (code + config separation)
npm run validate:pre-rollout

# Production deploy gate
npm run ready-to-deploy
```

Pre-rollout validation reports **code defects** separately from **configuration/env gaps** so IT teams know whether to fix the repository or Vercel settings.

---

## 10. Related documents

| Document | Purpose |
|----------|---------|
| [Full Enterprise Audit History & Validation](./Full-Enterprise-Audit-History-and-Validation.md) | Complete audit item registry and validation results |
| [Production Readiness Checklist](./Production-Readiness-Checklist.md) | Mandatory sign-off before tablet fleet deployment |
| [Reencryption Runbook](./Reencryption-Runbook.md) | Key rotation and legacy data migration |