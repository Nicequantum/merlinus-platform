const ADVISOR_NOISE =
  /^(?:service\s+advisor|svc\.?\s*advisor|advisor|sa|writer|name|tech|technician)$/i;

/** Stable fingerprint for deduplicating advisor names within a dealership. */
export function fingerprintAdvisorName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAdvisorDisplayName(name: string): string {
  const cleaned = name.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((part) => {
      if (part.length <= 2 && /^[A-Z]\.?$/.test(part)) return part.replace('.', '').toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

export function isPlausibleAdvisorName(name: string): boolean {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 3 || trimmed.length > 48) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (ADVISOR_NOISE.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (/^(vin|ro|mileage|customer|mercedes|benz|maybach)$/i.test(trimmed)) return false;
  return true;
}

export function complaintLineLabel(index: number): string {
  if (index < 0 || index > 25) return String(index + 1);
  return String.fromCharCode(65 + index);
}

export function inferVehicleFamily(make: string, model: string): string | null {
  const blob = `${make} ${model}`.toUpperCase();
  if (blob.includes('MAYBACH')) return 'Maybach';
  if (blob.includes('AMG')) return 'AMG';
  if (/\bGLE\b/.test(blob)) return 'GLE';
  if (/\bGLS\b/.test(blob)) return 'GLS';
  if (/\bGLC\b/.test(blob)) return 'GLC';
  if (/\bGLA\b/.test(blob)) return 'GLA';
  if (/\bEQE\b|\bEQS\b|\bEQB\b/.test(blob)) return 'EQ';
  if (/\bS[- ]CLASS\b/.test(blob) || /\bS\s*\d{2,3}\b/.test(blob)) return 'S-Class';
  if (/\bE[- ]CLASS\b/.test(blob) || /\bE\s*\d{2,3}\b/.test(blob)) return 'E-Class';
  if (/\bC[- ]CLASS\b/.test(blob) || /\bC\s*\d{2,3}\b/.test(blob)) return 'C-Class';
  return null;
}