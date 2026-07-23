/**
 * Browser-safe TOTP helpers for in-app MFA enrollment.
 * Secret is generated client-side; server only verifies + stores on confirm.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Cryptographically random base32 secret (20 bytes → ~32 chars). */
export function generateTotpSecretClient(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32[(value << (5 - bits)) & 31];
  }
  return output;
}

export function buildOtpAuthUriClient(input: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = encodeURIComponent(input.issuer || 'Merlinus');
  const account = encodeURIComponent(input.accountName);
  return `otpauth://totp/${issuer}:${account}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

/** QR data URL via optional qrcode package (same dep as server). */
export async function buildTotpQrDataUrl(otpauthUrl: string): Promise<string | null> {
  try {
    const QRCode = (await import('qrcode')).default;
    return await QRCode.toDataURL(otpauthUrl, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
  } catch {
    return null;
  }
}

export async function beginInAppMfaEnrollment(accountName: string): Promise<{
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string | null;
}> {
  const secret = generateTotpSecretClient();
  const otpauthUrl = buildOtpAuthUriClient({ secret, accountName, issuer: 'Merlinus' });
  const qrCodeDataUrl = await buildTotpQrDataUrl(otpauthUrl);
  return { secret, otpauthUrl, qrCodeDataUrl };
}
