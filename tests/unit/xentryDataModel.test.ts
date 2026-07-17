import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendXentryImage,
  applyXentrySnapshot,
  readXentryBaseline,
  readXentryViewState,
  targetKey,
} from '@/hooks/repairOrders/xentryDataModel';
import type { RepairOrder } from '@/types';
import { emptyExtractedData } from '@/utils/diagnosticParser';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function sampleRO(): RepairOrder {
  return {
    id: 'ro-1',
    roNumber: '482910',
    vehicle: {
      vin: 'WDDWF4KB0FR123456',
      year: '2022',
      make: 'Mercedes-Benz',
      model: 'GLE 350',
      mileageIn: '1000',
      mileageOut: '1005',
    },
    customer: { name: 'Jane Customer' },
    complaints: ['Check engine light'],
    xentryImages: [{ id: 'ro-img-1', pathname: 'benz-tech/dealer/ro1.jpg', url: '/api/images?p=ro1', name: 'ro.jpg' }],
    xentryOcrTexts: ['RO-level OCR'],
    repairLines: [
      {
        id: 'line-1',
        lineNumber: 1,
        description: 'Engine diag',
        customerConcern: 'CEL on',
        technicianNotes: '',
        xentryImages: [{ id: 'line-img-1', pathname: 'benz-tech/dealer/line1.jpg', url: '/api/images?p=line1', name: 'line.jpg' }],
        xentryOcrTexts: ['Line-level OCR'],
        extractedData: { ...emptyExtractedData(), codes: ['P0300'] },
        isCustomerPay: false,
      },
      {
        id: 'line-2',
        lineNumber: 2,
        description: 'Brakes',
        customerConcern: 'Noise',
        technicianNotes: '',
        xentryImages: [],
        isCustomerPay: false,
      },
    ],
  };
}

describe('Xentry data model (M1/M3)', () => {
  it('targetKey distinguishes line vs RO queues', () => {
    assert.equal(targetKey({ scope: 'line', lineId: 'line-1' }), 'line:line-1');
    assert.equal(targetKey({ scope: 'ro', roId: 'ro-1' }), 'ro:ro-1');
  });

  it('appendXentryImage stacks multiple photos without dropping prior images', () => {
    const ro = sampleRO();
    const target = { scope: 'line' as const, lineId: 'line-1' };
    const first = {
      id: 'line-img-2',
      pathname: 'benz-tech/dealer/line2.jpg',
      url: '/api/images?p=line2',
      name: 'line2.jpg',
    };
    const second = {
      id: 'line-img-3',
      pathname: 'benz-tech/dealer/line3.jpg',
      url: '/api/images?p=line3',
      name: 'line3.jpg',
    };

    const afterFirst = appendXentryImage(ro, target, first);
    assert.equal(readXentryBaseline(afterFirst, target).images.length, 2);
    const afterSecond = appendXentryImage(afterFirst, target, second);
    const images = readXentryBaseline(afterSecond, target).images;
    assert.equal(images.length, 3);
    assert.deepEqual(
      images.map((img) => img.id),
      ['line-img-1', 'line-img-2', 'line-img-3']
    );
    assert.equal(appendXentryImage(afterSecond, target, second).repairLines[0]?.xentryImages?.length, 3);
  });

  it('line scope reads and writes only the target repair line', () => {
    const ro = sampleRO();
    const target = { scope: 'line' as const, lineId: 'line-1' };
    const baseline = readXentryBaseline(ro, target);

    assert.equal(baseline.images.length, 1);
    assert.equal(baseline.images[0]?.id, 'line-img-1');
    assert.deepEqual(baseline.extracted.codes, ['P0300']);

    const updated = applyXentrySnapshot(ro, target, [], [], emptyExtractedData());
    assert.deepEqual(updated.repairLines[0]?.xentryImages, []);
    assert.equal(updated.repairLines[1]?.xentryImages?.length, 0);
    assert.deepEqual(updated.xentryImages?.length, 1);
  });

  it('RO scope reads RO images/OCR and line-1 extracted data only', () => {
    const ro = sampleRO();
    const target = { scope: 'ro' as const, roId: 'ro-1' };
    const baseline = readXentryBaseline(ro, target);

    assert.equal(baseline.images[0]?.id, 'ro-img-1');
    assert.equal(baseline.ocrTexts[0], 'RO-level OCR');
    assert.deepEqual(baseline.extracted.codes, ['P0300']);

    const view = readXentryViewState(ro, target);
    assert.equal(view.images[0]?.id, 'ro-img-1');
    assert.deepEqual(view.extracted?.codes, ['P0300']);
  });

  it('RO scope apply does not mirror images/OCR onto line 1 (M1)', () => {
    const ro = sampleRO();
    const target = { scope: 'ro' as const, roId: 'ro-1' };
    const newImage = {
      id: 'ro-img-2',
      pathname: 'benz-tech/dealer/ro2.jpg',
      url: '/api/images?p=ro2',
      name: 'ro2.jpg',
    };
    const extracted = { ...emptyExtractedData(), codes: ['P0171'] };

    const updated = applyXentrySnapshot(ro, target, [newImage], ['new OCR'], extracted);

    assert.equal(updated.xentryImages?.length, 1);
    assert.equal(updated.xentryImages?.[0]?.id, 'ro-img-2');
    assert.deepEqual(updated.xentryOcrTexts, ['new OCR']);
    assert.equal(updated.repairLines[0]?.xentryImages?.[0]?.id, 'line-img-1');
    assert.deepEqual(updated.repairLines[0]?.xentryOcrTexts, ['Line-level OCR']);
    assert.deepEqual(updated.repairLines[0]?.extractedData?.codes, ['P0171']);
    assert.equal(updated.repairLines[1]?.extractedData, undefined);
  });

  it('useROXentryScan imports shared data model helpers (M3)', () => {
    const src = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    assert.match(src, /from '@\/hooks\/repairOrders\/xentryDataModel'/);
    assert.match(src, /appendXentryImage/);
    assert.match(src, /applyXentrySnapshot/);
    assert.match(src, /readXentryBaseline/);
    assert.match(src, /persistChainByKeyRef/);
    assert.match(src, /openImageFilePicker/);
    assert.match(src, /await flushPendingSave\(\{\s*maxWaitMs:\s*2_500\s*\}\)/);
    assert.match(src, /await saveROImmediate\(persisted/);
    assert.equal(src.includes('xentryImages: images,\n            xentryOcrTexts: ocrTexts'), false);
  });

  it('Xentry cancel clears all pending queues (L5)', () => {
    const src = readSrc('src/hooks/repairOrders/useROXentryScan.ts');
    const block = src.slice(src.indexOf('const cancelProcessing'));
    assert.ok(block.includes('setPendingByKey'));
    assert.ok(block.includes('return {}'));
  });

  it('deleteROXentryImage updates RO media and line-1 extracted only (M1)', () => {
    const src = readSrc('src/hooks/useRepairOrders.ts');
    const start = src.indexOf('const deleteROXentryImage');
    assert.ok(start >= 0, 'deleteROXentryImage must exist');
    // Bound to this callback only — do not scan the rest of the file.
    const nextConst = src.indexOf('\n  const ', start + 1);
    const block = src.slice(start, nextConst > start ? nextConst : undefined);
    assert.match(block, /extractedData:\s*result\.rebuilt/);
    assert.match(block, /xentryImages:\s*result\.nextImages/);
    assert.match(block, /xentryOcrTexts:\s*result\.nextOcr/);
    assert.match(block, /idx\s*===\s*0/);
    assert.equal(block.includes('lineImages.some'), false);
  });
});