/**
 * Seed / update VoiceAgentLine for Mercedes-Benz Staging receptionist DID.
 *
 * Usage:
 *   node scripts/seed-voice-staging-line.mjs
 *
 * Requires wrangler auth. Applies to remote D1 merlinus-d1.
 */
import { execSync } from 'node:child_process';

const E164 = '+14016454563';
const DEALERSHIP_ID = 'seed-dealership';
const LABEL = 'Sophia Staging';

function sql(q) {
  const escaped = q.replace(/"/g, '\\"');
  const cmd = `npx wrangler d1 execute merlinus-d1 --remote --command "${escaped}"`;
  console.log('>', q.slice(0, 120) + (q.length > 120 ? '…' : ''));
  const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(out);
  return out;
}

console.log('Seeding Sophia staging voice line…');

// Enable voice_agent module for seed-dealership
sql(
  `INSERT INTO DealershipModule (id, dealershipId, moduleId, enabled, configJson, enabledAt, createdAt, updatedAt)
   VALUES (
     'seed-voice-module-staging',
     '${DEALERSHIP_ID}',
     'voice_agent',
     1,
     '{}',
     datetime('now'),
     datetime('now'),
     datetime('now')
   )
   ON CONFLICT(dealershipId, moduleId) DO UPDATE SET
     enabled = 1,
     updatedAt = datetime('now');`
);

// Upsert line by unique e164Number
sql(
  `INSERT INTO VoiceAgentLine (id, dealershipId, e164Number, label, provider, isActive, createdAt, updatedAt)
   VALUES (
     'seed-voice-line-staging',
     '${DEALERSHIP_ID}',
     '${E164}',
     '${LABEL}',
     'twilio',
     1,
     datetime('now'),
     datetime('now')
   )
   ON CONFLICT(e164Number) DO UPDATE SET
     dealershipId = '${DEALERSHIP_ID}',
     label = '${LABEL}',
     isActive = 1,
     updatedAt = datetime('now');`
);

sql(
  `SELECT id, dealershipId, e164Number, label, isActive FROM VoiceAgentLine WHERE e164Number = '${E164}';`
);

console.log('Done. Point Twilio +1 (401) 645-4563 Voice URL to https://YOUR_HOST/api/voice/inbound');
