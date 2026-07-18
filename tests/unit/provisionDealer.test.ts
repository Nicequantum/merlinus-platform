import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildDealerProvisionAuditMetadata,
  DEALER_PROVISION_METADATA_ALLOWED_KEYS,
  hashDealerCodeForAudit,
  httpStatusForProvisionError,
  isHttpProvisionEnabled,
  normalizeDealerCode,
  ProvisionDealerError,
  resolveProvisionDisplayNames,
  toSafeProvisionHttpResponse,
  validateDealerName,
  validateRooftopDisplayName,
  PROVISION_DENY_DEALERSHIP_IDS,
} from '@/lib/apex/provisionDealer';
import {
  assertTemplateHasNoHardcodedIdentity,
  getDealerTemplate,
  getTemplateInheritanceChain,
  isDealerTemplateId,
  listDealerTemplates,
} from '@/lib/apex/dealerTemplates';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { parseBody, provisionDealerHttpSchema } from '@/lib/validation';

const root = resolve(process.cwd());

describe('dealerTemplates', () => {
  it('exposes clean base plus mercedes and generic rooftop templates', () => {
    const list = listDealerTemplates();
    assert.ok(list.length >= 3);
    assert.ok(isDealerTemplateId('base-rooftop-v1'));
    assert.ok(isDealerTemplateId('mercedes-rooftop-v1'));
    assert.ok(isDealerTemplateId('generic-rooftop-v1'));

    const base = getDealerTemplate('base-rooftop-v1')!;
    assert.equal(base.extends, null);
    assert.equal(base.brand, 'none');
    assert.equal(base.loginStrategy, 'email');
    assert.equal(base.branding.logo, 'none');
    assert.equal(base.branding.theme, 'neutral');
    assert.equal(base.branding.hardcodedDisplayName, null);
    assert.equal(base.seed.copyPilotDealership, false);
    assert.equal(base.features.xentry, false);
    assertTemplateHasNoHardcodedIdentity(base);

    const m = getDealerTemplate('mercedes-rooftop-v1')!;
    assert.equal(m.extends, 'base-rooftop-v1');
    assert.equal(m.loginStrategy, 'd7');
    assert.equal(m.features.xentry, true);
    assert.equal(m.branding.logo, 'mercedes');
    assert.equal(m.branding.hardcodedDisplayName, null);
    assert.equal(m.seed.copyPilotDealership, false);
    assert.deepEqual(getTemplateInheritanceChain('mercedes-rooftop-v1'), ['base-rooftop-v1']);
    assertTemplateHasNoHardcodedIdentity(m);

    const g = getDealerTemplate('generic-rooftop-v1')!;
    assert.equal(g.extends, 'base-rooftop-v1');
    assert.equal(g.loginStrategy, 'apex_username');
    assert.equal(g.features.xentry, false);
    assert.equal(g.branding.logo, 'none');
    assert.equal(g.branding.hardcodedDisplayName, null);
    assertTemplateHasNoHardcodedIdentity(g);
  });

  it('never injects pilot names — provision names come only from input', () => {
    const template = getDealerTemplate('mercedes-rooftop-v1')!;
    const names = resolveProvisionDisplayNames({
      dealerName: 'Coastal MB Group',
      rooftopName: 'Mercedes-Benz of Newport',
      template,
    });
    assert.equal(names.dealerName, 'Coastal MB Group');
    assert.equal(names.rooftopName, 'Mercedes-Benz of Newport');
    assert.notEqual(names.rooftopName, 'Mercedes-Benz of Tiverton');
    assert.equal(/merlinus/i.test(names.rooftopName), false);
  });
});

describe('provisionDealer naming + security helpers', () => {
  it('normalizes dealer codes', () => {
    assert.equal(normalizeDealerCode(' newport '), 'NEWPORT');
    assert.equal(normalizeDealerCode('new-port_1'), 'NEW-PORT_1');
  });

  it('accepts full storefront rooftop names', () => {
    assert.equal(
      validateRooftopDisplayName('  Mercedes-Benz of Newport  '),
      'Mercedes-Benz of Newport'
    );
  });

  it('rejects Merlinus / placeholder rooftop names', () => {
    assert.throws(() => validateRooftopDisplayName('Merlinus'), ProvisionDealerError);
    assert.throws(() => validateRooftopDisplayName('seed-dealership'), ProvisionDealerError);
    assert.throws(() => validateRooftopDisplayName('TODO'), ProvisionDealerError);
    assert.throws(() => validateRooftopDisplayName('Tiverton'), ProvisionDealerError);
    // Pilot default storefront must not be re-used as a provisioned rooftop label.
    assert.throws(() => validateRooftopDisplayName('Mercedes-Benz of Tiverton'), ProvisionDealerError);
    assert.equal(
      validateRooftopDisplayName('Mercedes-Benz of Newport'),
      'Mercedes-Benz of Newport'
    );
  });

  it('validates franchise dealer name length', () => {
    assert.equal(validateDealerName('Coastal MB Group'), 'Coastal MB Group');
    assert.throws(() => validateDealerName('ab'), ProvisionDealerError);
    assert.throws(() => validateDealerName('Merlinus'), ProvisionDealerError);
    assert.throws(() => validateDealerName('Mercedes-Benz of Tiverton'), ProvisionDealerError);
  });

  it('denies pilot and sentinel dealership ids', () => {
    assert.ok(PROVISION_DENY_DEALERSHIP_IDS.has('seed-dealership'));
    assert.ok(PROVISION_DENY_DEALERSHIP_IDS.has(APEX_NATIONAL_DEALERSHIP_ID));
  });

  it('builds PII-free dealer.provision audit metadata', () => {
    const template = getDealerTemplate('mercedes-rooftop-v1')!;
    const meta = buildDealerProvisionAuditMetadata({
      template,
      dealerCode: 'NEWPORT',
      dealerId: 'dealer-id-1',
      dealershipId: 'rooftop-id-1',
      managerTechnicianId: 'mgr-id-1',
      ownerTechnicianId: 'owner-id-1',
      dealerGroupId: 'group-id-1',
      ownerOutcome: 'created',
      actor: { type: 'script', id: 'ci-runner' },
      ifExistsMode: 'fail',
      outcome: 'created',
    });
    for (const key of Object.keys(meta)) {
      assert.ok(DEALER_PROVISION_METADATA_ALLOWED_KEYS.has(key), `unexpected key ${key}`);
    }
    assert.equal('email' in meta, false);
    assert.equal('name' in meta, false);
    assert.equal('d7Number' in meta, false);
    assert.equal('password' in meta, false);
    assert.equal('rooftopName' in meta, false);
    assert.equal('dealerName' in meta, false);
    assert.equal(meta.ownerTechnicianId, 'owner-id-1');
    assert.equal(meta.dealerGroupId, 'group-id-1');
    assert.equal(meta.ownerOutcome, 'created');
    assert.equal(typeof meta.dealerCodeHash, 'string');
    assert.equal((meta.dealerCodeHash as string).length, 64);
    assert.notEqual(meta.dealerCodeHash, 'NEWPORT');
  });

  it('hashes dealer codes stably', () => {
    assert.equal(hashDealerCodeForAudit('newport'), hashDealerCodeForAudit('NEWPORT'));
  });

  it('CLI rejects password argv flags', () => {
    const src = readFileSync(resolve(root, 'scripts/provision-dealer.ts'), 'utf8');
    assert.match(src, /FORBIDDEN_PASSWORD_FLAGS/);
    assert.match(src, /manager-password-env/);
    assert.match(src, /password-stdin/);
    assert.match(src, /show-credentials/);
    assert.match(src, /APEX_PROVISION_ALLOW_YES/);
    assert.doesNotMatch(src, /flags\['manager-password'\]\s*=/);
  });

  it('registers dealer.provision as critical audit action', () => {
    const audit = readFileSync(resolve(root, 'src/lib/audit.ts'), 'utf8');
    assert.match(audit, /dealer\.provision/);
    assert.match(audit, /CRITICAL_AUDIT_ACTIONS/);
  });
});

describe('HTTP provision endpoint guards', () => {
  it('is disabled unless APEX_ALLOW_HTTP_PROVISION is exactly true', () => {
    const prev = process.env.APEX_ALLOW_HTTP_PROVISION;
    try {
      delete process.env.APEX_ALLOW_HTTP_PROVISION;
      assert.equal(isHttpProvisionEnabled(), false);
      process.env.APEX_ALLOW_HTTP_PROVISION = '1';
      assert.equal(isHttpProvisionEnabled(), false);
      process.env.APEX_ALLOW_HTTP_PROVISION = 'yes';
      assert.equal(isHttpProvisionEnabled(), false);
      process.env.APEX_ALLOW_HTTP_PROVISION = 'true';
      assert.equal(isHttpProvisionEnabled(), true);
      process.env.APEX_ALLOW_HTTP_PROVISION = ' true ';
      assert.equal(isHttpProvisionEnabled(), true);
    } finally {
      if (prev === undefined) delete process.env.APEX_ALLOW_HTTP_PROVISION;
      else process.env.APEX_ALLOW_HTTP_PROVISION = prev;
    }
  });

  it('maps provision error codes to HTTP statuses', () => {
    assert.equal(httpStatusForProvisionError('PROVISION_DAILY_CAP'), 429);
    assert.equal(httpStatusForProvisionError('DEALER_EXISTS'), 409);
    assert.equal(httpStatusForProvisionError('PROVISION_DB_REQUIRED'), 503);
    assert.equal(httpStatusForProvisionError('WEAK_PASSWORD'), 400);
  });

  it('safe HTTP response never includes password or login identifiers', () => {
    const safe = toSafeProvisionHttpResponse({
      created: true,
      skipped: false,
      dryRun: false,
      dealerId: 'd1',
      dealershipId: 'r1',
      managerId: 'm1',
      ownerId: 'o1',
      dealerGroupId: 'g1',
      ownerCreated: true,
      ownerLinked: false,
      templateId: 'mercedes-rooftop-v1',
      rooftopName: 'Mercedes-Benz of Newport',
      dealerCode: 'NEWPORT',
      auditLogId: 'a1',
      mustChangePassword: true,
      logins: [
        { role: 'manager', identifierType: 'd7', identifier: 'D7SECRET' },
        { role: 'owner', identifierType: 'email', identifier: 'owner@secret.com' },
      ],
    });
    const json = JSON.stringify(safe);
    assert.doesNotMatch(json, /"password"/i);
    assert.doesNotMatch(json, /D7SECRET/);
    assert.doesNotMatch(json, /owner@secret\.com/);
    assert.equal(safe.mustChangePassword, true);
    assert.equal(safe.logins[0]?.identifierType, 'd7');
    assert.equal(safe.logins[1]?.role, 'owner');
    assert.equal(safe.ownerId, 'o1');
    assert.equal(safe.ownerCreated, true);
    assert.equal(safe.ownerLinked, false);
    assert.equal('identifier' in (safe.logins[0] as object), false);
  });

  it('HTTP body schema requires confirmDealerCode match and min password length', () => {
    const badConfirm = parseBody(provisionDealerHttpSchema, {
      dealerCode: 'NEWPORT',
      confirmDealerCode: 'OTHER',
      dealerName: 'Franchise Group',
      rooftopName: 'Mercedes-Benz of Newport',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Alex Rivera',
        email: 'alex@example.com',
        password: 'strong-temp-pass-99',
        d7Number: 'D7NEWPORT1',
      },
    });
    assert.ok('error' in badConfirm);

    const shortPw = parseBody(provisionDealerHttpSchema, {
      dealerCode: 'NEWPORT',
      confirmDealerCode: 'newport',
      dealerName: 'Franchise Group',
      rooftopName: 'Mercedes-Benz of Newport',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Alex Rivera',
        email: 'alex@example.com',
        password: 'short',
        d7Number: 'D7NEWPORT1',
      },
    });
    assert.ok('error' in shortPw);

    const ok = parseBody(provisionDealerHttpSchema, {
      dealerCode: 'NEWPORT',
      confirmDealerCode: 'newport',
      dealerName: 'Franchise Group',
      rooftopName: 'Mercedes-Benz of Newport',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Alex Rivera',
        email: 'alex@example.com',
        password: 'strong-temp-pass-99',
        d7Number: 'D7NEWPORT1',
      },
    });
    assert.ok('data' in ok);
    if ('data' in ok) {
      assert.equal(ok.data.ifExists, 'fail');
      assert.equal(ok.data.dryRun, false);
    }

    const sameEmail = parseBody(provisionDealerHttpSchema, {
      dealerCode: 'NEWPORT',
      confirmDealerCode: 'NEWPORT',
      dealerName: 'Franchise Group',
      rooftopName: 'Mercedes-Benz of Newport',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Alex Rivera',
        email: 'same@example.com',
        password: 'strong-temp-pass-99',
        d7Number: 'D7NEWPORT1',
      },
      owner: {
        name: 'Jordan Lee',
        email: 'same@example.com',
        password: 'strong-owner-pass-99',
      },
    });
    assert.ok('error' in sameEmail);

    const withOwner = parseBody(provisionDealerHttpSchema, {
      dealerCode: 'NEWPORT',
      confirmDealerCode: 'NEWPORT',
      dealerName: 'Franchise Group',
      rooftopName: 'Mercedes-Benz of Newport',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Alex Rivera',
        email: 'manager@example.com',
        password: 'strong-temp-pass-99',
        d7Number: 'D7NEWPORT1',
      },
      owner: {
        name: 'Jordan Lee',
        email: 'owner@example.com',
        password: 'strong-owner-pass-99',
      },
    });
    assert.ok('data' in withOwner);
    if ('data' in withOwner) {
      assert.equal(withOwner.data.owner?.email, 'owner@example.com');
    }
  });

  it('route uses fortress owner national guards and shared provisionDealer', () => {
    const src = readFileSync(resolve(root, 'src/app/api/owner/provision-dealer/route.ts'), 'utf8');
    assert.match(src, /requireOwnerNational:\s*true/);
    assert.match(src, /requireOwner:\s*true/);
    assert.match(src, /isHttpProvisionEnabled/);
    assert.match(src, /provisionDealer\(/);
    assert.match(src, /toSafeProvisionHttpResponse/);
    assert.match(src, /assertNotProductionWithoutProvisionUrl/);
    assert.match(src, /type:\s*'owner_api'/);
    assert.match(src, /rateLimitKey:\s*'owner\.provision-dealer'/);
    assert.match(src, /useRls:\s*false/);
    assert.match(src, /owner:/);
    assert.doesNotMatch(src, /password:\s*result/);
    assert.doesNotMatch(src, /logger\.[a-z]+\([^)]*password/i);
  });

  it('onboard form includes optional owner fields and provision engine supports owner path', () => {
    const form = readFileSync(
      resolve(root, 'src/components/apex/OwnerOnboardDealershipForm.tsx'),
      'utf8'
    );
    assert.match(form, /ownerName/);
    assert.match(form, /ownerEmail/);
    assert.match(form, /owner:\s*\{/);
    assert.match(form, /Dealership owner \(optional\)/);

    const engine = readFileSync(resolve(root, 'src/lib/apex/provisionDealer.ts'), 'utf8');
    assert.match(engine, /ProvisionOwnerInput/);
    assert.match(engine, /dealerGroupMembership\.create/);
    assert.match(engine, /OWNER_EMAIL_CONFLICT/);
    assert.match(engine, /ownerOutcome/);
  });
});
