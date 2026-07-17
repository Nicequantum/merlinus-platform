/** Format sanitized audit metadata for manager UI (M6). */
export function formatAuditMetadataForDisplay(metadata: Record<string, unknown>): string[] {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null || value === '') continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: ${value.map(String).join(', ')}`);
      continue;
    }

    lines.push(`${key}: ${String(value)}`);
  }

  return lines;
}