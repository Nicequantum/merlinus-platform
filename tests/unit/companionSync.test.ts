import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('desktop companion sync', () => {
  it('keeps SSE connection stable without handler-driven reconnects', () => {
    const hook = readSrc('src/hooks/useCompanionSync.ts');
    assert.ok(hook.includes('handleEventRef'));
    assert.ok(hook.includes('handlersRef'));
    assert.ok(hook.includes('connectionGenerationRef'));
    assert.ok(hook.includes('}, [enabled]);'));
    assert.equal(hook.includes('}, [enabled, handleEvent]);'), false);
  });

  it('deduplicates status publishes and surfaces publish failures', () => {
    const hook = readSrc('src/hooks/useCompanionSync.ts');
    assert.ok(hook.includes('lastPublishedStatusRef'));
    assert.ok(hook.includes('if (!response.ok)'));
  });

  it('configures long-lived companion SSE route with rate limits', () => {
    const route = readSrc('src/app/api/companion/stream/route.ts');
    assert.ok(route.includes('export const maxDuration = 300'));
    assert.ok(route.includes("'X-Accel-Buffering': 'no'"));
    // Phase 6.3 — companion routes are rate-limited (no skipRateLimit).
    assert.ok(route.includes('RATE_LIMITS.companion'));
    assert.equal(route.includes('skipRateLimit: true'), false);
  });

  it('uses stable publish callbacks in CompanionSyncBridge effects', () => {
    const bridge = readSrc('src/components/CompanionSyncBridge.tsx');
    assert.ok(bridge.includes('publishNavigation'));
    assert.ok(bridge.includes('publishStatus'));
    assert.equal(bridge.includes('[companion, enabled'), false);
  });

  it('mirrors audit and certification SSE events into live activity', () => {
    const hook = readSrc('src/hooks/useCompanionSync.ts');
    assert.ok(hook.includes('Audit complete (score:'));
    assert.ok(hook.includes("'Story certified'"));
    assert.ok(hook.includes("event.type === 'navigation' && event.sourceDeviceId === deviceId"));
  });

  it('replays recent companion events when SSE connects', () => {
    const route = readSrc('src/app/api/companion/stream/route.ts');
    assert.ok(route.includes('KV_REPLAY_WINDOW_MS'));
    assert.ok(route.includes('drainKvCompanionEvents(technicianId, lastKvPollAt)'));
  });

  it('ensures RO and line context before applying companion story events', () => {
    const bridge = readSrc('src/components/CompanionSyncBridge.tsx');
    assert.ok(bridge.includes('ensureCompanionLineContext'));
    assert.ok(bridge.includes('await ensureCompanionLineContext(repairOrderId, lineId)'));
    assert.ok(bridge.includes('ensureRepairOrderOpen'));
  });

  it('uses full role on desktop (publish+subscribe) and polls KV as SSE fallback', () => {
    const role = readSrc('src/lib/companionSyncRole.ts');
    const hook = readSrc('src/hooks/useCompanionSync.ts');
    const pollRoute = readSrc('src/app/api/companion/poll/route.ts');
    assert.ok(role.includes("return isDesktopViewport ? 'full' : 'publisher'"));
    assert.ok(hook.includes('/api/companion/poll'));
    assert.ok(hook.includes('canAutoPublish'));
    assert.ok(hook.includes('liveTechnicianSession'));
    assert.ok(pollRoute.includes('drainKvCompanionEvents'));
  });

  it('waits for in-flight openROById before companion handlers apply state', () => {
    const roHook = readSrc('src/hooks/useRepairOrders.ts');
    assert.ok(roHook.includes('openingROPromisesRef'));
    assert.ok(roHook.includes('ensureRepairOrderOpen'));
    assert.ok(roHook.includes('companionRevision'));
  });

  it('polls companion events for all clients and snapshots RO state on desktop', () => {
    const hook = readSrc('src/hooks/useCompanionSync.ts');
    const bridge = readSrc('src/components/CompanionSyncBridge.tsx');
    const desktop = readSrc('src/hooks/useDesktopCompanion.ts');
    assert.ok(hook.includes('}, [enabled]);'));
    assert.equal(hook.includes('}, [enabled, shouldPoll]);'), false);
    assert.ok(hook.includes('recordActivity'));
    assert.ok(bridge.includes('syncCompanionRepairOrderSnapshot'));
    assert.ok(desktop.includes('readDesktopViewport'));
  });

  it('merges companion story state from active line and persisted audit fields', () => {
    const layout = readSrc('src/components/desktop/DesktopCompanionLayout.tsx');
    const shell = readSrc('src/components/desktop/DesktopCommandShell.tsx');
    const state = readSrc('src/lib/companionLineStoryState.ts');
    assert.ok(layout.includes('deriveCompanionLineStoryState'));
    assert.ok(layout.includes('activeLineId'));
    assert.ok(shell.includes('LiveTechnicianSessionBadge') || shell.includes('liveTechnicianSession'));
    assert.ok(shell.includes('benz-command-shell'));
    assert.ok(state.includes('resolveQualityForLine'));
    assert.ok(state.includes('resolveCertificationForLine'));
  });

  it('navigates desktop companion to line view atomically and clears line on RO back', () => {
    const roHook = readSrc('src/hooks/useRepairOrders.ts');
    const bridge = readSrc('src/components/CompanionSyncBridge.tsx');
    const app = readSrc('src/components/BenzTechAuthenticatedApp.tsx');
    assert.ok(roHook.includes('const navigateToRO = useCallback'));
    assert.ok(roHook.includes("setView('line')"));
    assert.ok(roHook.includes('setCurrentLineId(null)'));
    assert.ok(roHook.includes("setView(restoredLineId ? 'line' : 'ro')"));
    assert.ok(bridge.includes('navigateToRO'));
    assert.ok(app.includes('navigateToRO'));
    assert.ok(app.includes('onOpenLine={ro.navigateToLine}'));
    assert.ok(app.includes('DesktopCommandShell'));
    assert.ok(app.includes('useDesktopDeepLink'));
    assert.equal(bridge.includes("setView('ro')"), false);
  });

  it('desktop command shell + deep links + diagnostic parity', () => {
    const shell = readSrc('src/components/desktop/DesktopCommandShell.tsx');
    const deep = readSrc('src/lib/desktopLayoutPrefs.ts');
    const snapshot = readSrc('src/lib/companionSnapshot.ts');
    const lightbox = readSrc('src/components/ImageLightbox.tsx');
    const roScan = readSrc('src/hooks/repairOrders/useROScan.ts');
    const openBtn = readSrc('src/components/desktop/OpenDesktopCompanionButton.tsx');
    assert.ok(shell.includes('benz-command-nav'));
    assert.ok(shell.includes('Ctrl+'));
    assert.ok(deep.includes('buildDesktopDeepLink'));
    assert.ok(deep.includes('parseDesktopDeepLink'));
    assert.ok(openBtn.includes('Open in Desktop Companion'));
    assert.ok(snapshot.includes('photosUpdated'));
    assert.ok(lightbox.includes('goPrev'));
    assert.ok(lightbox.includes('ZoomIn'));
    assert.ok(roScan.includes('openImageFilePicker'));
  });

  it('does not overwrite companion line story when applying remote audit quality', () => {
    const roHook = readSrc('src/hooks/useRepairOrders.ts');
    assert.equal(roHook.includes('next.warrantyStory = scoredStory'), false);
    assert.ok(roHook.includes('storyQualityAudit: quality'));
  });

  it('scores warranty stories with full-structure retry instead of throwing on parse failure', () => {
    const grok = readSrc('src/lib/grok.ts');
    const prompts = readSrc('src/prompts/storyQuality.ts');
    const mercedesQuality = readSrc('src/prompts/story/brands/mercedes/quality/scoreCriteria.ts');
    const workflow = readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts');
    assert.ok(grok.includes('getStoryScoreRetrySystemPrompt'));
    assert.ok(grok.includes('isStoryQualityDetailMissing'));
    assert.ok(grok.includes('grok.story.score_retry'));
    assert.ok(mercedesQuality.includes('strengths: 2-4 specific strengths'));
    assert.ok(mercedesQuality.includes('auditRisks: 1-4 critical MI 2.0 rejection risks'));
    assert.ok(mercedesQuality.includes('Submitted story is authoritative'));
    // Score user message credits post-audit / Add Tech Details story text (see buildStoryScoreUserMessage).
    assert.ok(prompts.includes('authoritative — score THIS text as submitted'));
    assert.ok(prompts.includes('post-audit') || prompts.includes('Add Tech Details'));
    assert.ok(workflow.includes('scoredAgainstStory: storyText'));
    assert.equal(grok.includes("throw new Error('AI quality score returned unreadable JSON.')"), false);
  });
});