# Grok (xAI) Subprocessor & Data Governance

**Document owner:** Merlinus Engineering  
**Version:** 1.0  
**Last updated:** July 2026  
**Classification:** External — suitable for OEM legal, privacy, and security review  
**Subprocessor:** [xAI Grok API](https://docs.x.ai/) (`api.x.ai`)

---

## 1. Executive summary

Merlinus uses xAI Grok as a **server-side inference subprocessor** for vision extraction, warranty story generation, and story quality scoring. Customer and vehicle data **never** flows to Grok from the browser. All calls originate from authenticated Next.js API routes using a **server-only** `GROK_API_KEY`.

Merlinus applies layered controls:

- **Access control** — Grok routes require technician/manager session, consent, legal disclaimer, rate limits, and daily usage caps.
- **Storage minimization** — Grok responses are parsed into structured fields; raw model output is not persisted. Durable audit logs store **hashes and counts only**, not story text, VIN, or customer names.
- **Encryption at rest** — Parsed RO and story content is encrypted with AES-256-GCM before database persistence.
- **Fail-closed audit** — AI write paths (`story.generate`, `story.score`, `story.review`, `ro.extract`) are **critical audit actions**; if the hash-chained audit write fails, the operation aborts.

This document describes **what** is sent to Grok, **what is not** sent, **how** data is minimized, and **which** governance controls apply.

---

## 2. Subprocessor inventory

| Subprocessor | Purpose | Data categories | Region / hosting |
|--------------|---------|-----------------|------------------|
| **xAI Grok API** | RO vision OCR/extraction, warranty story generation, MI quality scoring/review | Repair order images (base64), structured technician notes, complaint text, diagnostic codes, generated story text | xAI infrastructure (see xAI DPA / SOC documentation) |
| **Vercel Blob** (related) | Private RO image storage before Grok vision | Binary image files | Vercel-configured region |
| **Sentry** (related) | Error monitoring | Redacted error metadata; Grok API keys and story bodies are stripped | Sentry cloud |

**Merlinus does not** expose `GROK_API_KEY` to the client. Build-time validation **fails** if `NEXT_PUBLIC_GROK_API_KEY` or similar client-exposed variants are present.

---

## 3. Grok API usage by workflow

### 3.1 Repair order scan (`ro.extract`)

| Attribute | Detail |
|-----------|--------|
| **Route** | `POST /api/repair-orders/extract` |
| **Model** | `grok-4.3` (`GROK_CHAT_MODEL`) |
| **Input** | RO image(s) as base64 data URLs (downscaled server-side via Sharp before encoding) + static extraction prompt |
| **Output** | Structured text parsed locally into RO number, vehicle fields, complaints (no raw Grok response stored) |
| **Audit** | Critical `ro.extract` hash-chained audit entry with **zero PII** (page count, duration, model, confidence signals) |

**Pre-Grok gates:** Technician authentication, image upload audit trail (`image.upload`), pathname access verification, service advisor AI block, rate limit, maintenance mode.

### 3.2 Warranty story generation (`story.generate`)

| Attribute | Detail |
|-----------|--------|
| **Route** | `POST .../generate-story` |
| **Model** | `grok-4.20-0309-non-reasoning` (configurable via `GROK_STORY_MODEL`) |
| **Input** | System prompt (Merlin MI 2.0 instructions) + user message with line context |
| **Output** | Warranty narrative text; CDK-sanitized server-side before persistence |
| **Audit** | Critical `story.generate` with `promptVersion` fingerprint hashes (not raw prompts) |

**User message fields sent to Grok (truncated):**

| Field | Max length | Notes |
|-------|------------|-------|
| Line description / concern | 350 chars | Technician-entered |
| Technician notes | 800 chars | Marked "untrusted source data" in prompt |
| RO complaints (up to 3) | Combined | Marked "untrusted source data" |
| Diagnostic codes / measurements | From structured extraction | No raw Xentry screenshots |
| Line OCR snippets | 400 chars | Optional |
| Vehicle year/make/model, mileage | Short string | No customer name in generation prompt |
| RO number | Included | Operational identifier |

**Explicitly excluded from generation prompt:** Customer name, service advisor writing profiles, advisor intelligence profiles, knowledge base full text bodies.

### 3.3 Story quality scoring (`story.score`)

| Attribute | Detail |
|-----------|--------|
| **Route** | `POST .../score-story` |
| **Model** | `GROK_STORY_MODEL` |
| **Input** | Compact MI scoring system prompt + line context + **full warranty story text** |
| **Output** | JSON quality score (numeric score, grade, coaching arrays) |
| **Audit** | Critical `story.score` with `storyHash` binding (hash of story text, not the text itself) |

### 3.4 Story coaching review (`story.review`)

| Attribute | Detail |
|-----------|--------|
| **Route** | `POST .../review-story` |
| **Model** | `GROK_STORY_MODEL` |
| **Input** | Review system prompt + line context + **full warranty story text** |
| **Output** | JSON review with structured feedback |
| **Audit** | Critical `story.review` with `storyHash` binding |

### 3.5 Diagnostic image extraction (`diagnostics.extract`)

| Attribute | Detail |
|-----------|--------|
| **Route** | `POST /api/diagnostics/extract` |
| **Model** | `Grok chat` default |
| **Input** | Xentry/diagnostic screenshot + extraction prompt |
| **Output** | Structured fault codes, measurements (parsed JSON) |

---

## 4. Data minimization & redaction

### 4.1 Before data leaves Merlinus

| Control | Implementation |
|---------|----------------|
| Server-only API key | `src/lib/grokApiKey.ts` — never bundled to client |
| Image downscaling | Sharp resize to 1280px JPEG before base64 vision upload |
| Prompt field truncation | `PROMPT_FIELD_LIMITS` caps OCR, notes, concern lengths |
| Private blob access | Images fetched server-side from Vercel Blob; not public URLs |
| Advisor intelligence exclusion | Story generation audit records `advisorIntelligenceUsed: false` |
| Untrusted source labeling | Complaints and notes wrapped in `<<<RO_COMPLAINTS>>>` / `<<<TECHNICIAN_NOTES>>>` delimiters with explicit untrusted marking |

### 4.2 What is never sent to Grok

- User passwords or session tokens
- Full audit log history
- Other dealerships' data (tenant-scoped session)
- Customer Pay template library full text (Customer Pay bypasses Grok)
- Manager usage analytics or technician PII beyond what appears in RO line context

### 4.3 What is never stored in audit logs

Per `src/lib/auditMetadataSanitize.ts`, durable audit metadata **blocks**:

- Customer name, VIN, warranty story text, technician notes
- Passwords, raw filenames with PII

Audit logs store instead: `storyHash`, `promptVersion`, prompt fingerprint hashes, counts, scores, operational IDs.

### 4.4 `ro.extract` audit (scan provenance)

After successful extraction, Merlinus writes a **critical** `ro.extract` audit entry containing only:

- `pageCount`, `durationMs`, `model`, `extractionSource`
- `extractionStrength` (`strong` | `partial` | `weak`)
- `complaintCount`, `complaintLabelCount`
- Boolean flags: `hasRoNumber`, `hasVin17`, `hasVehicleIdentity`
- `pathnameDigest` (SHA-256 prefix, not raw pathnames)
- `success: true`

**No** customer name, VIN, complaint text, or image content in audit metadata.

---

## 5. Data flow diagram

```
Technician browser
    │  (session cookie only — no Grok key)
    ▼
Merlinus API route (withAuth)
    │  consent / disclaimer / rate limit / usage cap
    ▼
Server-side preprocessing (truncate, downscale, encrypt-at-rest path)
    │
    ├──► Vercel Blob (private image read) ──► base64 vision payload
    │
    └──► xAI Grok API (HTTPS, Bearer GROK_API_KEY)
              │
              ▼
         Parse response locally (no raw Grok body persisted)
              │
              ▼
         AES-256-GCM encrypt → PostgreSQL
              │
              ▼
         Hash-chained audit log (metadata sanitized)
```

---

## 6. Governance controls

### 6.1 Technical controls

| Control | Status |
|---------|--------|
| Authentication required on all Grok routes | Enforced |
| Service advisor blocked from AI routes | Enforced |
| Distributed rate limiting (production KV) | Enforced — fail-closed if KV missing in production build |
| Daily AI usage cap per technician (default 50) | Enforced |
| Maintenance mode kill-switch | Enforced |
| Atomic AI writes (audit + DB in single transaction) | Enforced for generate/score/review |
| Certification TOCTOU protection (`SELECT FOR UPDATE`) | Enforced |
| Critical audit fail-closed | Enforced |
| JWT session refresh on compliance drift | Enforced |

### 6.2 Operational controls

| Control | Recommendation |
|---------|----------------|
| Grok API key rotation | Rotate `GROK_API_KEY` on technician offboarding or suspected compromise |
| Subprocessor DPA | Execute xAI Data Processing Agreement before production pilot |
| Retention | xAI API retention governed by xAI terms — confirm zero-retention / enterprise terms for OEM |
| Incident response | Revoke API key, enable maintenance mode, review audit chain |
| Go-live password gate | `/api/auth/security-status` blocks deployment with default seed passwords |

### 6.3 Planned enhancements (roadmap)

| Item | Target |
|------|--------|
| Customer name redaction before Grok story prompts | Phase 2 |
| Grok payload logging with hashed inputs only (debug tier) | Phase 2 |
| Enterprise xAI contract with data residency options | Phase 2 |
| Alternative on-prem OCR for RO scan (Grok optional) | Phase 3 |

---

## 7. Compliance mapping

| Requirement | Merlinus control |
|-------------|------------------|
| **Audit trail for AI-assisted warranty work** | Hash-chained `AuditLog` with `promptVersion`, `storyHash`, critical-action fail-closed |
| **Technician attestation** | Certification gate requires generate → score → certify with matching hashes |
| **Data minimization (GDPR Art. 5)** | Truncation, sanitization, no raw Grok response storage, PII encryption at rest |
| **Subprocessor transparency (GDPR Art. 28)** | This document + xAI DPA |
| **Access control** | Session-based RBAC, tenant isolation, image access audit grant |
| **Integrity** | Atomic transactions, row locks on certification, advisory locks on audit chain |

---

## 8. Contact & review

For Mercedes-Benz legal, privacy, or security questions regarding Grok data processing:

1. Request the executed **xAI DPA** and latest **xAI security whitepaper**.
2. Review Merlinus **pre-rollout validation** output (`npm run validate:pre-rollout`).
3. Inspect sample **audit log exports** (metadata only — no story bodies) via manager audit dashboard.

**Document revision history**

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | July 2026 | Initial subprocessor governance document; atomic AI writes; `ro.extract` critical audit; certification row lock |