# Merlin — Master Rollout Document

---

## Cover

| | |
|---|---|
| **Document title** | Merlin Master Rollout Document |
| **Product** | Merlin — Mercedes-Benz Warranty Story Generator |
| **Version** | 3.0.1 |
| **Document date** | [DOCUMENT DATE] |
| **Dealership** | [DEALERSHIP NAME] |
| **Dealer group** | [DEALER GROUP NAME — if applicable] |
| **Go-live target** | [GO-LIVE DATE] |
| **Prepared by** | [FIXED OPS DIRECTOR / SERVICE MANAGER NAME] |
| **Distribution** | General Manager · Fixed Ops Director · Service Manager · Dealership IT |

### Document purpose

This is the **single authoritative overview** for rolling out Merlin at [DEALERSHIP NAME]. It gives dealership leadership everything needed to approve, plan, and execute a successful launch — without reading the full technical library.

**Audience:** Fixed Ops Directors, Service Managers, General Managers, and dealer group leadership.  
**Reading time:** Under 10 minutes.  
**Supporting detail:** Linked at the end of this document and in the [README](../README.md#documentation-library).

---

## Table of contents

1. [Executive Summary](#1-executive-summary)
2. [What is Merlin?](#2-what-is-merlin)
3. [Key Benefits](#3-key-benefits)
4. [Core Features](#4-core-features)
5. [Why Voice Input Matters](#5-why-voice-input-matters)
6. [Rollout Timeline](#6-rollout-timeline)
7. [Training & Support](#7-training--support)
8. [Technical Readiness](#8-technical-readiness)
9. [Go-Live Checklist](#9-go-live-checklist)
10. [Success Metrics](#10-success-metrics)
11. [Next Steps](#11-next-steps)
12. [Supporting Documents](#supporting-documents)
13. [Document History](#document-history)

---

## 1. Executive Summary

Merlin gives Mercedes-Benz service technicians a faster, more consistent way to produce warranty stories — without sacrificing accuracy or accountability. Technicians document real findings at the vehicle using **hands-free voice input** on shop-floor tablets; Merlin turns those notes into professional, MI 2.0–ready narratives for CDK and warranty submission. Leadership gains structured story quality, a tamper-evident audit trail, and measurable productivity gains. Based on comparable dealership deployments, we expect a **30–50% reduction** in time from job completion to story submission within 90 days, alongside fewer chargebacks driven by missing test steps or unclear Cause and Correction language. Merlin strengthens technician judgment — it does not replace it.

---

## 2. What is Merlin?

**Merlin** is a secure, dealership-specific warranty documentation platform built for the Mercedes-Benz service bay.

| Question | Answer |
|----------|--------|
| **Who uses it?** | Service technicians daily; service managers for oversight and audit |
| **Where does it run?** | Shop-floor tablets (Chrome or Edge) — cloud-hosted, no install on devices |
| **What problem does it solve?** | Technicians spend too much time typing warranty stories; quality varies by person |
| **How does it work?** | Technicians capture findings (voice or keyboard) → Merlin drafts the story → technician reviews and submits |

Merlin follows the **3 C's** — Complaint, Cause, and Correction. The technician owns accuracy. AI formats documented work; it **never invents** test results that were not recorded.

**Merlin URL:** [MERLIN URL]

---

## 3. Key Benefits

### Time savings
- **Speak notes at the vehicle** — capture findings during the repair, not at the end of the shift
- **One-tap story generation** — draft a full narrative in seconds after notes are complete
- **Copy for CDK** — formatted paste-ready text reduces DMS reformatting

### Story quality
- **Consistent structure** — every story follows Complaint–Cause–Correction logic
- **MI 2.0 alignment** — AI prompts tuned for Mercedes-Benz warranty standards
- **Review with AI** — optional quality check before submission on complex jobs
- **Template library** — dealership can build and reuse proven story patterns

### Compliance and accountability
- **Tamper-evident audit trail** — every generation and export is logged with hash-chain integrity
- **Encrypted customer data** — names, VINs, notes, and stories protected at rest
- **No fabricated tests** — undocumented work is explicitly marked, not guessed
- **Role-based access** — managers see audit and usage; technicians see their work

---

## 4. Core Features

### Voice input
- **Tap to toggle** — tap mic to start, tap again to stop (default for longer notes)
- **Push-to-talk** — hold mic while speaking (best in noisy bays)
- **Manual typing on every field** — voice is optional; repairs are never blocked

### AI story generation
- Grok AI produces a warranty narrative from technician notes and RO context
- Technician **reads, edits, and approves** every story before CDK paste
- **Regenerate** when notes change significantly
- Rate limits protect against abuse (20 AI calls/min per IP; daily caps per technician)

### PDF export
- Branded, professional PDF for records or submission workflows
- Includes audit metadata when available
- Works on tablet after story review

### Audit trail
- Append-only log of story generation, review, and PDF export events
- SHA-256 hash chain per dealership — tampering is detectable
- Service managers can verify integrity before warranty audits

---

## 5. Why Voice Input Matters

The service bay is not a quiet office. Lifts run, air tools fire, compressors cycle, and technicians wear gloves. Keyboards and touch typing slow down the people who actually perform the work.

**Merlin was built for this reality.**

| Shop floor challenge | How Merlin responds |
|---------------------|---------------------|
| Greasy hands, no time to type | Speak notes while working on the vehicle |
| Loud background noise | Push-to-talk mode; noise meter; adaptive confidence thresholds |
| Intermittent silence while thinking | Auto-restart and 15-second timeout with one-tap Retry |
| Tablet speakers and bay echo | Echo cancellation and noise suppression requested from the browser |
| Voice fails on one job | Manual typing always available — fix the car first |

Voice is the **primary daily benefit** for technicians. It is also why Merlin requires **Chrome or Edge** on rugged tablets with microphone permission — the same devices most dealerships already use in the bay.

**Leadership message for technicians:** *"Talk your findings. Merlin writes the draft. You approve the story."*

---

## 6. Rollout Timeline

```
  PREPARE          TRAIN           LAUNCH          STABILIZE         MEASURE
  T−14 to T−7      T−5 to T−1      GO-LIVE         T+1 to T+5        T+30 / 60 / 90
      │                │               │                │                  │
      ▼                ▼               ▼                ▼                  ▼
  IT setup         Email team      Hands-on         Floor support      Adoption &
  Validation       Schedule        training         First 3 stories    quality review
  Tablet prep      Go/no-go        Live use         Health monitor     GM briefing
```

### Phase summary

| Phase | Timing | Owner | Key outcomes |
|-------|--------|-------|--------------|
| **Preparation** | T−14 to T−7 | IT + SM | Environment live, validation passed, tablets ready |
| **Communication & go/no-go** | T−5 to T−1 | SM + FO | Team notified, training scheduled, final sign-off |
| **Go-live** | [GO-LIVE DATE] | SM + Trainer | Training delivered, first live stories reviewed |
| **Stabilization** | T+1 to T+5 | SM + IT | Support playbook active, issues logged and resolved |
| **Measurement** | T+30 / 60 / 90 | FO + SM | Adoption, quality, and productivity vs. baseline |

*Detailed checklists: [Rollout Checklist](./Rollout-Checklist.md) · [Go-Live Checklist](./Go-Live-Checklist.md)*

---

## 7. Training & Support

### What training is provided

| Deliverable | Format | Duration | Audience |
|-------------|--------|----------|----------|
| Hands-on training session | Bay tablets, live exercises | 30–45 minutes | All warranty technicians |
| [Technician Quick Start](./Technician-Quick-Start.md) | Print or digital | Self-serve | Every technician |
| [Bay Reference Card](./Bay-Reference-Card.md) | Laminated double-sided card | At-a-glance | Every bay tablet |
| [Training Outline](./Training-Outline.md) | Trainer script | Session plan | Lead tech / trainer |

**Training covers:** voice modes, note documentation, story generation, edit and review, CDK copy, PDF export, and manual fallback.

**Make-up sessions** required for any technician who misses go-live training before using Merlin on live ROs.

### How technicians are supported

| Tier | Contact | Handles |
|------|---------|---------|
| **Tier 1** | [SERVICE MANAGER NAME] · [SM PHONE] | How-to, story edits, process |
| **Tier 2** | [IT CONTACT NAME] · [IT PHONE] | Login, tablets, Wi‑Fi, system health |
| **Tier 3** | [FIXED OPS DIRECTOR NAME] · [FO PHONE] | Escalation, rollback decisions |

**Go-live week:** Floor support on site [GO-LIVE DATE] until [END TIME].  
**Full playbook:** [Support Playbook](./Support-Playbook.md)

**Rule for the bay:** Never delay a customer repair for Merlin. Type notes and continue the job.

---

## 8. Technical Readiness

Merlin is built for production dealership use — not a pilot prototype.

### Security (plain language)

| Protection | What it means for the dealership |
|------------|----------------------------------|
| **Encrypted storage** | Customer names, VINs, and stories are scrambled in the database |
| **Secure login** | Sessions end immediately on password change or deactivation |
| **Private images** | Diagnostic photos are not publicly accessible |
| **Audit integrity** | Story history cannot be silently altered |
| **AI keys server-only** | API credentials never appear on tablets or in browser code |

### Reliability

- Cloud-hosted with health monitoring at `[MERLIN URL]/api/health`
- **Maintenance mode** pauses AI during upgrades without blocking login or manual notes
- Offline banner when Wi‑Fi drops — typing still works; AI resumes when connected

### Validation before launch

Dealership IT runs an automated **pre-rollout validation suite** (`npm run validate:pre-rollout`) that confirms database connectivity, encryption, audit chain, voice configuration, security headers, and route protection. **Zero critical failures** required before go-live.

| Validation | Status | Date |
|------------|--------|------|
| Pre-rollout validation (local) | ☐ Pass ☐ Pending | |
| Pre-rollout validation (live URL) | ☐ Pass ☐ Pending | |
| xAI Data Processing Agreement | ☐ On file ☐ Pending | |
| Audit chain integrity | ☐ Valid ☐ Pending | |

*IT detail: [Admin Setup Guide](./Admin-Setup-Guide.md)*

---

## 9. Go-Live Checklist

High-level gates — all must be **complete** before [GO-LIVE DATE]. Full criteria and signatures: [Go-Live Checklist](./Go-Live-Checklist.md).

### Technical (IT)
- [ ] Production environment deployed and health check passing
- [ ] Pre-rollout validation — 0 critical failures
- [ ] Maintenance mode **off**
- [ ] Bay tablets configured (Chrome/Edge, Merlin bookmark, mic tested)
- [ ] End-to-end smoke test on tablet: notes → generate → copy → PDF

### People (Service Manager + Trainer)
- [ ] Go-live email sent to service team
- [ ] Training completed or make-up scheduled for all warranty technicians
- [ ] [Bay Reference Card](./Bay-Reference-Card.md) laminated at every bay
- [ ] Support contacts posted in service lounge
- [ ] Floor support assigned for go-live day

### Leadership (Fixed Ops + GM)
- [ ] [Go-Live Summary](./Go-Live-Summary.md) reviewed or signed
- [ ] Rollback plan understood
- [ ] First-week adoption target agreed (recommend ≥ 80% of warranty lines by day 5)
- [ ] **Final go / no-go sign-off** recorded

---

## 10. Success Metrics

Define [DEALERSHIP NAME] baselines before go-live. Review at 30, 60, and 90 days with the General Manager and Fixed Ops Director.

### 30 days — adoption and stability

| Metric | Target | Owner |
|--------|--------|-------|
| Active warranty technicians trained | 100% | SM |
| Warranty lines using Merlin for story draft | ≥ 80% | SM |
| Critical system outages during shop hours | 0 | IT |
| Technician satisfaction (informal survey) | ≥ 4/5 | SM |
| Voice working on first attempt (bay spot checks) | ≥ 90% of tablets | TR |

### 60 days — quality and efficiency

| Metric | Target | Owner |
|--------|--------|-------|
| Average time from job complete to CDK paste | −30% vs. baseline | SM |
| Stories returned for rework / unclear Cause | −25% vs. baseline | SM |
| Audit log integrity | Valid — no breaks | IT |
| Template library entries (dealership-specific) | ≥ 5 | SM |

### 90 days — business impact

| Metric | Target | Owner |
|--------|--------|-------|
| Warranty story cycle time | −30–50% vs. baseline | FO |
| Chargeback rate attributable to documentation | Measurable decrease | FO |
| Merlin daily active technicians | Stable or growing | SM |
| ROI narrative for dealer group | Documented case study | FO |

**What "good" looks like:** Technicians speak notes habitually, stories are structurally consistent, managers trust the audit trail, and warranty administrators spend less time sending stories back for rewrite.

---

## 11. Next Steps

| # | Action | Owner | Deadline |
|---|--------|-------|------------|
| 1 | Confirm go-live date and secure GM approval | [FIXED OPS DIRECTOR] | [DATE] |
| 2 | Complete IT setup and pass pre-rollout validation | [IT LEAD] | [DATE — T−7] |
| 3 | Customize and send [Go-Live Email](./Go-Live-Email-Template.md) | [SERVICE MANAGER] | [DATE — T−5] |
| 4 | Schedule and deliver technician training | [TRAINER / SM] | [TRAINING DATE] |
| 5 | Print and laminate [Bay Reference Cards](./Bay-Reference-Card.md) | [SERVICE MANAGER] | [DATE — T−3] |
| 6 | Complete [Go-Live Checklist](./Go-Live-Checklist.md) go/no-go meeting | [FO + IT + SM] | [DATE — T−2] |
| 7 | Execute go-live with floor support | [SERVICE MANAGER] | [GO-LIVE DATE] |
| 8 | Hold 30-day metrics review | [FIXED OPS DIRECTOR] | [GO-LIVE DATE + 30 days] |

**Approval signatures**

| Role | Name | Signature | Date |
|------|------|-----------|------|
| General Manager | | | |
| Fixed Ops Director | | | |
| Service Manager | | | |
| IT Lead | | | |

---

## Supporting documents

Use this master document for strategy and approval. Use the documents below for execution.

| Document | Link | Use when |
|----------|------|----------|
| Go-Live Executive Summary (1 page) | [Go-Live-Summary.md](./Go-Live-Summary.md) | GM approval meeting |
| Admin Setup Guide | [Admin-Setup-Guide.md](./Admin-Setup-Guide.md) | IT provisioning |
| Rollout Checklist | [Rollout-Checklist.md](./Rollout-Checklist.md) | Full phased rollout |
| Go-Live Checklist | [Go-Live-Checklist.md](./Go-Live-Checklist.md) | Final go/no-go |
| Training Outline | [Training-Outline.md](./Training-Outline.md) | Trainer session |
| Go-Live Email Template | [Go-Live-Email-Template.md](./Go-Live-Email-Template.md) | Team announcement |
| Technician Quick Start | [Technician-Quick-Start.md](./Technician-Quick-Start.md) | Technician reference |
| Bay Reference Card | [Bay-Reference-Card.md](./Bay-Reference-Card.md) | Laminated bay cheat sheet |
| Support Playbook | [Support-Playbook.md](./Support-Playbook.md) | Post-launch support |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [DOCUMENT DATE] | [AUTHOR] | Initial master rollout document for [DEALERSHIP NAME] |
| | | | |
| | | | |

---

*Merlin — Mercedes-Benz Warranty Story Generator · Master Rollout Document · Authorized dealership use only*