/**
 * Customer SMS body for video inspection share links.
 * Pure helper — safe for unit tests (no server-only deps).
 */

/** Build SMS body: production link + short report preview (Twilio ~1600 char limit). */
export function buildVideoInspectionSmsBody(input: {
  dealershipName: string;
  shareUrl: string;
  report?: string | null;
  vehicleLabel?: string | null;
}): string {
  const dealership = input.dealershipName.replace(/[\r\n\t]/g, ' ').trim().slice(0, 40);
  const vehicle = (input.vehicleLabel || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 48);
  const header = vehicle
    ? `${dealership}: Your ${vehicle} video inspection is ready.`
    : `${dealership}: Your vehicle video inspection is ready.`;

  const report = (input.report || '').trim();
  let preview = '';
  if (report) {
    // Prefer Summary section if present
    const summaryMatch = report.match(/##\s*Summary\s*\n+([\s\S]*?)(?=\n##\s|$)/i);
    const raw = (summaryMatch?.[1] || report).replace(/\s+/g, ' ').trim();
    preview = raw.slice(0, 280);
    if (raw.length > 280) preview += '…';
  }

  const lines = [
    header,
    '',
    'Watch the video & full written report:',
    input.shareUrl,
  ];
  if (preview) {
    lines.push('', `Report preview: ${preview}`);
  }
  lines.push('', 'Questions? Contact the service department.');
  // Twilio segment safety
  return lines.join('\n').slice(0, 1500);
}
