/** PWA + Apple touch icons — Apex National Platform emblem (see apex-logo-plain.svg). */
export const PWA_ICON_ENTRIES = [
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' as const },
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' as const },
  { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' as const },
  { src: '/apple-touch-icon-167.png', sizes: '167x167', type: 'image/png', purpose: 'any' as const },
  { src: '/apple-touch-icon-152.png', sizes: '152x152', type: 'image/png', purpose: 'any' as const },
  { src: '/apple-touch-icon-120.png', sizes: '120x120', type: 'image/png', purpose: 'any' as const },
  { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
  { src: '/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' as const },
] as const;

export const APPLE_TOUCH_ICON_LINKS = [
  { href: '/apple-touch-icon.png', sizes: '180x180' },
  { href: '/apple-touch-icon-precomposed.png', sizes: '180x180', precomposed: true },
  { href: '/apple-touch-icon-167.png', sizes: '167x167' },
  { href: '/apple-touch-icon-152.png', sizes: '152x152' },
  { href: '/apple-touch-icon-120.png', sizes: '120x120' },
] as const;