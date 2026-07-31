import 'server-only';

import {
  MORNING_WARMUP_KEY,
  NIGHTLY_REPORT_KEY,
  WINDOW_STATE_KEY,
} from '@/lib/selfHeal/config';
import { getRateLimitKv } from '@/lib/storage/workersKv';

export type SelfHealReportKind = 'nightly' | 'morning' | 'manual';

export interface SelfHealReport {
  kind: SelfHealReportKind;
  ranAt: string;
  durationMs: number;
  window: {
    timezone: string;
    localHour: number;
    inWindow: boolean;
    phase: string;
  };
  selfHealEnabled: boolean;
  healthOverall: string;
  criticalFails: string[];
  warnings: string[];
  warmup: {
    database: boolean;
    grok: boolean;
    objectStorage: boolean;
    kv: boolean;
  };
  analysis?: {
    summary: string;
    recommendations: string[];
    model?: string;
  } | null;
  errors: string[];
  ok: boolean;
}

async function putJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
  const kv = getRateLimitKv();
  if (!kv) return false;
  try {
    await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    return true;
  } catch {
    return false;
  }
}

async function getJson<T>(key: string): Promise<T | null> {
  const kv = getRateLimitKv();
  if (!kv) return null;
  try {
    const raw = await kv.get(key, 'text');
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveNightlyReport(report: SelfHealReport): Promise<boolean> {
  // Keep 7 days
  return putJson(NIGHTLY_REPORT_KEY, report, 60 * 60 * 24 * 7);
}

export async function saveMorningReport(report: SelfHealReport): Promise<boolean> {
  return putJson(MORNING_WARMUP_KEY, report, 60 * 60 * 24 * 3);
}

export async function loadLatestNightlyReport(): Promise<SelfHealReport | null> {
  return getJson<SelfHealReport>(NIGHTLY_REPORT_KEY);
}

export async function loadLatestMorningReport(): Promise<SelfHealReport | null> {
  return getJson<SelfHealReport>(MORNING_WARMUP_KEY);
}

export async function saveWindowState(state: Record<string, unknown>): Promise<boolean> {
  return putJson(WINDOW_STATE_KEY, { ...state, updatedAt: new Date().toISOString() }, 60 * 60 * 36);
}

export async function loadWindowState(): Promise<Record<string, unknown> | null> {
  return getJson(WINDOW_STATE_KEY);
}
