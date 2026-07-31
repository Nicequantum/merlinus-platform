/**
 * In-app pilot / platform readiness for national owner onboard.
 *
 * Replaces shell-only gates (npm run verify:p0, etc.) with runtime checks the
 * Cloudflare Worker can execute when an owner clicks "Run readiness checks".
 *
 * CI scripts remain the source of truth for unit/integration tests; this layer
 * answers: "Is this live deployment safe to provision a pilot rooftop?"
 */
import 'server-only';

import { isHttpProvisionEnabled } from '@/lib/apex/provisionDealer';
import { isApexPlatformMode } from '@/lib/platformMode';
import {
  aggregateAuthenticatedHealthStatus,
  buildHealthServicesPayload,
  type DependencyCheck,
  type DependencyStatus,
  type HealthServiceStatus,
  runAuthenticatedHealthChecks,
} from '@/lib/healthChecks';
import { PROVISION_DEFAULT_MODULE_IDS, DEFERRED_MODULE_IDS } from '@/lib/modules/catalog';
import { prisma } from '@/lib/db';
import { isProductionEnv } from '@/lib/rate-limit';

export type ReadinessSeverity = 'pass' | 'warn' | 'fail' | 'info';

export interface ReadinessCheckItem {
  id: string;
  title: string;
  status: ReadinessSeverity;
  /** Blocks provision when true and status is fail. */
  blocksProvision: boolean;
  detail: string;
  /** What the owner should do next (no secrets). */
  action?: string;
}

export interface PlatformReadinessResult {
  evaluatedAt: string;
  canProvision: boolean;
  overall: 'ready' | 'ready_with_warnings' | 'blocked';
  summary: string;
  checks: ReadinessCheckItem[];
  services: Record<string, HealthServiceStatus>;
  /** Human post-provision steps (not auto-runnable). */
  afterProvisionSteps: Array<{ id: string; title: string; detail: string }>;
  /** Honest note: CI matrix/tests stay outside the Worker. */
  ciNote: string;
}

export interface RooftopReadinessResult {
  dealershipId: string;
  rooftopName: string;
  evaluatedAt: string;
  overall: 'ready' | 'ready_with_warnings' | 'blocked';
  checks: ReadinessCheckItem[];
}

function depToSeverity(status: DependencyStatus, critical: boolean): ReadinessSeverity {
  if (status === 'ok') return 'pass';
  if (status === 'warn') return 'warn';
  return critical ? 'fail' : 'warn';
}

function mapHealth(
  id: string,
  title: string,
  check: DependencyCheck | undefined,
  blocksProvision: boolean
): ReadinessCheckItem {
  const status = check?.status ?? 'error';
  const severity = depToSeverity(status, blocksProvision);
  return {
    id,
    title,
    status: severity,
    blocksProvision: blocksProvision && severity === 'fail',
    detail: check?.operatorMessage || check?.detail || `status=${status}`,
    action:
      severity === 'fail'
        ? 'Fix this dependency before onboarding pilots (see Control Center Health).'
        : severity === 'warn'
          ? 'Review before go-live; provision may still proceed.'
          : undefined,
  };
}

/**
 * Platform-wide readiness for national owner provision (no dealership context required).
 */
export async function evaluatePlatformReadiness(): Promise<PlatformReadinessResult> {
  const checks: ReadinessCheckItem[] = [];
  const production = isProductionEnv();

  // Mode + HTTP provision flag
  if (!isApexPlatformMode()) {
    checks.push({
      id: 'platform_mode',
      title: 'Apex platform mode',
      status: 'fail',
      blocksProvision: true,
      detail: 'PLATFORM_MODE is not apex — HTTP onboard is unavailable.',
      action: 'Set PLATFORM_MODE=apex on the Worker.',
    });
  } else {
    checks.push({
      id: 'platform_mode',
      title: 'Apex platform mode',
      status: 'pass',
      blocksProvision: false,
      detail: 'Apex platform mode is active.',
    });
  }

  if (!isHttpProvisionEnabled()) {
    checks.push({
      id: 'http_provision',
      title: 'HTTP onboard enabled',
      status: 'fail',
      blocksProvision: true,
      detail: 'APEX_ALLOW_HTTP_PROVISION is not true.',
      action: 'Set APEX_ALLOW_HTTP_PROVISION=true on the Worker for national onboard.',
    });
  } else {
    checks.push({
      id: 'http_provision',
      title: 'HTTP onboard enabled',
      status: 'pass',
      blocksProvision: false,
      detail: 'Owner can create rooftops from the console.',
    });
  }

  // Live dependency matrix (same probes as Manager Health)
  const health = await runAuthenticatedHealthChecks({ dealershipId: null });
  const services = buildHealthServicesPayload(health);
  const healthAgg = aggregateAuthenticatedHealthStatus(health);

  checks.push(mapHealth('database', 'Database (D1)', health.database, true));
  checks.push(mapHealth('kv', 'KV (sessions & rate limits)', health.kv, production));
  checks.push(mapHealth('encryption', 'Encryption keys', health.encryption, true));
  checks.push(
    mapHealth('owner_seed_secrets', 'Seed secrets hygiene', health.ownerSeedSecrets, production)
  );
  checks.push(mapHealth('object_storage', 'Object storage (R2)', health.objectStorage, false));
  checks.push(mapHealth('ai_jobs_queue', 'AI jobs queue', health.aiJobsQueue, production));
  checks.push(mapHealth('grok', 'Grok API connectivity', health.grok, false));
  checks.push(mapHealth('mfa_policy', 'MFA policy posture', health.mfaPolicy, false));
  checks.push(mapHealth('maintenance', 'Maintenance mode', health.maintenance, true));

  // Commercial defaults: no paid modules on by default
  if (PROVISION_DEFAULT_MODULE_IDS.length === 0) {
    checks.push({
      id: 'module_defaults',
      title: 'New rooftops start modules OFF',
      status: 'pass',
      blocksProvision: false,
      detail: 'Provision defaults are empty — core story only until you enable SKUs.',
    });
  } else {
    checks.push({
      id: 'module_defaults',
      title: 'New rooftops start modules OFF',
      status: 'warn',
      blocksProvision: false,
      detail: `Provision would auto-enable: ${PROVISION_DEFAULT_MODULE_IDS.join(', ')}`,
      action: 'Confirm commercial defaults before pilot.',
    });
  }

  checks.push({
    id: 'cdk_deferred',
    title: 'Live CDK sync deferred',
    status: 'info',
    blocksProvision: false,
    detail: `Deferred modules: ${DEFERRED_MODULE_IDS.join(', ') || 'none'}. Clipboard paste remains for CDK.`,
  });

  // MFA enforce guidance
  const mfaEnforce =
    process.env.MERLIN_MFA_ENFORCE === 'true' || process.env.MERLIN_MFA_ENFORCE === '1';
  if (mfaEnforce) {
    checks.push({
      id: 'mfa_enforce',
      title: 'MFA enforce flag',
      status: 'pass',
      blocksProvision: false,
      detail: 'MERLIN_MFA_ENFORCE is on — elevated roles must enroll.',
    });
  } else {
    checks.push({
      id: 'mfa_enforce',
      title: 'MFA enforce flag',
      status: 'warn',
      blocksProvision: false,
      detail: 'MERLIN_MFA_ENFORCE is off — enroll managers, then turn enforce on after pilot staff are ready.',
      action: 'After managers enroll TOTP, set MERLIN_MFA_ENFORCE=true.',
    });
  }

  if (healthAgg === 'error') {
    checks.push({
      id: 'health_aggregate',
      title: 'Critical health aggregate',
      status: 'fail',
      blocksProvision: true,
      detail: 'One or more critical services are red.',
      action: 'Open Manager Health or fix Worker bindings before provision.',
    });
  }

  const blockingFails = checks.filter((c) => c.blocksProvision && c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  const canProvision = blockingFails.length === 0;

  let overall: PlatformReadinessResult['overall'] = 'ready';
  if (!canProvision) overall = 'blocked';
  else if (warns.length > 0) overall = 'ready_with_warnings';

  const summary = !canProvision
    ? `Blocked: ${blockingFails.map((c) => c.title).join(', ')}`
    : warns.length > 0
      ? `Ready with ${warns.length} warning(s) — review before pilot traffic.`
      : 'Platform ready to onboard a pilot rooftop.';

  return {
    evaluatedAt: new Date().toISOString(),
    canProvision,
    overall,
    summary,
    checks,
    services,
    afterProvisionSteps: [
      {
        id: 'share_credentials',
        title: 'Share temporary passwords securely',
        detail: 'Never put temp passwords in email subject lines or group chats.',
      },
      {
        id: 'manager_password',
        title: 'Manager first login + password change',
        detail: 'Manager signs in with D7 + temp password and sets a permanent password.',
      },
      {
        id: 'manager_mfa',
        title: 'Manager MFA enrollment',
        detail: 'Every manager/owner enrolls TOTP before you set MERLIN_MFA_ENFORCE=true.',
      },
      {
        id: 'modules_off',
        title: 'Keep non-core modules off',
        detail: 'Pilot uses core warranty story only unless contracted SKUs are journey-tested.',
      },
      {
        id: 'golden_path',
        title: 'Golden path (2 technicians)',
        detail: 'RO → notes → evidence → generate → certify → Copy for CDK / PDF.',
      },
      {
        id: 'health_watch',
        title: 'Watch Health + AI queue first shop day',
        detail: 'KV, database, and aiJobsQueue must stay non-critical under multi-tech load.',
      },
    ],
    ciNote:
      'Unit/integration tests (npm test, test:isolation, matrix:check) run in CI/deploy pipeline — not inside this live Worker. This screen verifies live platform health and provision gates.',
  };
}

/**
 * Post-provision rooftop-specific readiness (modules off, manager password gate).
 */
export async function evaluateRooftopReadiness(
  dealershipId: string
): Promise<RooftopReadinessResult | null> {
  const dealership = await prisma.dealership.findUnique({
    where: { id: dealershipId },
    select: { id: true, name: true },
  });
  if (!dealership) return null;

  const checks: ReadinessCheckItem[] = [];

  const enabledModules = await prisma.dealershipModule.findMany({
    where: { dealershipId, enabled: true },
    select: { moduleId: true },
  });
  if (enabledModules.length === 0) {
    checks.push({
      id: 'modules_off',
      title: 'Product modules off (core only)',
      status: 'pass',
      blocksProvision: false,
      detail: 'No paid SKUs enabled — correct for first pilot day.',
    });
  } else {
    checks.push({
      id: 'modules_off',
      title: 'Product modules off (core only)',
      status: 'warn',
      blocksProvision: false,
      detail: `Enabled: ${enabledModules.map((m) => m.moduleId).join(', ')}`,
      action: 'Disable unneeded SKUs in Manager → Modules for a clean pilot.',
    });
  }

  const managers = await prisma.technician.findMany({
    where: {
      dealershipId,
      role: 'manager',
      deletedAt: null,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      mustChangePassword: true,
      mfaEnabled: true,
      role: true,
    },
  });

  if (managers.length === 0) {
    checks.push({
      id: 'manager_present',
      title: 'Service manager account',
      status: 'fail',
      blocksProvision: true,
      detail: 'No active manager found on this rooftop.',
    });
  } else {
    checks.push({
      id: 'manager_present',
      title: 'Service manager account',
      status: 'pass',
      blocksProvision: false,
      detail: `${managers.length} manager account(s).`,

    });
  }

  const pendingPw = managers.filter((m) => m.mustChangePassword);
  if (pendingPw.length > 0) {
    checks.push({
      id: 'password_change',
      title: 'Manager password change',
      status: 'warn',
      blocksProvision: false,
      detail: `${pendingPw.length} elevated account(s) still on temporary password.`,
      action: 'Have them sign in and set a permanent password before shop floor use.',
    });
  } else if (managers.length > 0) {
    checks.push({
      id: 'password_change',
      title: 'Manager password change',
      status: 'pass',
      blocksProvision: false,
      detail: 'Elevated accounts have completed password change.',
    });
  }

  const mfaEnrolled = managers.filter((m) => m.mfaEnabled).length;
  if (managers.length > 0 && mfaEnrolled < managers.length) {
    checks.push({
      id: 'mfa_enrolled',
      title: 'Manager MFA enrollment',
      status: 'warn',
      blocksProvision: false,
      detail: `${mfaEnrolled}/${managers.length} elevated accounts have MFA enrolled.`,
      action: 'Complete MFA enrollment in Settings before enabling MERLIN_MFA_ENFORCE.',
    });
  } else if (managers.length > 0) {
    checks.push({
      id: 'mfa_enrolled',
      title: 'Manager MFA enrollment',
      status: 'pass',
      blocksProvision: false,
      detail: 'All elevated accounts have MFA enrolled.',
    });
  }

  // Light health re-check scoped to rooftop (module-aware Twilio etc.)
  const health = await runAuthenticatedHealthChecks({ dealershipId });
  checks.push(mapHealth('kv_rooftop', 'KV', health.kv, isProductionEnv()));
  checks.push(mapHealth('db_rooftop', 'Database', health.database, true));
  checks.push(mapHealth('queue_rooftop', 'AI queue', health.aiJobsQueue, false));

  const blocking = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');
  let overall: RooftopReadinessResult['overall'] = 'ready';
  if (blocking.length) overall = 'blocked';
  else if (warns.length) overall = 'ready_with_warnings';

  return {
    dealershipId: dealership.id,
    rooftopName: dealership.name,
    evaluatedAt: new Date().toISOString(),
    overall,
    checks,
  };
}

/** Whether provision API should hard-block when platform readiness fails. */
export function isProvisionReadinessGateEnabled(): boolean {
  // Default ON. Break-glass: APEX_PROVISION_SKIP_READINESS=true
  return process.env.APEX_PROVISION_SKIP_READINESS?.trim() !== 'true';
}
