# Merlinus Capability Matrix (generated)

**Generated:** 2026-07-31T04:38:22.139Z  
**Routes:** 137  

> Living matrix: re-run `npm run matrix:generate` after adding API routes.
> Pilot status overrides: `src/lib/capabilityMatrix/overrides.ts`.

## Legend

| Status | Meaning |
|--------|---------|
| `pilot-core` | Required for first MB pilot (core warranty story) |
| `pilot-optional` | Enable only if contracted / journey-proven |
| `ops-gated` | Needs Worker secrets / queue / external service healthy |
| `deferred` | Not shipping — do not sell as live |
| `national-owner` | National / group owner only |
| `internal` | Bootstrap / internal — not bay-facing |
| `public` | Unauthenticated or public token surface |
| `unknown` | Not classified — review before pilot |

## Counts by pilot status

| Status | Routes |
|--------|--------|
| `pilot-core` | 62 |
| `pilot-optional` | 54 |
| `ops-gated` | 9 |
| `national-owner` | 8 |
| `deferred` | 1 |
| `internal` | 1 |
| `public` | 1 |
| `unknown` | 1 |

## Pilot-core surfaces (first MB store)

| API path | Methods | Module | Roles | Note |
|----------|---------|--------|-------|------|
| `/api/audit-logs/latest` | GET | core/always | authenticated | Manager audit trail |
| `/api/audit-logs/pdf-export` | POST | core/always | authenticated | Manager audit trail |
| `/api/audit-logs` | GET | core/always | manager | Manager audit trail |
| `/api/audit-logs/summary` | GET | core/always | manager | Manager audit trail |
| `/api/auth/change-password` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/clerk/link` | GET POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/enter-dealership` | POST | core/always | owner | Auth, MFA, session |
| `/api/auth/exit-dealership` | POST | core/always | owner | Auth, MFA, session |
| `/api/auth/login` | POST | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/logout` | GET POST DELETE | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/me` | GET | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/mfa/backup-codes` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/mfa/disable` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/mfa/enroll` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/mfa/login-verify` | POST | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/mfa/self-recovery` | POST | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/mfa/setup` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/mfa/status` | GET | core/always | authenticated | Auth, MFA, session |
| `/api/auth/mfa/verify` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/password-recovery/confirm` | POST | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/password-recovery/request` | POST | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/preferences` | POST | core/always | authenticated | Auth, MFA, session |
| `/api/auth/refresh` | GET POST | core/always | public-or-special | Auth, MFA, session |
| `/api/auth/security-status` | GET | core/always | manager | Auth, MFA, session |
| `/api/auth/select-dealership` | POST | core/always | public-or-special | Auth, MFA, session |
| `/api/companion/poll` | GET | core/always | authenticated | Desktop companion sync (LWW) |
| `/api/companion/publish` | POST | core/always | authenticated | Desktop companion sync (LWW) |
| `/api/companion/stream` | GET | core/always | authenticated | Desktop companion sync (LWW) |
| `/api/consent` | POST | core/always | authenticated |  |
| `/api/diagnostics/extract` | POST | core/always | authenticated | Diagnostic evidence extraction |
| `/api/health` | GET | core/always | manager | Manager health matrix |
| `/api/images` | GET | core/always | authenticated | Private evidence blobs |
| `/api/legal-disclaimer` | POST | core/always | authenticated |  |
| `/api/manager/center/live` | GET | core/always | manager | Manager control center / MFA admin / encryption |
| `/api/manager/center/summary` | GET | core/always | manager | Manager control center / MFA admin / encryption |
| `/api/manager/encryption/rotate` | GET POST | core/always | manager | Manager control center / MFA admin / encryption |
| `/api/manager/mfa/reset` | POST | core/always | manager | Manager control center / MFA admin / encryption |
| `/api/manager/mfa/roster` | GET | core/always | manager | Manager control center / MFA admin / encryption |
| `/api/modules` | GET PATCH | core/always | manager | Entitlement toggles — keep non-core off in pilot |
| `/api/repair-orders/[id]/lines/[lineId]/apply-customer-pay-template` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/certify-story` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/clear-customer-pay` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/generate-story` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/review-story` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]` | PATCH | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/score-story` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/sold-metrics` | PATCH | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]` | GET PUT DELETE | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders/extract` | POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/repair-orders` | GET POST | core/always | authenticated | Core RO + story pipeline — pilot required |
| `/api/session/warmup` | GET | core/always | authenticated | Bay session warmup |
| `/api/technicians/[id]/logs` | GET | core/always | manager | Staff management |
| `/api/technicians/[id]` | GET | core/always | manager | Staff management |
| `/api/technicians/[id]/stories` | GET | core/always | manager | Staff management |
| `/api/technicians` | GET | core/always | manager | Staff management |
| `/api/templates/[id]/use` | POST | core/always | authenticated | Story / customer-pay templates |
| `/api/templates` | GET | core/always | authenticated | Story / customer-pay templates |
| `/api/templates/save-from-story` | POST | core/always | authenticated | Story / customer-pay templates |
| `/api/upload` | POST | core/always | authenticated | Bay photo upload |
| `/api/users/[id]/password` | PATCH | core/always | manager | User admin |
| `/api/users/[id]` | PATCH DELETE | core/always | manager | User admin |
| `/api/users` | GET POST | core/always | manager | User admin |

## Deferred

| API path | Note |
|----------|------|
| `/api/modules/cdk-status` | Live CDK API deferred — clipboard paste only |

## Full matrix

| API path | Methods | Wrapper | Module | Roles | Pilot | Note |
|----------|---------|---------|--------|-------|-------|------|
| `/api/admin/usage` | GET | withAuth | — | admin | `pilot-optional` | Dealership admin usage analytics |
| `/api/advisors/[id]` | GET PATCH DELETE | withAuth | — | manager | `pilot-optional` | Service advisor metrics — some require DMS feed |
| `/api/advisors/resolve` | POST | withAuth | — | authenticated | `pilot-optional` | Service advisor metrics — some require DMS feed |
| `/api/advisors` | GET POST | withAuth | — | manager | `pilot-optional` | Service advisor metrics — some require DMS feed |
| `/api/advisors/summary` | GET | withAuth | — | manager | `pilot-optional` | Service advisor metrics — some require DMS feed |
| `/api/ai-jobs/[id]` | GET | withAuth | — | authenticated | `ops-gated` | Job status — requires durable AI path |
| `/api/audit-logs/latest` | GET | withAuth | — | authenticated | `pilot-core` | Manager audit trail |
| `/api/audit-logs/pdf-export` | POST | withAuth | — | authenticated | `pilot-core` | Manager audit trail |
| `/api/audit-logs` | GET | withAuth | — | manager | `pilot-core` | Manager audit trail |
| `/api/audit-logs/summary` | GET | withAuth | — | manager | `pilot-core` | Manager audit trail |
| `/api/auth/change-password` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/clerk/link` | GET POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/enter-dealership` | POST | withAuth | — | owner | `pilot-core` | Auth, MFA, session |
| `/api/auth/exit-dealership` | POST | withAuth | — | owner | `pilot-core` | Auth, MFA, session |
| `/api/auth/login` | POST | bare-or-other | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/logout` | GET POST DELETE | bare-or-other | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/me` | GET | bare-or-other | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/backup-codes` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/disable` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/enroll` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/login-verify` | POST | bare-or-other | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/self-recovery` | POST | withPublicRoute | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/setup` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/status` | GET | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/mfa/verify` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/password-recovery/confirm` | POST | withPublicRoute | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/password-recovery/request` | POST | withPublicRoute | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/preferences` | POST | withAuth | — | authenticated | `pilot-core` | Auth, MFA, session |
| `/api/auth/refresh` | GET POST | bare-or-other | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/auth/security-status` | GET | withAuth | — | manager | `pilot-core` | Auth, MFA, session |
| `/api/auth/select-dealership` | POST | bare-or-other | — | public-or-special | `pilot-core` | Auth, MFA, session |
| `/api/companion/poll` | GET | withAuth | — | authenticated | `pilot-core` | Desktop companion sync (LWW) |
| `/api/companion/publish` | POST | withAuth | — | authenticated | `pilot-core` | Desktop companion sync (LWW) |
| `/api/companion/stream` | GET | withAuth | — | authenticated | `pilot-core` | Desktop companion sync (LWW) |
| `/api/consent` | POST | withAuth | — | authenticated | `pilot-core` |  |
| `/api/dashboard/summary` | GET | withAuth | — | authenticated | `pilot-optional` |  |
| `/api/department-requests/[id]/lookups` | POST | withAuth | — | authenticated | `pilot-optional` | Parts/sales/service inboxes |
| `/api/department-requests/[id]/parts-lines` | PUT | withAuth | — | authenticated | `pilot-optional` | Parts/sales/service inboxes |
| `/api/department-requests/[id]` | GET PATCH | withAuth | — | authenticated | `pilot-optional` | Parts/sales/service inboxes |
| `/api/department-requests` | GET POST | withAuth | — | authenticated | `pilot-optional` | Parts/sales/service inboxes |
| `/api/diagnostics/extract` | POST | withAuth | — | authenticated | `pilot-core` | Diagnostic evidence extraction |
| `/api/grok/proxy` | POST | withAuth | — | authenticated | `ops-gated` | Grok proxy — server key required |
| `/api/health` | GET | withAuth | — | manager | `pilot-core` | Manager health matrix |
| `/api/hub/analytics` | GET | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/hub/appointments/[id]` | GET PATCH | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/hub/appointments` | GET POST | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/hub/audit` | GET | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/hub/conversations/[callId]/create-appointment` | POST | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/hub/conversations/[callId]/summarize` | POST | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/hub/national` | GET | withAuth | — | owner | `pilot-optional` | Requires calendar_hub |
| `/api/hub/timeline` | GET | withAuth | calendar_hub | manager | `pilot-optional` | Requires calendar_hub |
| `/api/images` | GET | withAuth | — | authenticated | `pilot-core` | Private evidence blobs |
| `/api/knowledge-base` | GET | withAuth | — | authenticated | `pilot-optional` |  |
| `/api/legal-disclaimer` | POST | withAuth | — | authenticated | `pilot-core` |  |
| `/api/loaner/assignments/[id]` | GET PATCH | withAuth | loaner | authenticated | `pilot-optional` | Requires loaner module |
| `/api/loaner/assignments` | GET POST | withAuth | loaner | authenticated | `pilot-optional` | Requires loaner module |
| `/api/loaner/vehicles/[id]` | GET PATCH | withAuth | loaner | authenticated | `pilot-optional` | Requires loaner module |
| `/api/loaner/vehicles` | GET POST | withAuth | loaner | authenticated | `pilot-optional` | Requires loaner module |
| `/api/maintenance/tickets/[id]/photos` | POST | withAuth | maintenance | authenticated | `pilot-optional` | Requires maintenance module |
| `/api/maintenance/tickets/[id]` | GET PATCH | withAuth | maintenance | authenticated | `pilot-optional` | Requires maintenance module |
| `/api/maintenance/tickets` | GET POST | withAuth | maintenance | authenticated | `pilot-optional` | Requires maintenance module |
| `/api/manager/center/live` | GET | withAuth | — | manager | `pilot-core` | Manager control center / MFA admin / encryption |
| `/api/manager/center/summary` | GET | withAuth | — | manager | `pilot-core` | Manager control center / MFA admin / encryption |
| `/api/manager/encryption/rotate` | GET POST | withAuth | — | manager | `pilot-core` | Manager control center / MFA admin / encryption |
| `/api/manager/mfa/reset` | POST | withAuth | — | manager | `pilot-core` | Manager control center / MFA admin / encryption |
| `/api/manager/mfa/roster` | GET | withAuth | — | manager | `pilot-core` | Manager control center / MFA admin / encryption |
| `/api/modules/cdk-status` | GET | withAuth | — | manager | `deferred` | Live CDK API deferred — clipboard paste only |
| `/api/modules` | GET PATCH | withAuth | — | manager | `pilot-core` | Entitlement toggles — keep non-core off in pilot |
| `/api/owner/billing` | GET | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/dealer-groups` | GET | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/dealership-advisors` | GET | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/dealerships` | GET | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/provision-dealer` | POST | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/select-dealer-group` | POST | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/summary` | GET | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/owner/warmup` | GET | withAuth | — | owner | `national-owner` | Platform / group owner console only |
| `/api/public/hub/appointment/[token]` | GET | withPublicRoute | — | public-or-special | `pilot-optional` |  |
| `/api/public/video/[token]/media` | GET | withPublicRoute | — | public-or-special | `pilot-optional` | Customer video share links |
| `/api/public/video/[token]` | GET | withPublicRoute | — | public-or-special | `pilot-optional` | Customer video share links |
| `/api/queue/ai-consumer` | POST | bare-or-other | — | public-or-special | `ops-gated` | Async AI jobs — requires queue consumer healthy |
| `/api/queue/job-events/[jobId]` | GET | withAuth | — | authenticated | `ops-gated` | Async AI jobs — requires queue consumer healthy |
| `/api/queue/job-status/[jobId]` | GET | withAuth | — | authenticated | `ops-gated` | Async AI jobs — requires queue consumer healthy |
| `/api/queue/jobs/[jobId]/cancel` | POST | withAuth | — | manager | `ops-gated` | Async AI jobs — requires queue consumer healthy |
| `/api/queue/jobs/[jobId]/retry` | POST | withAuth | — | manager | `ops-gated` | Async AI jobs — requires queue consumer healthy |
| `/api/queue/jobs` | GET | withAuth | — | manager | `ops-gated` | Async AI jobs — requires queue consumer healthy |
| `/api/repair-orders/[id]/lines/[lineId]/apply-customer-pay-template` | POST | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/certify-story` | POST | withStoryAiRoute | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/clear-customer-pay` | POST | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/generate-story` | POST | withStoryAiRoute | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/review-story` | POST | withStoryAiRoute | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]` | PATCH | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/score-story` | POST | withStoryAiRoute | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]/lines/[lineId]/sold-metrics` | PATCH | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/[id]` | GET PUT DELETE | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders/extract` | POST | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/repair-orders` | GET POST | withAuth | — | authenticated | `pilot-core` | Core RO + story pipeline — pilot required |
| `/api/session/warmup` | GET | withAuth | — | authenticated | `pilot-core` | Bay session warmup |
| `/api/setup/seed` | POST | bare-or-other | — | public-or-special | `internal` | Bootstrap only — blocked in production without SETUP_SECRET |
| `/api/status` | GET | withPublicRoute | — | public-or-special | `public` | Public liveness |
| `/api/technician-logs` | POST | withAuth | — | authenticated | `unknown` |  |
| `/api/technicians/[id]/logs` | GET | withAuth | — | manager | `pilot-core` | Staff management |
| `/api/technicians/[id]` | GET | withAuth | — | manager | `pilot-core` | Staff management |
| `/api/technicians/[id]/stories` | GET | withAuth | — | manager | `pilot-core` | Staff management |
| `/api/technicians` | GET | withAuth | — | manager | `pilot-core` | Staff management |
| `/api/templates/[id]/use` | POST | withAuth | — | authenticated | `pilot-core` | Story / customer-pay templates |
| `/api/templates` | GET | withAuth | — | authenticated | `pilot-core` | Story / customer-pay templates |
| `/api/templates/save-from-story` | POST | withAuth | — | authenticated | `pilot-core` | Story / customer-pay templates |
| `/api/upload` | POST | withAuth | — | authenticated | `pilot-core` | Bay photo upload |
| `/api/users/[id]/password` | PATCH | withAuth | — | manager | `pilot-core` | User admin |
| `/api/users/[id]` | PATCH DELETE | withAuth | — | manager | `pilot-core` | User admin |
| `/api/users` | GET POST | withAuth | — | manager | `pilot-core` | User admin |
| `/api/video-inspections/[id]/findings` | GET PUT | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/[id]/generate-report` | POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/[id]/media` | GET | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/[id]` | GET PATCH | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/[id]/send-sms` | POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/[id]/share` | POST DELETE | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections` | GET POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/upload/chunk` | POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/upload/complete` | POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/upload/init` | POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/video-inspections/upload` | POST | withAuth | video_mpi | authenticated | `pilot-optional` | Gated by module video_mpi |
| `/api/vin/decode` | POST | withAuth | — | authenticated | `pilot-optional` |  |
| `/api/voice/[department]/query` | POST | withAuth | — | authenticated | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/calls/[id]/recording/media` | GET | withAuth | voice_agent | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/calls/[id]` | GET | withAuth | voice_agent | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/calls` | GET | withAuth | voice_agent | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/customizations/[department]` | GET POST | withAuth | — | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/customizations` | GET PUT | withAuth | — | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/gather` | POST | bare-or-other | — | public-or-special | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/inbound` | POST | bare-or-other | — | public-or-special | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/lines` | GET POST | withAuth | voice_agent | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/metrics` | GET | withAuth | voice_agent | manager | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/realtime/session` | GET POST | withAuth | voice_agent | authenticated | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/recording` | POST | bare-or-other | — | public-or-special | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/voice/status` | POST | bare-or-other | — | public-or-special | `pilot-optional` | Requires voice_agent + Twilio ops |
| `/api/webhooks/clerk` | POST | bare-or-other | — | public-or-special | `ops-gated` | External webhooks — signature verified |

---

*Do not hand-edit this file. Update overrides or routes, then regenerate.*
