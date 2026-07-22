import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Manager Control Center', () => {
  it('summary API + builder exist', () => {
    assert.match(
      readSrc('src/app/api/manager/center/summary/route.ts'),
      /buildManagerCenterSummary/
    );
    assert.match(readSrc('src/app/api/manager/center/summary/route.ts'), /requireManager/);
    const builder = readSrc('src/lib/manager/centerSummary.ts');
    assert.match(builder, /runAuthenticatedHealthChecks/);
    assert.match(builder, /getDealershipJobHealthStats/);
    assert.match(builder, /listModuleStatuses/);
    assert.match(builder, /getDepartmentCustomization/);
  });

  it('UI shell has overview jobs voice modules health', () => {
    const ui = readSrc('src/components/manager/ManagerControlCenter.tsx');
    assert.match(ui, /overview/);
    assert.match(ui, /ManagerJobsMonitor/);
    assert.match(ui, /DepartmentTailoringPanel/);
    assert.match(ui, /getManagerCenterSummary/);
    assert.match(ui, /setModuleEnabled/);
  });

  it('page route and dashboard entry points', () => {
    assert.match(readSrc('src/app/manager/center/page.tsx'), /ManagerControlCenter/);
    assert.match(readSrc('src/components/ManagerDashboard.tsx'), /\/manager\/center/);
    assert.match(readSrc('src/lib/api.ts'), /getManagerCenterSummary/);
  });

  it('jobs monitor supports embedded mode', () => {
    assert.match(readSrc('src/components/ManagerJobsMonitor.tsx'), /embedded/);
  });

  it('SSE live route + hub + client hook', () => {
    const live = readSrc('src/app/api/manager/center/live/route.ts');
    assert.match(live, /text\/event-stream/);
    assert.match(live, /requireManager/);
    assert.match(live, /center\.heartbeat|HEARTBEAT_MS/);
    assert.match(live, /subscribeControlCenterEvents/);
    assert.match(live, /canAcceptControlCenterConnection/);

    const hub = readSrc('src/lib/manager/controlCenterHub.ts');
    assert.match(hub, /job:updated/);
    assert.match(hub, /health:changed/);
    assert.match(hub, /publishJobUpdatedToCenter/);
    assert.match(hub, /MAX_CONNECTIONS_PER_DEALERSHIP/);

    const hook = readSrc('src/hooks/useControlCenterLive.ts');
    assert.match(hook, /EventSource/);
    assert.match(hook, /visibilitychange/);
    assert.match(hook, /exponential|backoff|BASE_BACKOFF/);
    assert.match(hook, /fallback/);

    const ui = readSrc('src/components/manager/ManagerControlCenter.tsx');
    assert.match(ui, /useControlCenterLive/);
    assert.match(ui, /Live|Reconnecting|Polling/);
    assert.match(ui, /liveJobPatches|jobsLiveTick/);

    assert.match(readSrc('src/lib/aiJobs/service.ts'), /publishJobUpdatedToCenter|registerJobDealership/);
  });
});
