import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Vision pipeline mutex (C1/C4)', () => {
  it('useOcrProgress exposes independent ro_scan and xentry pipeline state', () => {
    const src = readSrc('src/hooks/useOcrProgress.ts');
    assert.match(src, /roScan/);
    assert.match(src, /xentry/);
    assert.match(src, /tryAcquirePipeline/);
    assert.match(src, /activePipelineRef/);
  });

  it('RO scan and Xentry hooks acquire the global pipeline mutex before processing', () => {
    const scan = readSrc('src/hooks/repairOrders/useROScan.ts');
    const xentry = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    assert.match(scan, /roScanPipeline\.tryAcquire/);
    assert.match(scan, /visionPipelineBlockedMessage/);
    assert.match(xentry, /xentryPipeline\.tryAcquire/);
    assert.match(xentry, /visionPipelineBlockedMessage/);
  });

  it('BenzTechAuthenticatedApp wires separate progress lanes for scan vs Xentry', () => {
    const shell = readSrc('src/components/BenzTechAuthenticatedApp.tsx');
    assert.match(shell, /ocr\.roScan\.isProcessing/);
    assert.match(shell, /ocr\.xentry\.isProcessing/);
    assert.equal(shell.includes('ocr.isProcessingOCR'), false);
  });

  it('Xentry cancel aborts in-flight Grok fetch via AbortController', () => {
    const xentry = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    const analysis = readSrc('src/hooks/repairOrders/roXentryAnalysis.ts');
    assert.match(xentry, /abortControllerRef/);
    assert.match(xentry, /abortControllerRef\.current\?\.abort/);
    assert.match(analysis, /signal/);
    assert.match(readSrc('src/lib/api.ts'), /signal\?: AbortSignal/);
  });

  it('diagnostics extract route writes critical audit after success', () => {
    const route = readSrc('src/app/api/diagnostics/extract/route.ts');
    assert.match(route, /writeDiagnosticExtractAudit/);
    assert.match(route, /extractStartedAt/);
  });

  it('Xentry auto-saves photos on capture and persists analysis at end (H2)', () => {
    const xentry = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    assert.match(xentry, /enqueuePersistAutoSavedImage/);
    assert.match(xentry, /persistChainByKeyRef/);
    assert.match(xentry, /await saveROImmediate\(persisted/);
    assert.match(xentry, /syncROView/);
  });

  it('Xentry flushPendingSave uses maxWaitMs timeout before batch (H1)', () => {
    const xentry = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    assert.match(xentry, /flushPendingSave:\s*\(options\?:\s*\{\s*maxWaitMs\?:\s*number\s*\}\)/);
    assert.match(xentry, /await flushPendingSave\(\{\s*maxWaitMs:\s*2_500\s*\}\)/);
  });

  it('navigation awaits flushPendingSave before changing views (H6)', () => {
    const src = readSrc('src/hooks/useRepairOrders.ts');
    assert.match(src, /const navigateView = useCallback\(\s*\n\s*async \(next: AppView\)/);
    assert.match(src, /await flushPendingSave\(\)/);
    assert.match(src, /const navigateToLine = useCallback/);
    assert.match(src, /flushPendingSave\(\{ maxWaitMs: 2_500 \}\)/);
    assert.match(src, /setView\(restoredLineId \? 'line' : 'ro'\)/);
    assert.match(src, /setView\('line'\)/);
  });

  it('view guard blocks redirect while Xentry batch is in flight (H5)', () => {
    const src = readSrc('src/hooks/useRepairOrders.ts');
    assert.match(src, /scanInFlightRef\.current \|\| xentryInFlightRef\.current/);
  });
});