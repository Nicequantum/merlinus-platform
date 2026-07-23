/**
 * Desktop companion layout preferences (localStorage, per browser profile).
 */
export type DesktopLayoutPrefs = {
  /** Show RO list rail beside detail on wide screens */
  splitRoList: boolean;
  /** Show live activity sidebar */
  showActivity: boolean;
  /** Activity sidebar width px (clamped) */
  activityWidthPx: number;
  /** Compact left nav */
  collapsedNav: boolean;
};

const KEY = 'merlin_desktop_layout_v1';

const DEFAULTS: DesktopLayoutPrefs = {
  splitRoList: true,
  showActivity: true,
  activityWidthPx: 300,
  collapsedNav: false,
};

export function loadDesktopLayoutPrefs(): DesktopLayoutPrefs {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<DesktopLayoutPrefs>;
    return {
      splitRoList: parsed.splitRoList ?? DEFAULTS.splitRoList,
      showActivity: parsed.showActivity ?? DEFAULTS.showActivity,
      activityWidthPx: Math.min(420, Math.max(240, Number(parsed.activityWidthPx) || DEFAULTS.activityWidthPx)),
      collapsedNav: parsed.collapsedNav ?? DEFAULTS.collapsedNav,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveDesktopLayoutPrefs(prefs: DesktopLayoutPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // quota / private mode
  }
}

export function buildDesktopDeepLink(opts: {
  origin?: string;
  roId?: string | null;
  lineId?: string | null;
  view?: string | null;
}): string {
  const origin =
    opts.origin ||
    (typeof window !== 'undefined' ? window.location.origin : '');
  const url = new URL(origin || 'https://localhost');
  if (opts.view) url.searchParams.set('view', opts.view);
  if (opts.roId) url.searchParams.set('ro', opts.roId);
  if (opts.lineId) url.searchParams.set('line', opts.lineId);
  url.searchParams.set('desktop', '1');
  return url.toString();
}

export function parseDesktopDeepLink(
  search: string
): { roId: string | null; lineId: string | null; view: string | null; forceDesktop: boolean } {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  return {
    roId: params.get('ro')?.trim() || null,
    lineId: params.get('line')?.trim() || null,
    view: params.get('view')?.trim() || null,
    forceDesktop: params.get('desktop') === '1',
  };
}
