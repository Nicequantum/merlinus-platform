# Merlin — Technician Quick Start

**Audience:** Mercedes-Benz service technicians  
**Time to read:** 5 minutes  
**Version:** 3.0.0

> **Shop-floor cheat sheet:** Print and laminate the [Bay Reference Card](./Bay-Reference-Card.md) — keep it next to your tablet for voice modes and quick fixes.

---

Merlin helps you turn repair notes into professional **MI 4.3–ready** warranty stories — fast. **Voice input** is built for greasy hands and noisy bays. **AI story generation** formats your documented findings into narratives you can paste into CDK or export as a PDF.

> **Remember:** Merlin never invents test results. Document what you actually did. The AI formats your work — it does not replace your judgment.

---

## 1. Log in and open a repair order

1. Open Merlin on your shop-floor tablet (Chrome or Edge).
2. Sign in with your D7 number and password.
3. From the **repair order list**, open an RO and tap the **repair line** you are working on.

![Login and repair order list](./images/technician-login-ro-list.svg)

---

## 2. Voice input — your fastest way to enter notes

Every text field in Merlin has a **microphone button** next to it. Use voice for line descriptions, customer concerns, technician notes, and warranty story edits.

### Two voice modes

| Mode | How to use | Best for |
|------|------------|----------|
| **Tap to toggle** (default) | Tap the mic **once** to start listening. Tap **again** to stop. | Longer notes, multiple sentences, walking around the bay |
| **Push-to-talk** | Tap the **hand icon** to switch modes, then **hold** the mic while you speak. Release to stop. | Noisy bays, short bursts, when you want the mic on only while you talk |

![Voice modes — tap toggle vs push-to-talk](./images/technician-voice-modes.svg)

**Switching modes:** Tap the small **hand / toggle** button beside the mic. Your choice is saved on that tablet.

### First-time microphone permission

The first time you use voice, the browser asks to **Allow microphone**. Tap **Allow**. If you tap Block by mistake, open the site settings (lock icon in the address bar) → Microphone → Allow → reload the page.

### While you speak — what the panel shows

When the mic is active, a small panel appears:

- **Bay noise level** — Quiet / Moderate / Noisy / Very noisy
- **Recognition confidence** — how sure the tablet is about what it heard
- **Live preview** — **final** text (solid) vs *interim* text (italic while you are still talking)

![Voice listening panel with noise meter](./images/technician-voice-panel.svg)

---

## 3. Voice tips for a noisy service bay

Merlin is tuned for real shop-floor conditions. These habits help voice work reliably:

| Tip | Why it helps |
|-----|--------------|
| **Use push-to-talk** near running lifts, air tools, or compressors | Mic is only open while you hold the button — less background noise gets picked up |
| **Hold the tablet 6–12 inches from your mouth** | Clearer pickup without shouting |
| **Pause briefly between thoughts** | Final text locks in; interim text updates as you go |
| **Speak test results clearly** — “P0300 cylinder 3 misfire” | Warranty stories need accurate codes and measurements |
| **Face away from the loudest noise** when possible | Even with noise suppression, direction matters |
| **Watch the noise meter** — if it says *Very noisy*, switch to push-to-talk or move a step away | Merlin lowers its confidence threshold in loud bays, but cleaner audio is always better |
| **If listening stops after ~45 seconds of silence** | Tap **Retry** — this is normal timeout protection, not a bug |

**Pro tip from the bay:** Dictate technician notes in short chunks (finding → test → repair) instead of one long ramble. Tap **Generate MI 4.3** after your notes are complete.

---

## 4. Build your line — diagnostic evidence, then generate

### Step A — Fill in the line (voice or type)

1. **Line description** — what you are fixing on this line.
2. **Customer concern** — prefilled from scan; edit to match advisor wording.
3. **Technician notes & findings** — document actual tests, measurements, parts replaced, and results. **Use voice here.**

![Technician notes field with microphone](./images/technician-notes-voice.svg)

### Step B — Add diagnostic evidence (optional but recommended)

Scroll to the **Diagnostic Evidence** section on the line view:

1. Tap **Capture photo** or **Add from gallery** for XENTRY screenshots, fault codes, guided tests, or voltmeter readings.
2. Queue multiple images, then tap **Process images** — Merlin extracts codes and readings for story generation.
3. To stop mid-batch, tap **Cancel** — queued photos are cleared (same as RO scan cancel).

![Diagnostic Evidence section with photo queue](./images/technician-diagnostic-evidence.svg)

### Step C — Generate the MI 4.3 story

1. When your notes reflect **work you actually performed**, tap **Generate MI 4.3**.
2. Wait for the progress bar — usually a few seconds. Stay on Wi‑Fi.
3. Read the story in the **Warranty Story · 3 C's** box. Edit anything that needs correction (voice or keyboard).

![Generate MI 4.3 button](./images/technician-generate-mi43.svg)

### Step D — Audit, review, certify, and submit

| Action | When to use it |
|--------|----------------|
| **Audit Story** | Score the narrative against MI criteria after you have a story |
| **Review with AI** | Get coaching feedback on clarity and completeness |
| **Regenerate** | Notes changed significantly — get a fresh draft |
| **Copy for CDK** | Paste formatted text into your DMS (after certification when required) |
| **Export PDF** | Branded PDF for records or submission |
| **Browse template library** | Insert a saved story pattern for common jobs |

**Character limit:** The counter shows story length. If you exceed the recommended DMS limit, edit before submitting.

![Warranty story editor with Audit Story and Copy for CDK](./images/technician-story-actions.svg)

### Customer Pay lines (instant — no AI)

If the line shows a green **Customer Pay · Instant** badge, pick a template from the library — no **Generate MI 4.3** or quality audit required. Edit and **Copy for CDK** when ready.

---

## 5. When voice does not work — use manual typing

Voice is optional. **Every field can be typed.** Manual input always works, even when:

- Wi‑Fi is down (you can still type; AI generation needs network)
- The browser does not support voice
- Microphone permission was denied
- The bay is too loud for reliable recognition

**Fallback steps:**

1. Type directly in the text box — same fields, same workflow.
2. If you see *“Voice unavailable — type below”* — use Chrome or Edge on the tablet.
3. If the mic button does nothing — check microphone permission and reload.
4. If words cut off mid-sentence — switch to **push-to-talk** or tap **Retry**.
5. Still stuck? Finish the RO by typing. Tell your service manager — do not delay the customer job.

---

## 6. Quick troubleshooting

| Problem | What to try |
|---------|-------------|
| Mic button grayed out or missing | Voice may be disabled for your store — type manually; notify service manager |
| “Microphone blocked” message | Site settings → allow mic → reload page |
| Voice stops after one sentence | Switch to **tap to toggle** for longer dictation, or tap **Retry** |
| Wrong words appear | Edit the text — voice is a draft, not the final story |
| **Generate MI 4.3** hangs or times out | Shorten notes, check Wi‑Fi, tap **Regenerate** |
| Diagnostic photos stuck processing | Tap **Cancel**, re-queue images, try **Process images** again |
| Logged out unexpectedly | Sign in again; ask IT if it keeps happening |
| Red audit or integrity warning | **Stop using Merlin** — notify service manager immediately |

---

## 7. Daily checklist (30 seconds)

- [ ] Chrome or Edge, tablet charged, Wi‑Fi connected
- [ ] Logged into Merlin
- [ ] Technician notes document **actual** findings before generating
- [ ] **Audit Story** run when certification is required
- [ ] Story reviewed and edited before CDK paste or PDF export

---

## Need help?

| Contact | For |
|---------|-----|
| **Service Manager** | Account issues, templates, process questions |
| **Dealership IT** | Login problems, Wi‑Fi, tablet setup, system down |
| **Merlin maintenance banner** | AI temporarily paused — complete notes by typing; generation returns when IT clears maintenance |

---

*Merlin v3.0.0 — Mercedes-Benz Warranty Story Generator · Authorized dealership use only*