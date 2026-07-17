import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { formatAuditMetadataForDisplay } from '@/lib/auditMetadataDisplay';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('Audit metadata display (M6)', () => {
  it('formats primitive and nested metadata for manager UI', () => {
    const lines = formatAuditMetadataForDisplay({
      faultCodeCount: 2,
      success: true,
      pathnameDigest: 'abc123',
      tags: ['engine', 'misfire'],
      nested: { score: 88 },
      empty: '',
    });

    assert.ok(lines.some((line) => line.startsWith('faultCodeCount: 2')));
    assert.ok(lines.some((line) => line.startsWith('success: true')));
    assert.ok(lines.some((line) => line.startsWith('tags: engine, misfire')));
    assert.ok(lines.some((line) => line.startsWith('nested: ')));
    assert.equal(lines.some((line) => line.startsWith('empty:')), false);
  });

  it('AuditLogView renders metadata inline without CSV export (M6)', () => {
    const src = readSrc('src/components/AuditLogView.tsx');
    assert.ok(src.includes('formatAuditMetadataForDisplay'));
    assert.ok(src.includes('log.metadata'));
  });
});