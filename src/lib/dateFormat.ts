/** Centralized date/time formatting — use USAGE_TIMEZONE on server; locale-aware in UI. */

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

const DEFAULT_DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  ...DEFAULT_DATE_OPTS,
  hour: 'numeric',
  minute: '2-digit',
};

export function formatDisplayDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTS
): string {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, options);
  } catch {
    return '';
  }
}

export function formatDisplayDateTime(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATETIME_OPTS
): string {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, options);
  } catch {
    return '';
  }
}