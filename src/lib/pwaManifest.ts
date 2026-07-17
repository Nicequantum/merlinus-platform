import type { MetadataRoute } from 'next';
import { PWA_ICON_ENTRIES } from '@/lib/pwaIcons';

export function getPwaManifest(): MetadataRoute.Manifest {
  return {
    name: 'Apex — National Warranty Platform',
    short_name: 'Apex',
    description:
      'Multi-brand dealership warranty story platform with audit-safe AI documentation.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#040408',
    background_color: '#040408',
    lang: 'en',
    icons: PWA_ICON_ENTRIES.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      purpose: icon.purpose,
    })),
  };
}

/** Inline manifest for layout metadata — avoids network fetch through Vercel SSO / deployment protection. */
export function getInlineManifestDataUri(): string {
  const json = JSON.stringify(getPwaManifest());
  return `data:application/manifest+json;base64,${Buffer.from(json, 'utf8').toString('base64')}`;
}