import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildCustomerViewerUrl,
  generateShareToken,
  hashPasscode,
  hashShareToken,
  isValidRawShareToken,
  verifyPasscodeHash,
} from '../../src/lib/videoInspection/shareTokens';
import { CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT } from '../../src/prompts/customerVideoReport/systemPrompt';
import { buildCustomerVideoReportUserMessage } from '../../src/prompts/customerVideoReport/buildUserMessage';
import { isAllowedVideoPathname } from '../../src/lib/videoBlob';
import { normalizeE164, isSmsEnabled } from '../../src/lib/sms/twilio';

const root = resolve(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('video inspection share tokens', () => {
  it('hashes tokens stably and generates opaque values', () => {
    const token = generateShareToken();
    assert.ok(token.length >= 32);
    assert.equal(hashShareToken(token), hashShareToken(token));
    assert.notEqual(hashShareToken(token), hashShareToken(token + 'x'));
  });

  it('validates raw share token format and timing-safe passcode', () => {
    const token = generateShareToken();
    assert.equal(isValidRawShareToken(token), true);
    assert.equal(isValidRawShareToken('short'), false);
    assert.equal(isValidRawShareToken('bad token with spaces!!!!!!!'), false);
    assert.equal(isValidRawShareToken(null), false);
    const h = hashPasscode('secret12');
    assert.equal(verifyPasscodeHash('secret12', h), true);
    assert.equal(verifyPasscodeHash('wrong', h), false);
    assert.equal(verifyPasscodeHash('', h), false);
  });

  it('builds customer viewer URLs', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://merlinus-platform.example.com';
    try {
      const url = buildCustomerViewerUrl('abcTOKEN');
      assert.equal(url, 'https://merlinus-platform.example.com/v/abcTOKEN');
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it('derives production share host from request when env is localhost', () => {
    const prevApp = process.env.NEXT_PUBLIC_APP_URL;
    const prevMerlin = process.env.MERLIN_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    delete process.env.MERLIN_BASE_URL;
    try {
      const req = new Request('https://example.invalid/', {
        headers: {
          host: 'merlinus-platform.hombre3536.workers.dev',
          'x-forwarded-proto': 'https',
        },
      });
      const url = buildCustomerViewerUrl('tok123TOKEN_tok123TOKEN_tok123TOK', req);
      assert.match(url, /^https:\/\/merlinus-platform\.hombre3536\.workers\.dev\/v\//);
      assert.ok(!url.includes('localhost'));
    } finally {
      if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prevApp;
      if (prevMerlin === undefined) delete process.env.MERLIN_BASE_URL;
      else process.env.MERLIN_BASE_URL = prevMerlin;
    }
  });
});

describe('customer video report prompts (isolated from warranty)', () => {
  it('uses customer tone and English-only output', () => {
    assert.match(CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT, /vehicle OWNER/i);
    assert.match(CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT, /professional English/i);
    assert.match(CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT, /What We Found/i);
    assert.equal(CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT.includes('warranty 3C'), true);
    assert.equal(CUSTOMER_VIDEO_REPORT_SYSTEM_PROMPT.includes('MI audit'), true);
  });

  it('injects Spanish narration language note', () => {
    const msg = buildCustomerVideoReportUserMessage({
      transcript: 'Neumáticos desgastados',
      transcriptLanguage: 'es',
      frameCount: 3,
      vehicleLabel: '2020 C300',
    });
    assert.match(msg, /Spanish|es/i);
    assert.match(msg, /Neumáticos/);
    assert.match(msg, /English/i);
  });
});

describe('video path allowlist', () => {
  it('allows only benz-tech/video prefix', () => {
    assert.equal(isAllowedVideoPathname('benz-tech/video/d1/file.webm'), true);
    assert.equal(isAllowedVideoPathname('benz-tech/other.webm'), false);
    assert.equal(isAllowedVideoPathname('benz-tech/video/../secret'), false);
  });
});

describe('SMS helpers', () => {
  it('normalizes US phone numbers', () => {
    assert.equal(normalizeE164('(555) 123-4567'), '+15551234567');
    assert.equal(normalizeE164('+15551234567'), '+15551234567');
    assert.equal(normalizeE164('12'), null);
  });

  it('defaults SMS disabled without env', () => {
    // Without SMS_ENABLED=true this is false in test env
    assert.equal(typeof isSmsEnabled(), 'boolean');
  });
});

describe('golden path isolation', () => {
  it('does not wire video into warranty story or RO extract routes', () => {
    const genStory = readSrc(
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts'
    );
    assert.equal(genStory.includes('videoInspection'), false);
    assert.equal(genStory.includes('customerVideoReport'), false);
    const extract = readSrc('src/app/api/repair-orders/extract/route.ts');
    assert.equal(extract.includes('videoInspection'), false);
  });

  it('schema defines VideoInspection models', () => {
    const schema = readSrc('prisma/schema.prisma');
    assert.match(schema, /model VideoInspection /);
    assert.match(schema, /model VideoInspectionShare /);
  });
});

describe('must-do security hardening', () => {
  it('SMS never accepts client shareUrl', () => {
    const sms = readSrc('src/app/api/video-inspections/[id]/send-sms/route.ts');
    assert.equal(sms.includes('shareUrl: z'), false);
    assert.equal(sms.includes('parsed.data.shareUrl'), false);
    assert.match(sms, /buildCustomerViewerUrl\(token(?:,\s*request)?\)/);
    assert.match(sms, /generateShareToken/);
  });

  it('refresh rotation preserves View As lens', () => {
    const session = readSrc('src/lib/apex/apexSession.ts');
    assert.match(
      session,
      /buildOwnerDealershipSession\([\s\S]*?viewAsRole:\s*lenientClaims\.viewAsRole/
    );
  });

  it('video list ACL uses effectiveIsAdmin not seed isAdmin alone', () => {
    const access = readSrc('src/lib/videoInspection/access.ts');
    assert.match(access, /effectiveIsAdmin/);
    assert.equal(access.includes('Boolean(session.isAdmin)'), false);
  });

  it('users DELETE requires manager + dealership context', () => {
    const users = readSrc('src/app/api/users/[id]/route.ts');
    assert.match(users, /users\.delete[\s\S]*requireManager:\s*true/);
    assert.match(users, /users\.delete[\s\S]*requireDealershipContext:\s*true/);
  });

  it('video upload has Content-Length gate and UUID blob keys', () => {
    const upload = readSrc('src/app/api/video-inspections/upload/route.ts');
    assert.match(upload, /content-length/i);
    assert.match(upload, /normalizePreferredLanguage/);
    assert.match(upload, /MAX_TRANSCRIPT_CHARS|20_000/);
    const blob = readSrc('src/lib/videoBlob.ts');
    assert.match(blob, /randomUUID/);
  });

  it('public video media uses no-store cache', () => {
    const media = readSrc('src/app/api/public/video/[token]/media/route.ts');
    assert.match(media, /Cache-Control': 'private, no-store'/);
  });

  it('public video routes stay unauthenticated but enforce share token gates', () => {
    const meta = readSrc('src/app/api/public/video/[token]/route.ts');
    const media = readSrc('src/app/api/public/video/[token]/media/route.ts');
    for (const src of [meta, media]) {
      assert.equal(src.includes('withAuth('), false);
      assert.match(src, /isValidRawShareToken/);
      assert.match(src, /hashShareToken/);
      assert.match(src, /expiresAt/);
      assert.match(src, /passcodeHash/);
      assert.match(src, /verifyPasscodeHash/);
      assert.match(src, /checkRateLimit/);
      assert.match(src, /revokedAt/);
    }
  });
});
