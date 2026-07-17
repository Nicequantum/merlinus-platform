import { APEX_LOGO_VIEWBOX, APEX_PLAIN_PALETTE } from './palette';

const VB = APEX_LOGO_VIEWBOX;
const P = APEX_PLAIN_PALETTE;

/**
 * Flat Apex "A" emblem — reliable for PWA / Apple touch / favicon rasterization.
 * Geometry matches ApexLogoMark (viewBox 0–64 scaled to 1024).
 */
export function renderApexPlainEmblemMarkup(): string {
  // Scale factor 1024/64 = 16
  return `<rect width="${VB}" height="${VB}" fill="${P.canvas}"/>
  <path d="M 192 704 A 320 320 0 0 1 832 704" fill="none" stroke="${P.cyan}" stroke-width="18" stroke-linecap="round" opacity="0.85"/>
  <line x1="512" y1="416" x2="512" y2="352" stroke="${P.cyan}" stroke-width="14" opacity="0.6"/>
  <line x1="320" y1="640" x2="272" y2="672" stroke="${P.cyan}" stroke-width="12" opacity="0.45"/>
  <line x1="704" y1="640" x2="752" y2="672" stroke="${P.cyan}" stroke-width="12" opacity="0.45"/>
  <path d="M 128 320 H 224 V 384 M 896 320 H 800 V 384 M 160 768 H 256 M 864 768 H 768" fill="none" stroke="${P.cyan}" stroke-width="10" stroke-linecap="round" opacity="0.4"/>
  <circle cx="224" cy="384" r="18" fill="${P.cyan}" opacity="0.55"/>
  <circle cx="800" cy="384" r="18" fill="${P.cyan}" opacity="0.55"/>
  <path d="M 512 224 L 768 736 H 648 L 595 616 H 429 L 376 736 H 256 L 512 224 Z M 464 528 H 560 L 512 424 Z" fill="${P.silverBright}" stroke="${P.silver}" stroke-width="8" stroke-linejoin="round"/>
  <line x1="512" y1="672" x2="512" y2="480" stroke="${P.cyan}" stroke-width="14" stroke-linecap="round" opacity="0.75"/>
  <circle cx="512" cy="672" r="22" fill="${P.cyan}" opacity="0.9"/>`;
}
