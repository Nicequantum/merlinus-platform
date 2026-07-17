import { z } from 'zod';

/** Mercedes-Benz technician D7 identifier (e.g. D7HARRIH). */
const D7_PATTERN = /^D7[A-Z0-9]{3,14}$/;

export function normalizeD7Number(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidD7Number(value: string): boolean {
  return D7_PATTERN.test(normalizeD7Number(value));
}

export function internalEmailForD7(d7Number: string): string {
  return `${normalizeD7Number(d7Number).toLowerCase()}@benz-tech.local`;
}

export const d7NumberField = z
  .string()
  .min(5)
  .max(16)
  .transform(normalizeD7Number)
  .refine(isValidD7Number, {
    message: 'D7 number must start with D7 followed by letters or numbers (e.g. D7HARRIH).',
  });