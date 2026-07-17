'use client';

import { useEffect, useState } from 'react';

const DESKTOP_MIN_WIDTH = 1024;

function readDesktopViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`).matches;
}

/** True when viewport is wide enough for the desktop companion layout. */
export function useDesktopCompanion(): boolean {
  const [isDesktop, setIsDesktop] = useState(readDesktopViewport);

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isDesktop;
}

export const DESKTOP_COMPANION_MIN_WIDTH = DESKTOP_MIN_WIDTH;