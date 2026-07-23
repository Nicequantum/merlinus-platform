'use client';

/**
 * Consistent desktop page frame for module dashboards.
 * Mobile keeps existing page padding; ≥1024px uses denser command-center content width.
 */
export function DesktopPageFrame({
  children,
  className = '',
  /** Extra wide content (Control Center, Hub) */
  wide = false,
}: {
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`desktop-page-frame ${wide ? 'desktop-page-frame-wide' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
