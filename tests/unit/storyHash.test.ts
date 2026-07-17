import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashWarrantyStory } from '@/lib/storyHash';
import { storyCertificationMatchesStory } from '@/lib/storyCertification';

describe('storyHash', () => {
  it('changes when story text changes', () => {
    const hashA = hashWarrantyStory('Original story text.');
    const hashB = hashWarrantyStory('Edited story text.');
    assert.notEqual(hashA, hashB);
  });

  it('invalidates certification when story drifts', () => {
    const story = 'Verified concern and correction.';
    const hash = hashWarrantyStory(story);
    assert.equal(
      storyCertificationMatchesStory(
        {
          certifiedByName: 'Alex Tech',
          certifiedAt: new Date().toISOString(),
          storyHash: hash,
          certifiedByTechnicianId: 'tech-1',
        },
        `${story} Extra edit.`
      ),
      false
    );
  });
});