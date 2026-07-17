import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';
import { AppProviders } from '@/components/AppProviders';
import { getInlineManifestDataUri } from '@/lib/pwaManifest';
import { APPLE_TOUCH_ICON_LINKS } from '@/lib/pwaIcons';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Apex',
  description: 'Multi-brand dealership warranty story platform with audit-safe AI documentation.',
  manifest: getInlineManifestDataUri(),
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: APPLE_TOUCH_ICON_LINKS.filter((link) => !('precomposed' in link)).map((link) => ({
      url: link.href,
      sizes: link.sizes,
      type: 'image/png',
    })),
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Apex',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#040408',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {APPLE_TOUCH_ICON_LINKS.map((link) =>
          'precomposed' in link ? (
            <link
              key={link.href}
              rel="apple-touch-icon-precomposed"
              href={link.href}
              sizes={link.sizes}
            />
          ) : (
            <link key={link.href} rel="apple-touch-icon" href={link.href} sizes={link.sizes} />
          )
        )}
      </head>
      <body className={inter.className}>
        <AppProviders>{children}</AppProviders>
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: '#14141a',
              color: '#f2f3f6',
              border: '1px solid rgba(180, 186, 198, 0.18)',
              borderRadius: '14px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
            },
          }}
        />
      </body>
    </html>
  );
}