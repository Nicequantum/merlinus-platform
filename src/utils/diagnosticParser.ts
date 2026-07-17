import type { ExtractedData, FaultCode } from '@/types';

const EMPTY_EXTRACTED: ExtractedData = {
  codes: [],
  faultCodes: [],
  guidedTests: [],
  measurements: [],
  components: [],
  circuits: [],
};

const FAULT_CODE_RE = /\b([BCUP][0-9A-Z]{4,5}(?:-\d{3})?)\b/gi;

export function emptyExtractedData(): ExtractedData {
  return { ...EMPTY_EXTRACTED };
}

function normalizeFaultCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '');
}

function dedupeFaultCodes(items: FaultCode[]): FaultCode[] {
  const map = new Map<string, FaultCode>();
  for (const item of items) {
    const code = normalizeFaultCode(item.code);
    if (!code) continue;
    const existing = map.get(code);
    if (!existing) {
      map.set(code, { code, description: item.description?.trim() || '', status: item.status?.trim() || undefined });
      continue;
    }
    if (!existing.description && item.description) existing.description = item.description.trim();
    if (!existing.status && item.status) existing.status = item.status.trim();
    if (item.description && item.description.length > (existing.description?.length || 0)) {
      existing.description = item.description.trim();
    }
  }
  return Array.from(map.values());
}

export function syncCodesFromFaultCodes(faultCodes: FaultCode[]): string[] {
  return dedupeFaultCodes(faultCodes).map((fc) => fc.code);
}

export function normalizeExtractedData(data?: Partial<ExtractedData> | null): ExtractedData {
  const faultCodes = dedupeFaultCodes([
    ...(data?.faultCodes || []),
    ...(data?.codes || []).map((code) => ({ code, description: '' })),
  ]);
  return {
    codes: syncCodesFromFaultCodes(faultCodes),
    faultCodes,
    guidedTests: [...new Set(data?.guidedTests || [])],
    measurements: [...(data?.measurements || [])].slice(0, 12),
    components: [...new Set(data?.components || [])],
    circuits: [...new Set(data?.circuits || [])],
  };
}

export function formatFaultCodesForPrompt(faultCodes: FaultCode[]): string {
  if (faultCodes.length === 0) return '';
  return faultCodes
    .map((fc) => {
      const parts = [fc.code];
      if (fc.description) parts.push(fc.description);
      if (fc.status) parts.push(`(${fc.status})`);
      return parts.join(' — ');
    })
    .join('\n');
}

export function formatExtractedDataForPrompt(data: ExtractedData): string {
  const lines = [
    data.faultCodes.length ? `Fault codes:\n${formatFaultCodesForPrompt(data.faultCodes)}` : '',
    data.guidedTests.length ? `Guided Tests: ${data.guidedTests.join(' | ')}` : '',
    data.measurements.length
      ? `Measurements: ${data.measurements.map((m) => `${m.label} = ${m.value}`).join('; ')}`
      : '',
    data.components.length ? `Components: ${data.components.join(' | ')}` : '',
    data.circuits.length ? `Circuits/Pins: ${data.circuits.join(', ')}` : '',
  ].filter(Boolean);
  return lines.join('\n') || 'No structured Xentry data extracted.';
}

export function formatExtractionAsOcrText(data: Partial<ExtractedData>): string {
  const normalized = normalizeExtractedData(data);
  const lines: string[] = ['[XENTRY EXTRACTION]'];
  if (normalized.faultCodes.length) {
    lines.push('[FAULT CODES]');
    normalized.faultCodes.forEach((fc) => {
      lines.push(`${fc.code} | ${fc.description || '[no description]'}${fc.status ? ` | ${fc.status}` : ''}`);
    });
  }
  if (normalized.guidedTests.length) {
    lines.push('[GUIDED TESTS]');
    normalized.guidedTests.forEach((t) => lines.push(`Guided Test: ${t}`));
  }
  if (normalized.measurements.length) {
    lines.push('[MEASUREMENTS]');
    normalized.measurements.forEach((m) => lines.push(`${m.label}: ${m.value}`));
  }
  if (normalized.components.length) lines.push(`Components: ${normalized.components.join(', ')}`);
  if (normalized.circuits.length) lines.push(`Circuits: ${normalized.circuits.join(', ')}`);
  return lines.join('\n');
}

function parseFaultCodesFromText(text: string): FaultCode[] {
  const faultCodes: FaultCode[] = [];
  const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const pipeMatch = line.match(/^([BCUP][0-9A-Z]{4,5}(?:-\d{3})?)\s*\|\s*(.+?)(?:\s*\|\s*(current|stored|intermittent|pending|active))?$/i);
    if (pipeMatch) {
      faultCodes.push({
        code: normalizeFaultCode(pipeMatch[1]),
        description: pipeMatch[2].trim(),
        status: pipeMatch[3]?.toLowerCase(),
      });
      continue;
    }

    const inlineMatch = line.match(/\b([BCUP][0-9A-Z]{4,5}(?:-\d{3})?)\b\s*[-–:]\s*(.+)/i);
    if (inlineMatch) {
      faultCodes.push({
        code: normalizeFaultCode(inlineMatch[1]),
        description: inlineMatch[2].trim(),
      });
      continue;
    }

    const codeOnly = line.match(/^([BCUP][0-9A-Z]{4,5}(?:-\d{3})?)$/i);
    if (codeOnly) {
      faultCodes.push({ code: normalizeFaultCode(codeOnly[1]), description: '' });
    }
  }

  let match: RegExpExecArray | null;
  const re = new RegExp(FAULT_CODE_RE.source, 'gi');
  while ((match = re.exec(text)) !== null) {
    const code = normalizeFaultCode(match[1]);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    const descMatch = after.match(/^\s*[-–:]\s*([^\n]{4,160})/);
    faultCodes.push({
      code,
      description: descMatch ? descMatch[1].trim() : '',
    });
  }

  return dedupeFaultCodes(faultCodes);
}

export function parseDiagnosticText(text: string): Partial<ExtractedData> {
  const upper = text.toUpperCase();
  const faultCodes = parseFaultCodesFromText(text);
  const codes = syncCodesFromFaultCodes(faultCodes);
  const guidedTests = Array.from(text.matchAll(/Guided Test[:\s-]*(.+?)(?=\n|Test|$)/gi))
    .map((m) => m[1].trim())
    .filter((t) => t.length > 3);
  const measurements = Array.from(
    text.matchAll(/([A-Za-z0-9\s/]+?)\s*[:=]\s*([\d.]+\s*(?:V|VOLTS|PSI|BAR|OHM|kOHM|mA|°C|°F|bar|kpa)?)/gi)
  )
    .map((m) => ({ label: m[1].trim(), value: m[2].trim() }))
    .slice(0, 12);
  const components = Array.from(upper.matchAll(/\b([A-Z]\d{1,2}\/\d{1,2}[A-Z]?(?:Y\d)?)\b/g)).map((m) => m[1]);
  const circuits = Array.from(text.matchAll(/pin\s*(\d+\.?\d*)|circuit\s*(\d+[A-Z]?)/gi)).map((m) => m[0].trim());
  return { codes, faultCodes, guidedTests, measurements, components, circuits };
}

export function parseDiagnosticExtractionJson(raw: string): Partial<ExtractedData> | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      faultCodes?: Array<{ code?: string; description?: string; status?: string }>;
      guidedTests?: string[];
      measurements?: Array<{ label?: string; value?: string }>;
      components?: string[];
      circuits?: string[];
    };
    const faultCodes = dedupeFaultCodes(
      (parsed.faultCodes || [])
        .filter((fc) => fc.code)
        .map((fc) => ({
          code: normalizeFaultCode(fc.code!),
          description: (fc.description || '').trim(),
          status: fc.status?.trim(),
        }))
    );
    return normalizeExtractedData({
      faultCodes,
      guidedTests: parsed.guidedTests || [],
      measurements: (parsed.measurements || [])
        .filter((m) => m.label && m.value)
        .map((m) => ({ label: m.label!.trim(), value: m.value!.trim() })),
      components: parsed.components || [],
      circuits: parsed.circuits || [],
    });
  } catch {
    return null;
  }
}

export function parseDiagnosticExtraction(text: string): Partial<ExtractedData> {
  const fromJson = parseDiagnosticExtractionJson(text);
  if (fromJson) return fromJson;
  return parseDiagnosticText(text);
}

export function mergeExtracted(base: ExtractedData, add: Partial<ExtractedData>): ExtractedData {
  const mergedFaultCodes = dedupeFaultCodes([...(base.faultCodes || []), ...(add.faultCodes || [])]);
  return normalizeExtractedData({
    faultCodes: mergedFaultCodes,
    guidedTests: [...new Set([...(base.guidedTests || []), ...(add.guidedTests || [])])],
    measurements: [...(base.measurements || []), ...(add.measurements || [])].slice(0, 12),
    components: [...new Set([...(base.components || []), ...(add.components || [])])],
    circuits: [...new Set([...(base.circuits || []), ...(add.circuits || [])])],
  });
}

export function rebuildExtractedFromOcrTexts(texts: string[]): ExtractedData {
  let result = emptyExtractedData();
  for (const text of texts) {
    if (!text?.trim()) continue;
    result = mergeExtracted(result, parseDiagnosticExtraction(text));
  }
  return result;
}