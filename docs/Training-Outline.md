# Merlin — Technician Training Session Outline

**Audience:** Trainers, Service Managers, Lead Technicians  
**Session length:** 30–45 minutes  
**Class size:** 4–12 technicians (hands-on with tablets)  
**Version:** 3.0.1

---

## Session goals

By the end of this session, every technician will be able to:

1. Log in and navigate to a repair line on a shop-floor tablet
2. Enter technician notes using **voice input** (tap-to-toggle and push-to-talk)
3. **Generate**, **review**, and **edit** a warranty story
4. **Copy** a story for CDK and **download** a PDF
5. Fall back to **manual typing** when voice or AI is unavailable
6. Apply shop-floor habits that work in a **noisy service bay**

---

## Materials needed

| Item | Qty | Notes |
|------|-----|-------|
| Shop-floor tablets (Chrome/Edge) | 1 per technician | Charged, logged in |
| Wi‑Fi | Stable | Test before session |
| Training RO or practice RO | 1 per pair | No real customer PII if possible |
| Printed [Quick Start](./Technician-Quick-Start.md) | 1 per tech | Leave-behind reference |
| Whiteboard or slide display | 1 | For 3 C's reminder |
| Bluetooth speaker (optional) | 1 | Simulate bay noise for Exercise 2 |

![Training room setup with tablets](./images/training-room-setup.png)

---

## Agenda overview

| # | Section | Time | Format |
|---|---------|------|--------|
| 1 | Welcome & why Merlin | 5 min | Presentation |
| 2 | Voice input deep dive | 12 min | Demo + hands-on |
| 3 | Building the line & generating stories | 10 min | Demo + hands-on |
| 4 | Review, edit, export | 8 min | Hands-on |
| 5 | Noisy bay & troubleshooting scenarios | 7 min | Guided practice |
| 6 | Wrap-up & daily habits | 3 min | Q&A |

**Total:** 45 minutes (compress sections 2 and 5 to 30 minutes if needed)

---

## Section 1 — Welcome & why Merlin (5 min)

### Talking points

- Merlin turns **your documented findings** into professional warranty narratives.
- It saves time on typing — especially with **voice input** designed for the bay.
- It does **not** invent test results. If you did not document it, Merlin marks it `[NOT DOCUMENTED]`.
- Every generation is **audit-logged** for dealership accountability.

### The 3 C's (reminder)

| C | Meaning | Technician responsibility |
|---|---------|---------------------------|
| **Complaint** | What the customer reported | Confirm advisor wording |
| **Cause** | What you found | Document tests and fault codes |
| **Correction** | What you fixed | Document parts and verification |

![3 C's diagram](./images/training-three-cs.png)

### Learning checkpoint

- [ ] Technicians can explain: “Merlin formats my notes — I still own accuracy.”

---

## Section 2 — Voice input deep dive (12 min)

> **This is the most important section.** Spend extra time here if the class is new to voice tools.

### 2A — Instructor demo (4 min)

1. Open a repair line → **Technician notes** field.
2. Show **tap-to-toggle**: tap mic → speak → tap mic to stop.
3. Show the listening panel: noise level, confidence, interim vs final text.
4. Tap the **hand icon** → switch to **push-to-talk** → hold mic while speaking.
5. Say: *“Manual typing always works — voice is a shortcut, not a requirement.”*

![Instructor demo — voice modes](./images/training-voice-demo.png)

### 2B — Hands-on Exercise 1: First dictation (4 min)

**Instructions to class:**

> Dictate the following into **Technician notes** using tap-to-toggle:
>
> *“Connected XENTRY. Quick Test found fault code P0300. Checked ignition coils. Cylinder 3 coil failed resistance test. Replaced all four coils. Cleared codes. Test drive confirmed repair.”*

**Success criteria:**

- [ ] Mic permission allowed (or technician knows how to fix Block)
- [ ] Final text appears in the notes field
- [ ] Technician stopped listening intentionally (not timeout)

### 2C — Hands-on Exercise 2: Push-to-talk in noise (4 min)

**Setup:** Play shop noise at moderate volume (or conduct exercise in the live bay).

**Instructions:**

> Switch to push-to-talk. Hold the mic and dictate only:
> *“Battery voltage 12.4 volts at rest. Charging system test passed at 14.2 volts.”*

**Debrief questions:**

- Which mode felt better in noise?
- What did the noise meter show?
- What would you do if words were wrong? *(Answer: edit the text)*

### Learning checkpoint

- [ ] Every technician has used both tap-to-toggle and push-to-talk at least once
- [ ] Every technician knows where to tap **Retry** after a timeout

---

## Section 3 — Building the line & generating stories (10 min)

### 3A — Instructor demo (4 min)

Walk through the full line workflow:

1. **Line description** — voice or type
2. **Customer concern** — edit prefilled text to match advisor
3. **Technician notes** — already filled from Exercise 1
4. **(Optional)** Add diagnostic photo — show OCR preview
5. Tap **Generate warranty story**
6. Point out character counter and quality panel loading

![Generate story workflow](./images/training-generate-workflow.png)

### 3B — Hands-on Exercise 3: Generate your first story (6 min)

**Instructions:**

> Using your practice line, tap **Generate warranty story**. Read the full story aloud to your partner. Mark one sentence you would edit.

**Pair activity:**

- Partner A generates; Partner B reviews for missing tests or wrong codes
- Swap roles if time allows

**Success criteria:**

- [ ] Story generated without timeout
- [ ] Technician identified at least one edit before submission

### Learning checkpoint

- [ ] Technicians understand: generate **after** notes are complete, not before

---

## Section 4 — Review, edit, export (8 min)

### 4A — Instructor demo (3 min)

1. Tap **Review with AI** — show quality feedback panel
2. Edit one sentence in the story (voice or keyboard)
3. Tap **Copy for CDK** — paste into notepad to demonstrate
4. Tap **Download PDF** — show branded output
5. Mention **Regenerate** only when notes changed significantly

### 4B — Hands-on Exercise 4: Edit and export (5 min)

**Instructions:**

> 1. Edit your story — fix the sentence you flagged earlier.
> 2. Tap **Review with AI**.
> 3. Tap **Copy for CDK** and confirm the clipboard toast appears.
> 4. Download the PDF.

**Success criteria:**

- [ ] Story edited and saved in the field
- [ ] Copy and PDF both completed

### Learning checkpoint

- [ ] Technicians will not submit unedited AI drafts

---

## Section 5 — Scenario practice (7 min)

Run these as rapid “what would you do?” scenarios. Optionally let technicians perform each on their tablet.

### Scenario A — Noisy bay, voice keeps cutting out

| Setup | Push-to-talk near a running lift or noise speaker |
|-------|--------------------------------------------------|
| **Expected behavior** | Switch to push-to-talk; hold mic close; dictate in short phrases |
| **Fallback** | Type the notes — same workflow |

### Scenario B — Long story, hit listening timeout

| Setup | Start tap-to-toggle and pause 20+ seconds mid-dictation |
|-------|------------------------------------------------------|
| **Expected behavior** | Tap **Retry**; continue dictation; or type remaining notes |
| **Teaching point** | Timeout protects against stuck sessions — not an error |

### Scenario C — AI timeout during generation

| Setup | Instructor describes: “Generating spins for 30+ seconds” |
|-------|----------------------------------------------------------|
| **Expected behavior** | Check Wi‑Fi; shorten notes; tap **Regenerate** |
| **Fallback** | Type story manually in warranty story field |

### Scenario D — Wrong fault code in generated story

| Setup | Notes said P0300 but story shows P0301 |
|-------|----------------------------------------|
| **Expected behavior** | Edit the story; fix the code; do not regenerate blindly |
| **Teaching point** | You are the author — AI is a draft assistant |

### Scenario E — Maintenance banner appears

| Setup | Instructor shows maintenance banner screenshot |
|-------|---------------------------------------------|
| **Expected behavior** | Continue documenting notes by typing; notify service manager; AI returns when IT clears maintenance |

![Troubleshooting scenario cards](./images/training-scenario-cards.png)

### Learning checkpoint

- [ ] Technicians can name two fallbacks: push-to-talk and manual typing
- [ ] Technicians know to notify SM on audit or integrity warnings (not IT for story edits)

---

## Section 6 — Wrap-up & daily habits (3 min)

### Daily habits (post on wall)

1. **Notes first, generate second** — document real findings before AI
2. **Push-to-talk in loud bays** — default for compressor and lift areas
3. **Always read before submit** — edit the draft; run Review with AI on complex jobs
4. **Copy or PDF** — use the workflow your warranty admin prefers
5. **Ask SM first, IT second** — story questions vs system outages

### Q&A

Leave 2–3 minutes for questions. Common topics:

- Login / password reset → Service Manager
- Mic blocked → IT or site settings
- Story policy questions → Service Manager / warranty admin

### Distribute materials

- [ ] [Technician Quick Start](./Technician-Quick-Start.md) — printed or emailed
- [ ] IT + SM contact card
- [ ] Merlin URL bookmark confirmed on every tablet

---

## Trainer checklist (complete after session)

### Attendance

| Technician name | Attended | Hands-on complete | Quick Start received |
|-----------------|----------|-------------------|----------------------|
| | ☐ | ☐ | ☐ |
| | ☐ | ☐ | ☐ |
| | ☐ | ☐ | ☐ |
| | ☐ | ☐ | ☐ |

### Skills verified (circle per technician)

| Skill | Tech 1 | Tech 2 | Tech 3 | Tech 4 |
|-------|--------|--------|--------|--------|
| Login + open repair line | | | | |
| Tap-to-toggle voice | | | | |
| Push-to-talk voice | | | | |
| Generate warranty story | | | | |
| Edit story | | | | |
| Copy for CDK | | | | |
| Download PDF | | | | |
| Manual typing fallback explained | | | | |

### Session logistics

- [ ] All tablets returned to bays or charging station
- [ ] Training ROs flagged or deleted per dealership policy
- [ ] Feedback form collected (optional)
- [ ] Refresher date scheduled for absent technicians: _______________
- [ ] Trainer sign-off: _______________ Date: _______________

---

## 30-minute compressed agenda

If only 30 minutes are available, use this schedule:

| Section | Time |
|---------|------|
| Welcome & 3 C's | 3 min |
| Voice demo + Exercise 1 only | 10 min |
| Generate story (Exercise 3) | 8 min |
| Copy + PDF (Exercise 4) | 6 min |
| Wrap-up | 3 min |

Assign Exercises 2, 4 pair work, and Section 5 scenarios as **bay-floor follow-up** with lead technician during the first live week.

---

## Related documents

| Document | Link |
|----------|------|
| Technician Quick Start | [Technician-Quick-Start.md](./Technician-Quick-Start.md) |
| Admin Setup Guide | [Admin-Setup-Guide.md](./Admin-Setup-Guide.md) |
| Rollout Checklist | [Rollout-Checklist.md](./Rollout-Checklist.md) |

---

*Merlin — Mercedes-Benz Warranty Story Generator · Training Outline*