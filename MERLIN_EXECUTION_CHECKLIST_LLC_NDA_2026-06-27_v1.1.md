# MERLIN_EXECUTION_CHECKLIST_LLC_NDA_2026-06-27_v1.1.md
**Repo:** https://github.com/Nicequantum/Merlin  
**Classification:** STRICTLY INTERNAL • PROPRIETARY • ATTORNEY-CLIENT PLANNING DOCUMENT • DO NOT SHARE  
**Version:** 1.1 • Date: Saturday, June 27 2026 • Previous: MERLIN_PROJECT_SAFEGUARD_PROTOCOL_AND_LAWYER_BRIEFING_PROMPT.md (commit 12a4ac3)  
**Purpose:** Official next-action playbook for legal separation (LLC) + NDA procurement to protect the production-ready Mercedes-Benz warranty stories application (Merlin).

** MAXIMUM SAFE GUARDRAILS / DISCLAIMERS (READ BEFORE ANY ACTION) **
- This document is **NOT legal advice**, **NOT a contract template**, **NOT drafted by a licensed attorney**, and **creates zero attorney-client relationship**.
- It is an AI-generated internal checklist ONLY. Every single step **MUST** be reviewed, modified, and supervised by a licensed attorney in your jurisdiction before execution.
- You **MUST** consult qualified legal counsel, a CPA, and/or a registered agent before forming any entity, signing anything, or sharing any code.
- Grok / xAI / the author assume **zero liability** for any outcome. If any instruction feels off, delete it and seek professional help immediately.
- This file exists solely to demonstrate your good-faith, documented intent to protect IP and comply with best practices.

---

## 0. Link to Prior Document

See **MERLIN_PROJECT_SAFEGUARD_PROTOCOL_AND_LAWYER_BRIEFING_PROMPT.md** (commit `12a4ac3`, already in repo) for:
- Ownership assertions (Section 1)
- Priority sequence: LLC → NDA → fortress repo → limited access (Section 2)
- 15-step NDA briefing for counsel (Section 3)
- Verbal handshake lock-down points (Section 4)
- Technical fortress path (Section 5)
- Repository rules (Section 6)

**This checklist executes Sections 2.1 and 2.2 of that protocol in the real world.**

---

## B) LLC Formation Checklist — Execute FIRST
**Target:** Complete formation + IP assignment before any code sharing or third-party repo access.  
**Deadline suggestion:** End of weekend (June 28–29, 2026), or as soon as counsel confirms.

### B.1 — Decide entity type and state (Day 0, ~30 minutes)

| Option | When to use | Notes |
|--------|-------------|-------|
| **Delaware LLC** | Default for software/IP holding; investors later | Familiar to attorneys; annual franchise tax; need registered agent in DE |
| **Home-state LLC** | Simpler ops if you work only in one state | Lower ongoing complexity; confirm foreign-qualification if you expand |
| **Single-member LLC** | You are sole owner | Typical for indie/solo founder; consult CPA on tax election (default disregarded entity vs S-corp election later) |

**Action items:**
- [ ] Write chosen state: `________________`
- [ ] Write proposed legal name: `[INSERT YOUR LLC NAME], LLC` (check state name availability first)
- [ ] Confirm name does not infringe third-party trademarks (Mercedes-Benz marks are **not** yours — do not imply affiliation in the LLC name)
- [ ] Ask CPA or attorney: default tax treatment OK for now? (Schedule C vs S-corp election — defer until revenue)

### B.2 — Form the LLC (Day 0–1)

Pick **one** path (attorney may recommend a different route):

| Path | Approx. cost | Speed | Best for |
|------|--------------|-------|----------|
| **Stripe Atlas** | ~$500 | 1–2 weeks | Clean paperwork, DE C-Corp or LLC, includes registered agent bundle |
| **LegalZoom / Northwest / ZenBusiness** | ~$0–$300 + state fee | Days | Faster DIY with filing service |
| **DIY via state portal** | ~$90–$200 state fee only | Days | You file Articles of Organization yourself + hire registered agent separately |

**Action items:**
- [ ] Path chosen: `________________`
- [ ] Articles of Organization filed (save PDF confirmation)
- [ ] Registered agent appointed (required in formation state)
- [ ] Operating Agreement drafted — **have attorney review** even if using a template
- [ ] Save all formation PDFs to: `legal/formation/[YYYY-MM-DD]/` (local + encrypted backup; **do not commit secrets or EIN to public repo**)

### B.3 — Obtain EIN (Day 1, free)

- [ ] Apply at [IRS.gov EIN application](https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online) (online, immediate for eligible applicants)
- [ ] Save IRS CP 575 / confirmation letter to `legal/formation/` (encrypted, offline)
- [ ] **Never** commit EIN, SSN, or bank details to Git

### B.4 — IP Assignment Agreement (Day 1–2) — CRITICAL

Before sharing Merlin with **anyone**, assign all pre-existing IP from you (individual) to the LLC.

**Minimum topics the agreement must cover (attorney must draft final language):**
- All source code, documentation, prompts, database schemas, UI/UX, trade secrets, and derivatives of "Merlin"
- All work product created before and after formation
- Present assignment + future assignment (work-for-hire / invention assignment if you hire later)
- Consideration stated (e.g., membership interest / nominal $1 — counsel will specify)
- Representations that assignor owns the IP and it is not encumbered

**Suggested working title:** `Intellectual Property Assignment Agreement`  
**Parties:** `[Your Full Legal Name]` (Assignor) → `[INSERT YOUR LLC NAME], LLC` (Assignee)

**Action items:**
- [ ] Attorney-reviewed IP Assignment signed and dated
- [ ] Signed copy stored in `legal/ip-assignment/[YYYY-MM-DD]/`
- [ ] Update safeguard protocol Section 1 bracket: replace `[INSERT YOUR LLC NAME]` with actual LLC legal name
- [ ] Commit repo note only: `LLC formed + IP assigned [DATE]` — **no EIN, no signatures, no personal addresses in Git**

### B.5 — Business bank account (Day 2–3)

- [ ] Open LLC business checking (Mercury, Chase, local credit union — counsel/CPA may advise)
- [ ] Bring: EIN letter, Articles, Operating Agreement, ID
- [ ] **Segregate** all project-related expenses through LLC account going forward
- [ ] Do not commingle personal and LLC funds

### B.6 — Mark LLC milestone complete

- [ ] Update this file: check all boxes above
- [ ] Commit message template:  
  `LLC formed + IP assigned [DATE] • Due-diligence step B completed • Attorney review required`
- [ ] **Gate:** Do **not** proceed to repo access (Section 5 of safeguard protocol) until B.4 is signed

---

## A) Lawyer Outreach Pack — Execute IMMEDIATELY AFTER B.2 Started
**You may begin outreach while formation finishes, but do not share code until B.4 + signed NDA.**

### A.1 — Where to search

Use these exact search patterns (Google, Avvo, Martindale-Hubbell, your state bar lawyer referral service):

```
technology transactions attorney
software IP lawyer
NDA drafting developer contracts
unilateral NDA
trade secret protection software
[Sacramento / your city] OR remote
```

**Filters:** 5+ years experience, software/SaaS transactions, flat-fee NDA drafting mentioned in reviews.

**Action items:**
- [ ] Lawyer #1 contacted: `________________` Date: `____`
- [ ] Lawyer #2 contacted: `________________` Date: `____`
- [ ] Lawyer #3 contacted: `________________` Date: `____`
- [ ] Consult booked with: `________________` Date/time: `____`

### A.2 — Intake email template (copy-paste; customize brackets only)

**Subject:** Consult request — one-way NDA for proprietary software (Merlin) • LLC as Disclosing Party

```
Dear [Attorney Name / Firm],

I am forming [INSERT YOUR LLC NAME], LLC ([Delaware / home state]) to hold a proprietary production-ready 
software application called "Merlin" — an internal tool for Mercedes-Benz authorized dealership warranty 
story documentation. I need a short consult and, if we engage, a custom one-way (unilateral) NDA drafted 
as strongly as enforceable law allows in favor of my LLC as the Disclosing Party.

Context:
• Handshake evaluation deal — no code or access has been shared yet.
• I am completing LLC formation and a formal IP assignment to the LLC this week.
• Recipient would receive temporary, read-only evaluation access only after NDA execution.
• I need maximum protection for: source code, binaries, algorithms, UI flows, database schemas, 
  integration patterns, business rules, and dealership workflow logic.

Requested NDA features (subject to your advice on enforceability):
• Broad Confidential Information definition
• Perpetual trade-secret survival
• No license granted except limited evaluation
• Ban on reverse engineering, decompilation, and competing products
• Mandatory return-or-destroy with signed certification
• Injunctive relief, prevailing-party attorney fees, governing law in [my state], venue in [my county]
• Recitals that software is pre-owned by LLC and access transfers zero IP rights

I have an internal safeguard protocol and 15-step briefing already prepared for counsel review.

Are you available for a 30–60 minute consult? My budget for a strong custom one-way NDA is approximately 
$300–$800 flat fee (please quote your rate).

I will provide the Receiving Party's legal name after scope is confirmed.

Thank you,
[Your Full Name]
[Phone]
[Email]
[City, State]
```

### A.3 — Ten smartest questions to ask on the consult

1. Is a **one-way NDA** appropriate here, or do circumstances require mutual confidentiality? (Push for one-way if you are only disclosing.)
2. Which **governing law and venue** maximize enforceability for a `[state]` LLC?
3. Are **liquidated damages** enforceable in my jurisdiction, or should we rely on injunctive relief + actual damages?
4. What **return-or-destroy** timeline and **certification language** do you recommend?
5. Should we add a **non-solicit / no-hire** clause if the recipient employs dealership technicians?
6. Does the NDA need a **residual knowledge** carve-out, and how do we narrow it?
7. What **audit rights** (if any) are reasonable post-termination?
8. How do we define **permitted evaluation use** without granting an implied license?
9. What **red flags** in recipient pushback mean we should walk away?
10. What is your **flat fee** for draft + one round of revisions + execution version (Word/PDF)?

**Action items:**
- [ ] Consult completed Date: `____`
- [ ] Engaged counsel: `________________`
- [ ] NDA draft received Date: `____`
- [ ] NDA executed Date: `____` (store offline; log date only in repo)

### A.4 — Cross-reference: safeguard protocol Section 3

After consult, hand counsel **Section 3 (15-step process)** from `MERLIN_PROJECT_SAFEGUARD_PROTOCOL_AND_LAWYER_BRIEFING_PROMPT.md` in full. Steps 5–15 there cover review criteria, DocuSign, access gating, and 30-day follow-up.

---

## Execution Timeline & Logging Rules

| When | Action |
|------|--------|
| **Today (Jun 27)** | Start B.1–B.2 (entity decision + filing). Send intake email to 2–3 attorneys (A.2). |
| **Day 1–2** | EIN (B.3). IP Assignment to attorney for review (B.4). |
| **Day 2–3** | Bank account (B.5). NDA consult (A.3). |
| **Before any code share** | LLC formed ✓ IP assigned ✓ NDA signed ✓ |
| **After NDA signed** | Limited access per safeguard protocol §3.13–14 only |

### Logging (pick one or both)

1. **This file** — check boxes and fill `____` fields as you complete steps.
2. **`legal/audit-log.md`** (create locally; optional commit of non-sensitive milestones only):

```markdown
# Merlin Legal Due-Diligence Audit Log (INTERNAL)
| Date | Step | Action | Notes |
|------|------|--------|-------|
| 2026-06-27 | B.1 | Entity decision started | DE LLC under review |
| | | | |
```

### Commit discipline

After each milestone, commit with a message containing:  
`• Due-diligence step [B/A].[n] completed • Attorney review required`

**Never commit:** EIN, SSN, bank numbers, signed PDFs, attorney-client privileged drafts, or third-party personal data.

---

## Risk Log & Red Flags

| Risk | Mitigation |
|------|------------|
| Handshake without entity | Personal liability exposure → **LLC + IP assignment first (B.4)** |
| Sharing code before NDA | Immediate stop → revoke access if any was granted |
| Recipient wants **mutual** NDA with broad reciprocity | Push back; consult counsel; may be walk-away |
| Recipient refuses **return-or-destroy** | Walk-away signal |
| Recipient wants **perpetual license** or **derivative rights** | Walk-away — conflicts with safeguard protocol §1 |
| Implied **Mercedes-Benz affiliation** in LLC name or marketing | Do not — trademark/compliance risk; counsel + brand guidelines |
| Secrets in Git | Never — see safeguard protocol §6 |
| Private GitHub as permanent home | Temporary only — plan fortress migration (safeguard protocol §5) |

**Stop conditions (do not proceed):**
- LLC not formed OR IP not assigned
- No signed one-way NDA in hand
- Counsel has not reviewed your specific fact pattern
- Any party pressures you to skip "legal formalities"

---

## Completion Checklist (Summary)

- [ ] **B complete:** LLC formed, EIN obtained, IP assigned to LLC, bank account open
- [ ] **A complete:** Lawyer engaged, one-way NDA drafted, executed, stored offline
- [ ] **Gate cleared:** Only now consider limited evaluation access per safeguard protocol
- [ ] **Next layer:** Self-hosted repo fortress (safeguard protocol §5) — schedule after NDA

---

**This checklist added to create a clear, dated, auditable trail showing deliberate protective steps were taken before any further action on the Merlin project.**

**End of document. Route every future decision through licensed professionals only.**