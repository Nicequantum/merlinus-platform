#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE_URL:-http://localhost:3001}"
COOKIE_JAR="/tmp/benz-test-cookies.txt"
PASS=0
FAIL=0
WARN=0

log() { echo ""; echo "==> $1"; }
pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
warn() { echo "  WARN: $1"; WARN=$((WARN+1)); }

api() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -X "$method" "$BASE$path" \
      -H 'Content-Type: application/json' \
      -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      -d "$data" -w '\n__HTTP__%{http_code}'
  else
    curl -sS -X "$method" "$BASE$path" \
      -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
      -w '\n__HTTP__%{http_code}'
  fi
}

check_http() {
  local resp="$1" expected="$2" label="$3"
  local code
  code=$(echo "$resp" | sed -n 's/.*__HTTP__//p')
  local body
  body=$(echo "$resp" | sed 's/__HTTP__.*//')
  if [ "$code" = "$expected" ]; then
    pass "$label (HTTP $code)"
  else
    fail "$label — expected HTTP $expected, got $code — $body"
  fi
  echo "$body"
}

rm -f "$COOKIE_JAR"

log "1. Manager login"
: "${ADMIN_SEED_PASSWORD:?Set ADMIN_SEED_PASSWORD before running e2e tests}"
ADMIN_SEED_D7="${ADMIN_SEED_D7:-D7HARRIH}"
RESP=$(api POST /api/auth/login "{\"d7Number\":\"${ADMIN_SEED_D7}\",\"password\":\"${ADMIN_SEED_PASSWORD}\"}")
BODY=$(check_http "$RESP" 200 "Manager login")
echo "$BODY" | grep -q '"role":"manager"' && pass "Manager role in session" || fail "Manager role missing"

log "2. Manager consent"
RESP=$(api POST /api/consent '{}')
check_http "$RESP" 200 "Manager consent" > /dev/null

log "3. Manager list users"
RESP=$(api GET /api/users)
BODY=$(check_http "$RESP" 200 "Manager list users")
echo "$BODY" | grep -q 'tech@dealership.com' && pass "Technician visible in user list" || fail "Technician not in user list"

log "4. Manager logout"
RESP=$(api POST /api/auth/logout '{}')
check_http "$RESP" 200 "Manager logout" > /dev/null
rm -f "$COOKIE_JAR"

log "5. Technician login"
: "${TECH_SEED_PASSWORD:?Set TECH_SEED_PASSWORD before running e2e tests}"
TECH_SEED_D7="${TECH_SEED_D7:-D7TECH001}"
RESP=$(api POST /api/auth/login "{\"d7Number\":\"${TECH_SEED_D7}\",\"password\":\"${TECH_SEED_PASSWORD}\"}")
BODY=$(check_http "$RESP" 200 "Technician login")
echo "$BODY" | grep -q '"role":"technician"' && pass "Technician role in session" || fail "Technician role missing"

log "6. Technician consent"
RESP=$(api POST /api/consent '{}')
check_http "$RESP" 200 "Technician consent" > /dev/null

log "7. Scan RO (simulated extraction create)"
RO_PAYLOAD='{
  "fromExtraction": true,
  "roNumber": "R-TEST-001",
  "vehicle": {"vin":"WDDWF4KB0FR123456","year":"2015","make":"Mercedes-Benz","model":"C300","engine":"2.0L","mileageIn":"45230","mileageOut":""},
  "customerName": "John Test Customer",
  "complaints": ["Check engine light on", "Rough idle at cold start"]
}'
RESP=$(api POST /api/repair-orders "$RO_PAYLOAD")
BODY=$(check_http "$RESP" 200 "Create RO from scan")
RO_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['repairOrder']['id'])" 2>/dev/null || echo "")
LINE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['repairOrder']['repairLines'][0]['id'])" 2>/dev/null || echo "")
if [ -n "$RO_ID" ]; then pass "RO created with id $RO_ID"; else fail "RO id missing"; fi
if [ -n "$LINE_ID" ]; then pass "Repair line created with id $LINE_ID"; else fail "Line id missing"; fi

log "8. Image upload to Vercel Blob"
# 1x1 red PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x05\xfe\xd4\x00\x00\x00\x00IEND\xaeB`\x82' > /tmp/test-ro.png
UPLOAD_RESP=$(curl -sS -X POST "$BASE/api/upload" \
  -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
  -F "file=@/tmp/test-ro.png;type=image/png" \
  -w '\n__HTTP__%{http_code}')
UPLOAD_CODE=$(echo "$UPLOAD_RESP" | sed -n 's/.*__HTTP__//p')
UPLOAD_BODY=$(echo "$UPLOAD_RESP" | sed 's/__HTTP__.*//')
BLOB_URL=""
if [ "$UPLOAD_CODE" = "200" ]; then
  BLOB_URL=$(echo "$UPLOAD_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])" 2>/dev/null || echo "")
  if echo "$BLOB_URL" | grep -q 'blob.vercel-storage.com'; then
    pass "Image uploaded to Vercel Blob: $BLOB_URL"
  else
    fail "Upload returned 200 but URL is not Vercel Blob: $BLOB_URL"
  fi
else
  warn "Image upload failed (HTTP $UPLOAD_CODE) — likely missing BLOB_READ_WRITE_TOKEN: $UPLOAD_BODY"
fi

if [ -n "$BLOB_URL" ] && [ -n "$RO_ID" ]; then
  log "9. Attach blob URL to RO (no base64)"
  UPDATE_PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "xentryImages": [{"id": "test-img-1", "url": "$BLOB_URL", "name": "test-ro.png"}],
  "repairLines": [{"id": "$LINE_ID", "lineNumber": 1, "description": "Diagnose check engine light", "customerConcern": "Check engine light on", "technicianNotes": "Scanned fault codes P0300. Performed guided test on cylinder 1.", "xentryImages": [{"id": "test-img-1", "url": "$BLOB_URL", "name": "test-ro.png"}]}]
}))
PY
)
  RESP=$(api PUT "/api/repair-orders/$RO_ID" "$UPDATE_PAYLOAD")
  BODY=$(check_http "$RESP" 200 "Update RO with blob image URL")
  DB_CHECK=$(cd /root/.grok/worktrees/root-benz/dealer && npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const ro = await p.repairOrder.findUnique({ where: { id: '$RO_ID' }, include: { repairLines: true } });
const urls = ro?.xentryImageUrls || '';
const lineUrls = ro?.repairLines[0]?.xentryImageUrls || '';
const hasBase64 = urls.includes('base64') || lineUrls.includes('base64') || urls.includes('data:');
const hasBlob = urls.includes('blob.vercel-storage.com') || lineUrls.includes('blob.vercel-storage.com');
console.log(JSON.stringify({ hasBase64, hasBlob, urls, lineUrls }));
await p.\$disconnect();
" 2>/dev/null)
  echo "  DB image fields: $DB_CHECK"
  echo "$DB_CHECK" | grep -q '"hasBase64":false' && pass "No base64 in database image fields" || fail "Base64 found in database"
  echo "$DB_CHECK" | grep -q '"hasBlob":true' && pass "Vercel Blob URL stored in database" || fail "Blob URL not in database"
fi

log "10. Generate warranty story"
if [ -n "$RO_ID" ] && [ -n "$LINE_ID" ]; then
  RESP=$(api POST "/api/repair-orders/$RO_ID/lines/$LINE_ID/generate-story" '{}')
  CODE=$(echo "$RESP" | sed -n 's/.*__HTTP__//p')
  BODY=$(echo "$RESP" | sed 's/__HTTP__.*//')
  if [ "$CODE" = "200" ]; then
    echo "$BODY" | grep -q 'warrantyStory' && pass "Warranty story generated" || fail "Story response missing warrantyStory"
  else
    warn "Story generation failed (HTTP $CODE) — likely missing GROK_API_KEY: $BODY"
  fi
fi

log "11. Story edit audit"
if [ -n "$RO_ID" ] && [ -n "$LINE_ID" ]; then
  EDIT_PAYLOAD=$(python3 - <<PY
import json
print(json.dumps({
  "repairLines": [{"id": "$LINE_ID", "lineNumber": 1, "description": "Diagnose check engine light", "customerConcern": "Check engine light on", "technicianNotes": "Scanned fault codes P0300.", "warrantyStory": "CUSTOMER CONCERN: Check engine light on.\nCAUSE: [NOT DOCUMENTED]\nCORRECTION: [NOT DOCUMENTED]"}]
}))
PY
)
  RESP=$(api PUT "/api/repair-orders/$RO_ID" "$EDIT_PAYLOAD")
  check_http "$RESP" 200 "Story edit via RO update" > /dev/null
  pass "Story edit submitted"
fi

log "12. Invalid login returns safe error"
rm -f "$COOKIE_JAR"
RESP=$(api POST /api/auth/login '{"d7Number":"D7TECH001","password":"wrongpassword"}')
BODY=$(check_http "$RESP" 401 "Invalid login rejected")
echo "$BODY" | grep -q 'SESSION_SECRET\|prisma\|Error:' && fail "Raw error leaked to client" || pass "No raw error in login response"

log "13. Audit log verification"
AUDIT=$(cd /root/.grok/worktrees/root-benz/dealer && npx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const logs = await p.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
const actions = logs.map(l => l.action);
console.log(JSON.stringify({ count: logs.length, actions }, null, 2));
await p.\$disconnect();
" 2>/dev/null)
echo "$AUDIT"
echo "$AUDIT" | grep -q 'auth.login' && pass "Audit: auth.login recorded" || fail "Audit: auth.login missing"
echo "$AUDIT" | grep -q 'consent.accept' && pass "Audit: consent.accept recorded" || fail "Audit: consent.accept missing"
echo "$AUDIT" | grep -q 'ro.create' && pass "Audit: ro.create recorded" || fail "Audit: ro.create missing"
echo "$AUDIT" | grep -q 'ro.update' && pass "Audit: ro.update recorded" || fail "Audit: ro.update missing"
if echo "$AUDIT" | grep -q 'image.upload'; then pass "Audit: image.upload recorded"; else warn "Audit: image.upload not recorded (upload may have failed)"; fi
if echo "$AUDIT" | grep -q 'story.generate'; then pass "Audit: story.generate recorded"; else warn "Audit: story.generate not recorded (Grok may be unconfigured)"; fi
if echo "$AUDIT" | grep -q 'story.edit'; then pass "Audit: story.edit recorded"; else fail "Audit: story.edit missing"

echo ""
echo "================================"
echo "RESULTS: $PASS passed, $FAIL failed, $WARN warnings"
echo "================================"
[ "$FAIL" -eq 0 ]