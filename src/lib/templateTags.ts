const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'after', 'before', 'during', 'per', 'via',
  'customer', 'reported', 'reports', 'vehicle', 'mercedes', 'benz', 'repair', 'replaced', 'performed',
]);

const DOMAIN_KEYWORDS = [
  'mbux', 'airmatic', 'xentry', 'vin', 'cel', 'dtc', '48v', 'radar', 'injector', 'coolant', 'differential',
  'telematics', 'ramses', 'carplay', 'watchdog', 'strut', 'shock', 'driveline', 'cylinder', 'oil', 'pump',
  'converter', 'latch', 'display', 'wind', 'noise', 'lean', 'blind', 'spot', 'assist', 'service', 'maintenance',
];

export function buildTemplateTags(input: {
  title: string;
  category: string;
  finalText: string;
  lineDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  codes?: string[];
}): string[] {
  const tags = new Set<string>([input.category, 'user-saved', 'dealership-approved']);

  const titleSlug = input.title
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/[\s/,-]+/)
    .filter((w) => w.length > 2);
  titleSlug.forEach((w) => tags.add(w));

  const haystack = [
    input.title,
    input.lineDescription || '',
    input.vehicleMake || '',
    input.vehicleModel || '',
    input.finalText.slice(0, 1200),
    ...(input.codes || []),
  ]
    .join(' ')
    .toLowerCase();

  for (const keyword of DOMAIN_KEYWORDS) {
    if (haystack.includes(keyword)) tags.add(keyword.replace(/\s+/g, '-'));
  }

  for (const code of input.codes || []) {
    const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized) tags.add(normalized);
  }

  const tokens = haystack
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 3 && !STOP_WORDS.has(t));
  for (const token of tokens.slice(0, 8)) {
    tags.add(token);
  }

  return [...tags].slice(0, 24);
}