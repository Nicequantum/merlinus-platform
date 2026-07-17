import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTemplateTags } from '@/lib/templateTags';

describe('buildTemplateTags', () => {
  it('includes category and domain keywords', () => {
    const tags = buildTemplateTags({
      title: 'MBUX System Failure',
      category: 'warranty',
      finalText: 'MBUX portrait display blanked out during customer visit.',
      lineDescription: 'MBUX head unit failure',
      vehicleModel: 'CLE 450',
    });
    assert.ok(tags.includes('warranty'));
    assert.ok(tags.includes('mbux'));
    assert.ok(tags.includes('user-saved'));
  });
});