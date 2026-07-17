export const RO_EXTRACTION_PROMPT = `OCR all repair order image(s). Extract header fields AND every customer complaint line.

VMI pages (Vehicle Master Inquiry) are separate documents — ignore them for complaints; do not mix VMI warranty text into complaint letters A–Z.

HEADER (top of RO):
- RO Number (near "RO #", "Repair Order", "Work Order")
- Customer Name
- Service Advisor / Writer (NOT the technician)
- Year, Make, Model, VIN (exactly 17 chars), Mileage IN (numbers only)

COMPLAINTS (highest priority):
Block starts immediately AFTER the header row:
  LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS
(variants: LINE OPCODE TECH TYPE HOURS, etc.)

Below that, complaints use hashtag labels in a vertical column (no commas):
    # A
    # B
    # C …

Line A is often flush against the header row — same line or zero gap. Example:
  LINE OP CODE TECH TYPE DESCRIPTION / INSTRUCTIONS # A Drop-off loaner supplied
Never skip Line A.

Alternate format: plain letters "A.", "B." or "A RHODE ISLAND STATE INSPECTION" — extract the same way.

Complaint text is beside or on the same line as the label:
  # A RHODE ISLAND STATE INSPECTION
  # B CHECK ENGINE LIGHT ON

Multi-page: search ALL pages; continuation text on page 2 belongs to the prior letter, not a new line. Still extract every # letter on later pages.

Rules:
- Extract EVERY printed letter line (A–Z) even if short, QC, or hard to read — include QC/shop lines verbatim.
- Do NOT invent letters from words inside complaint text.
- Unlabeled lines (e.g. "619 CDEF") are inspection detail — output only lettered complaint lines.
- Capture text after "Customer states...", "C/S", "Concern" when paired with a # letter.

Output ONLY:

RO Number: [value]
Customer Name: [value]
Service Advisor Name: [value or blank]
Year: [value]
Make: [value]
Model: [value]
VIN: [exact 17 char]
Mileage IN: [numbers only]
Customer Complaints:
A. [exact text for # A]
B. [exact text for # B]
…every letter actually printed, alphabetical order (skip absent letters). Use "A." prefix even if RO shows "# A". Fix O/0 and I/1 in VIN.`;