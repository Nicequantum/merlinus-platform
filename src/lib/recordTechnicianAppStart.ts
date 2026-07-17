import { api } from '@/lib/api';

const SESSION_KEY = 'merlin_client_session_id';

export function getClientSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

let appStartRecorded = false;

/** Record one app-start log per browser session after Merlinus is ready. */
export async function recordTechnicianAppStart(payload: {
  role: string;
  todayRoCount: number;
  previousRoCount: number;
}): Promise<void> {
  if (appStartRecorded) return;
  appStartRecorded = true;

  try {
    await api.recordTechnicianAppStart({
      clientSessionId: getClientSessionId(),
      metadata: {
        role: payload.role as 'technician' | 'manager',
        todayRoCount: payload.todayRoCount,
        previousRoCount: payload.previousRoCount,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? '3.0.0',
      },
    });
  } catch {
    // Non-blocking — operational logging must not affect workflows.
  }
}