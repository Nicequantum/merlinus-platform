import { APEX_LOGO_VIEWBOX, APEX_PREMIUM_PALETTE } from './palette';

const VB = APEX_LOGO_VIEWBOX;
const P = APEX_PREMIUM_PALETTE;

function defIds(prefix: string) {
  return {
    canvas: `${prefix}-canvas`,
    silver: `${prefix}-silver`,
    cyan: `${prefix}-cyan`,
    glow: `${prefix}-glow`,
  };
}

/** Premium Apex emblem markup — shared by React SVG and static logo.svg export. */
export function renderApexPremiumEmblemMarkup(idPrefix = 'apex'): string {
  const id = defIds(idPrefix);

  return `<defs>
    <linearGradient id="${id.canvas}" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="${P.canvasTop}"/>
      <stop offset="100%" stop-color="${P.canvasBottom}"/>
    </linearGradient>
    <linearGradient id="${id.silver}" x1="18%" y1="8%" x2="82%" y2="92%">
      <stop offset="0%" stop-color="${P.silverHighlight}"/>
      <stop offset="38%" stop-color="${P.silverMid}"/>
      <stop offset="72%" stop-color="${P.silverShadow}"/>
      <stop offset="100%" stop-color="${P.silverEdge}"/>
    </linearGradient>
    <linearGradient id="${id.cyan}" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%" stop-color="${P.cyanDim}" stop-opacity="0.25"/>
      <stop offset="50%" stop-color="${P.cyan}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="${P.cyanDim}" stop-opacity="0.25"/>
    </linearGradient>
    <filter id="${id.glow}" x="-35%" y="-35%" width="170%" height="170%">
      <feDropShadow dx="0" dy="0" stdDeviation="22" flood-color="${P.glow}"/>
      <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="${VB}" height="${VB}" fill="url(#${id.canvas})"/>
  <path d="M 192 704 A 320 320 0 0 1 832 704" fill="none" stroke="url(#${id.cyan})" stroke-width="18" stroke-linecap="round" opacity="0.9"/>
  <line x1="512" y1="416" x2="512" y2="352" stroke="${P.cyan}" stroke-width="14" opacity="0.55"/>
  <line x1="320" y1="640" x2="272" y2="672" stroke="${P.cyan}" stroke-width="12" opacity="0.4"/>
  <line x1="704" y1="640" x2="752" y2="672" stroke="${P.cyan}" stroke-width="12" opacity="0.4"/>
  <path d="M 128 320 H 224 V 384 M 896 320 H 800 V 384 M 160 768 H 256 M 864 768 H 768" fill="none" stroke="${P.cyan}" stroke-width="10" stroke-linecap="round" opacity="0.35"/>
  <circle cx="224" cy="384" r="18" fill="${P.cyan}" opacity="0.5"/>
  <circle cx="800" cy="384" r="18" fill="${P.cyan}" opacity="0.5"/>
  <g filter="url(#${id.glow})">
    <path d="M 512 224 L 768 736 H 648 L 595 616 H 429 L 376 736 H 256 L 512 224 Z M 464 528 H 560 L 512 424 Z" fill="url(#${id.silver})" stroke="rgba(255,255,255,0.22)" stroke-width="6" stroke-linejoin="round"/>
  </g>
  <line x1="512" y1="672" x2="512" y2="480" stroke="${P.cyanBright}" stroke-width="14" stroke-linecap="round" opacity="0.7"/>
  <circle cx="512" cy="672" r="22" fill="${P.cyan}" opacity="0.85"/>`;
}
