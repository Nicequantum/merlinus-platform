import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createUserSchema, resolveServiceAdvisorLinkMode } from '@/lib/validation';

const basePayload = {
  d7Number: 'D7TEST01',
  name: 'Test User',
  password: 'ValidPass1!',
};

describe('resolveServiceAdvisorLinkMode', () => {
  it('returns null for non-service-advisor roles', () => {
    assert.equal(
      resolveServiceAdvisorLinkMode({ role: 'technician', serviceAdvisorLinkMode: 'create' }),
      null
    );
  });

  it('prefers explicit mode when provided', () => {
    assert.equal(
      resolveServiceAdvisorLinkMode({
        role: 'service_advisor',
        serviceAdvisorLinkMode: 'existing',
      }),
      'existing'
    );
  });

  it('defaults to existing when serviceAdvisorId is present', () => {
    assert.equal(
      resolveServiceAdvisorLinkMode({
        role: 'service_advisor',
        serviceAdvisorId: 'advisor-1',
      }),
      'existing'
    );
  });

  it('defaults to create when no profile id is present', () => {
    assert.equal(
      resolveServiceAdvisorLinkMode({
        role: 'service_advisor',
      }),
      'create'
    );
  });
});

describe('createUserSchema service advisor linking', () => {
  it('accepts linking an existing profile', () => {
    const parsed = createUserSchema.safeParse({
      ...basePayload,
      role: 'service_advisor',
      serviceAdvisorLinkMode: 'existing',
      serviceAdvisorId: 'advisor-1',
    });
    assert.equal(parsed.success, true);
  });

  it('accepts creating a new profile with advisor name', () => {
    const parsed = createUserSchema.safeParse({
      ...basePayload,
      role: 'service_advisor',
      serviceAdvisorLinkMode: 'create',
      newAdvisorDisplayName: 'Jordan Lee',
      newAdvisorCode: 'JL01',
    });
    assert.equal(parsed.success, true);
  });

  it('rejects existing mode without a profile id', () => {
    const parsed = createUserSchema.safeParse({
      ...basePayload,
      role: 'service_advisor',
      serviceAdvisorLinkMode: 'existing',
    });
    assert.equal(parsed.success, false);
  });

  it('rejects create mode without a valid advisor name', () => {
    const parsed = createUserSchema.safeParse({
      ...basePayload,
      role: 'service_advisor',
      serviceAdvisorLinkMode: 'create',
      newAdvisorDisplayName: 'Jo',
    });
    assert.equal(parsed.success, false);
  });

  it('does not require advisor fields for technician accounts', () => {
    const parsed = createUserSchema.safeParse({
      ...basePayload,
      role: 'technician',
    });
    assert.equal(parsed.success, true);
  });
});