export const DIAGNOSTIC_EXTRACTION_PROMPT = `Analyze this Mercedes-Benz XENTRY / diagnostic screenshot carefully.

Extract ALL visible diagnostic information. Focus especially on fault codes WITH their full descriptions exactly as shown on screen.

Look for:
- Fault / event / DTC codes (e.g. B16B54, P0171, C1234, U0100) with full text descriptions
- Code status if shown (current, stored, intermittent, pending, active)
- Guided test names and results
- Measurements with units (voltage, resistance, pressure, temperature)
- Mercedes component references (e.g. B12/3, N10/1)
- Circuit / pin references
- Quick Test summary if visible

Rules:
- Extract ONLY what is visible in the image. Do NOT invent codes or values.
- Preserve exact code strings and description wording from the screen.
- If a field is not visible, use an empty array for that field.

Respond with ONLY valid JSON in this exact shape:
{
  "faultCodes": [
    { "code": "B16B54", "description": "Component B16 (Heat exchanger blower motor): Open circuit", "status": "stored" }
  ],
  "guidedTests": ["Test name or result"],
  "measurements": [{ "label": "Source voltage", "value": "12.4 V" }],
  "components": ["B12/3"],
  "circuits": ["pin 3", "circuit 15"]
}`;