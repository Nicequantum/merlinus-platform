import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('second-facility hardening (same-owner multi-rooftop)', () => {
  it('provision accepts existingDealerGroupId + attachLinkedOwnerToPrimaryGroup', () => {
    const src = read('src/lib/apex/provisionDealer.ts');
    assert.match(src, /existingDealerGroupId/);
    assert.match(src, /attachLinkedOwnerToPrimaryGroup/);
    assert.match(src, /reusedExistingGroup/);
    assert.match(src, /DEALER_GROUP_NOT_FOUND/);
    assert.match(src, /alreadyMember/);
    assert.match(src, /isPrimary: !hasPrimary/);
  });

  it('HTTP schema and route pass second-facility fields', () => {
    const val = read('src/lib/validation.ts');
    const route = read('src/app/api/owner/provision-dealer/route.ts');
    assert.match(val, /existingDealerGroupId/);
    assert.match(val, /attachLinkedOwnerToPrimaryGroup/);
    assert.match(val, /switchDealershipSchema/);
    assert.match(route, /existingDealerGroupId: body\.existingDealerGroupId/);
    assert.match(route, /attachLinkedOwnerToPrimaryGroup/);
  });

  it('owner portfolio filters honor activeDealerGroupId', () => {
    const access = read('src/lib/apex/dealerGroupAccess.ts');
    const summary = read('src/lib/apex/ownerNationalSummary.ts');
    const list = read('src/app/api/owner/dealerships/route.ts');
    assert.match(access, /options\?: \{ dealerGroupId/);
    assert.match(summary, /scopeMode === 'group'/);
    assert.match(list, /session\.scopeMode === 'group'/);
  });

  it('owner enter allows rooftop switch; staff has switch-dealership route', () => {
    const enter = read('src/app/api/auth/enter-dealership/route.ts');
    const sw = read('src/app/api/auth/switch-dealership/route.ts');
    const client = read('src/lib/apexLoginSession.ts');
    assert.match(enter, /requireOwnerNational:\s*false/);
    assert.match(sw, /auth\.switch_dealership/);
    assert.match(sw, /resolveSelectDealershipSession/);
    assert.match(client, /switchStaffDealership/);
  });

  it('onboard form attaches linked owner to primary group by default', () => {
    const form = read('src/components/apex/OwnerOnboardDealershipForm.tsx');
    assert.match(form, /attachLinkedOwnerToPrimaryGroup:\s*true/);
    assert.match(form, /Second facility/i);
  });
});
