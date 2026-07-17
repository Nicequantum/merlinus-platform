/** Shared phone/VIN display helpers for department inbox (no Video MPI dependency). */

export function last8OfVin(vin: string): string | null {
  const cleaned = vin.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 8) return cleaned || null;
  return cleaned.slice(-8);
}

export function phoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return digits;
  return digits.slice(-4);
}
