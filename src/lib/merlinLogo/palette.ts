/** Classic flat emblem — reliable PWA / Apple touch / favicon fallback. */
export const PLAIN_EMBLEM_PALETTE = {
  canvas: '#000000',
  ring: '#c4c9d0',
  star: '#d8dde3',
} as const;

/** Premium Mercedes-Benz emblem tokens — metallic star in circle on black. */
export const MERLIN_LOGO_PALETTE = {
  canvasTop: '#121218',
  canvasBottom: '#000000',
  ambientGlow: 'rgba(220, 228, 236, 0.12)',
  ringHighlight: '#f4f6f9',
  ringMid: '#b8bec8',
  ringShadow: '#5a626c',
  starHighlight: '#ffffff',
  starMid: '#d0d6de',
  starShadow: '#6e7884',
  specular: 'rgba(255, 255, 255, 0.55)',
} as const;

export const MERLIN_LOGO_VIEWBOX = 1024;
export const MERLIN_LOGO_CORNER_RADIUS = 0;

export const MERCEDES_EMBLEM_CENTER = 512;
export const MERCEDES_RING_RADIUS = 392;
export const MERCEDES_RING_STROKE = 20;