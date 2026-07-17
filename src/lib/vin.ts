export interface VinDecodeResult {
  vin: string;
  year: string;
  make: string;
  model: string;
  engine: string;
  trim: string;
  bodyClass: string;
  driveType: string;
  fuelType: string;
  valid: boolean;
}

function pickValue(results: Array<{ Variable: string; Value: string | null }>, variable: string): string {
  const item = results.find((r) => r.Variable === variable);
  const value = item?.Value?.trim() || '';
  if (!value || value.toLowerCase() === 'none') return '';
  return value;
}

/** Normalize NHTSA model/trim into a Mercedes-friendly model token for KB lookup. */
export function normalizeDecodedModel(model: string, trim: string): string {
  const classMatch = model.match(/^([A-Z][A-Z0-9]{0,3})-Class$/i);
  if (classMatch) {
    const series = classMatch[1].toUpperCase();
    const trimSeries = trim.match(new RegExp(`\\b(${series}\\d{2,3}[A-Z]?)\\b`, 'i'));
    if (trimSeries) return trimSeries[1].toUpperCase();
    return series;
  }

  if (model) return model;

  const fromTrim =
    trim.match(/\b(C\d{3}|E\d{3}|S\d{3})\b/i) ||
    trim.match(/\b(GLA|GLB|GLC|GLE|GLS|CLA|CLS|EQE|EQS|EQB|SL|AMG)\d{2,3}[A-Z]?\b/i);
  return fromTrim ? fromTrim[1].toUpperCase() : '';
}

export async function decodeVin(vin: string): Promise<VinDecodeResult> {
  const cleaned = vin.replace(/[^A-HJ-NPR-Z0-9]/gi, '').toUpperCase();
  if (cleaned.length !== 17) {
    return { vin: cleaned, year: '', make: '', model: '', engine: '', trim: '', bodyClass: '', driveType: '', fuelType: '', valid: false };
  }

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${cleaned}?format=json`;
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`NHTSA VIN API error: ${res.status}`);

  const data = await res.json();
  const results: Array<{ Variable: string; Value: string | null }> = data.Results || [];

  const year = pickValue(results, 'Model Year');
  const make = pickValue(results, 'Make');
  const rawModel = pickValue(results, 'Model');
  const trim = pickValue(results, 'Trim');
  const model = normalizeDecodedModel(rawModel, trim);
  const bodyClass = pickValue(results, 'Body Class');
  const driveType = pickValue(results, 'Drive Type');
  const fuelType = pickValue(results, 'Fuel Type - Primary');

  const displacement = pickValue(results, 'Displacement (L)');
  const cylinders = pickValue(results, 'Engine Number of Cylinders');
  const engineModel = pickValue(results, 'Engine Model');
  const engineParts = [displacement ? `${displacement}L` : '', cylinders ? `${cylinders}-cyl` : '', engineModel].filter(Boolean);
  const engine = engineParts.join(' ').trim();

  const hasUsableDecode = Boolean(year && make && (model || engine || trim));
  const valid = hasUsableDecode;

  return { vin: cleaned, year, make, model, engine, trim, bodyClass, driveType, fuelType, valid };
}