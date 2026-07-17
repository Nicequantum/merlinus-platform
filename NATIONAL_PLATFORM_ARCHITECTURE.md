# Maybach Tech National Platform Architecture
## Mercedes-Maybach Dealer Network Warranty Story System

**Document Version:** 1.0  
**Date:** 2026-05-31  
**Status:** Strategic Planning Document

---

## 1. Executive Summary

Maybach Tech started as a high-quality client-side PWA that helps individual Mercedes-Maybach technicians generate compliant, natural-sounding warranty stories using Grok AI and a carefully engineered master technician prompt.

This document outlines how to evolve Maybach Tech from a **single-technician tool** into a **national-scale platform** that can be deployed across hundreds or thousands of dealerships, delivering massive throughput, standardization, compliance, and business intelligence while maintaining the core strength of high-quality AI-generated warranty stories.

**Vision:** Become the de facto internal warranty story platform for Mercedes-Maybach dealerships across North America (and eventually globally).

---

## 2. Current State Analysis

### What Exists Today (v2.0)

**Strengths:**
- Excellent UX (clean, professional, iOS-like dark theme)
- Strong domain-specific prompt engineering (the exact 18-year master tech prompt)
- Real Grok API integration with rich context (vehicle data, repair lines, Xentry extracted data)
- On-device OCR using Tesseract.js (privacy-friendly for initial scanning)
- Simple Settings screen with local Grok API key storage
- Gear icon in top-right of main screen
- Fully functional PWA (installable, works offline for basic use)

**Critical Limitations for National Scale:**

| Category              | Current State                          | National Requirement                     | Gap Severity |
|-----------------------|----------------------------------------|------------------------------------------|--------------|
| **Data Storage**      | localStorage only                      | Centralized, queryable, auditable DB     | Critical     |
| **Authentication**    | None                                   | SSO, RBAC, dealership hierarchy          | Critical     |
| **Multi-tenancy**     | None                                   | Dealer isolation + corporate oversight   | Critical     |
| **AI Governance**     | User brings own Grok key               | Centralized key management + cost control| Critical     |
| **Integrations**      | None                                   | Xentry, DMS, Warranty Portal             | High         |
| **Workflow**          | Single user, no approvals              | Multi-stage approval + audit trail       | High         |
| **Analytics**         | Zero                                   | Dealer + Regional + National dashboards  | High         |
| **Compliance**        | None                                   | Audit logs, data retention, export       | High         |
| **Scalability**       | Single device                          | Thousands of concurrent users            | High         |

**Bottom line:** The current app is an outstanding **proof of concept and prompt foundation**. It is not yet enterprise software.

---

## 3. Target Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│  (React + TS PWA - Mobile First, Desktop Admin)                 │
│  - Bay Mode (technicians)                                       │
│  - Manager Dashboard                                            │
│  - Corporate Analytics Portal                                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                     API Gateway + BFF                           │
│  (Node.js / Go / .NET) - Auth, Rate Limiting, Tenant Routing    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
     ┌─────────────────────────┼─────────────────────────┐
     ▼                         ▼                         ▼
┌──────────────┐      ┌────────────────┐      ┌──────────────────┐
│   Auth &     │      │   Application  │      │   AI Gateway     │
│   Identity   │      │   Services     │      │   (Grok Proxy)   │
│  (Auth0 /    │      │  (Node/.NET)   │      │                  │
│   Clerk)     │      │                │      │  - Key rotation  │
└──────────────┘      └───────┬────────┘      │  - Prompt mgmt   │
                              │               │  - Cost tracking │
                              ▼               └──────────────────┘
                    ┌──────────────────┐
                    │   PostgreSQL     │
                    │   + Row Level    │
                    │   Security       │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Object Storage  │
                    │  (Xentry images) │
                    └──────────────────┘
```

### Core Principles for National Scale

1. **Multi-Tenant by Design** (every table has `dealer_id` + RLS)
2. **API-First** (mobile, web, future integrations)
3. **Offline-First + Smart Sync**
4. **AI as a Controlled Service** (never let client call Grok directly)
5. **Audit Everything** (immutable logs for warranty compliance)
6. **Progressive Enhancement** (works great for small dealers, powerful for large groups)

---

## 4. Recommended Technology Stack

| Layer                  | Recommendation                          | Rationale |
|------------------------|-----------------------------------------|---------|
| **Frontend**           | React + TypeScript + Tailwind + Vite   | Keep current strengths |
| **Mobile Experience**  | Same PWA + Capacitor (optional native) | One codebase |
| **Admin Portal**       | Same React app (different routes/roles)| Consistency |
| **Backend**            | Node.js (NestJS) or Go (Fiber/Echo)    | Fast development + performance |
| **Database**           | PostgreSQL + Row Level Security        | Best multi-tenant support |
| **Real-time**          | Supabase Realtime / Pusher / Socket.io | Live approvals & notifications |
| **Object Storage**     | S3-compatible (Cloudflare R2 or AWS)   | Cheap + durable for images |
| **Auth**               | Auth0 or Clerk (with B2B/SSO)          | Dealer SSO + fine-grained permissions |
| **AI Gateway**         | Custom Node/Go service + Redis         | Centralized Grok calls, prompt versioning, cost control |
| **Background Jobs**    | BullMQ / Temporal / Inngest            | OCR processing, batch generation, integrations |
| **Analytics**          | ClickHouse or BigQuery + Metabase      | High-volume analytics |
| **Infrastructure**     | Vercel / Railway / AWS + Kubernetes    | Start simple, scale when needed |
| **Observability**      | OpenTelemetry + Grafana + Sentry       | Critical at national scale |

**Alternative "Faster Start" Stack (recommended for Phase 1):**
- **Supabase** (Postgres + Auth + Storage + Realtime + Edge Functions)
- React + TypeScript frontend
- Edge Functions for Grok proxy
- This gets you to multi-tenant + auth extremely fast

---

## 5. Data Model (Core Entities)

```sql
-- Core Multi-Tenant Structure
dealers
users
user_dealer_roles          -- RBAC

repair_orders
repair_lines
warranty_stories           -- versioned
story_approvals
story_attachments          -- Xentry images + metadata

prompt_versions            -- centralized prompt management
ai_usage_logs              -- cost & quality tracking

audit_logs                 -- immutable

-- Integration Tables
xentry_sessions
dms_sync_status
warranty_submission_logs
```

**Key Relationships:**
- `repair_orders` → belongs to `dealer`
- `warranty_stories` → belongs to `repair_line`
- Every story has `created_by`, `approved_by`, `submitted_to_mb_at`
- Full history via `audit_logs` and story versions

---

## 6. Prioritized Feature Roadmap

### Phase 1: Foundation (0-4 months) – Make it Enterprise-Ready

**Top 10 Features for Fastest Dealer Adoption** (prioritized):

1. **Multi-tenant Backend + Authentication** (SSO for dealers)
2. **Cloud-synced Repair Orders & Stories** (replace localStorage)
3. **Role-Based Access Control** (Tech / Advisor / Warranty Admin / Dealer Owner)
4. **Centralized Grok API Proxy** (dealers never paste personal keys)
5. **Basic Approval Workflow** (Tech → Service Manager → Warranty Admin)
6. **Audit Trail** for every story (critical for warranty compliance)
7. **Dealer Settings & Branding** (logo, approval rules, default prompt overrides)
8. **Improved OCR + Manual Editing Tools** (better RO parsing)
9. **Story Template Library** (pre-approved templates per common repair type)
10. **Basic Dealer Dashboard** (stories submitted this month, rejection rate, average time)

**Also in Phase 1:**
- Proper offline sync with conflict resolution
- Image storage (move base64 out of localStorage)
- Version history for stories

### Phase 2: Throughput & Integration (4-9 months)

- Xentry integration (pull real diagnostic data)
- DMS integration (CDK, Reynolds, etc.)
- Labor time & parts auto-suggestion
- Bulk story generation + review queue
- Push notifications for approvals
- Advanced prompt management (versioning + A/B testing)
- Technician performance scoring

### Phase 3: National Intelligence Layer (9-15 months)

- National + Regional analytics dashboards
- Common failure mode detection
- RAG over approved stories (internal knowledge base)
- Predictive repair suggestions
- Cost optimization engine
- Anomaly / fraud detection in claims
- Corporate oversight tools (for Mercedes-Maybach or large dealer groups)

### Phase 4: Platform & Ecosystem

- Public API for large dealer groups
- White-label capabilities
- Training & certification modules inside the app
- Integration marketplace
- Mobile native apps (if PWA isn't enough)
- Internationalization (Canada, Mexico, Europe)

---

## 7. Security & Compliance Requirements

- **Data Classification**: VINs + customer data = sensitive
- **Encryption**: At rest + in transit
- **Access Control**: Least privilege + just-in-time
- **Audit**: Every read/write on stories must be logged
- **Data Retention**: Configurable per dealer + corporate rules
- **Right to be Forgotten** support
- **SOC 2 / ISO 27001** path (required for large dealer groups)
- **Mercedes-Maybach Security Review** (they will demand it)

---

## 8. Phased Implementation Plan

### Phase 1: "Dealer-Ready" (MVP for First 10-50 Dealerships)

**Goal:** Get 5-10 pilot dealers using it daily within 4 months.

**Stack Recommendation:** Supabase (fastest path) + React frontend

**Key Milestones:**
- Month 1: Backend + Auth + Multi-tenancy
- Month 2: Cloud sync + Role system + Approval workflow
- Month 3: Grok proxy + Prompt versioning + Audit logs
- Month 4: Pilot dealers + Feedback loop

### Phase 2: Scale & Integrate

Add real integrations and higher throughput features.

### Phase 3: Intelligence & National Rollout

Build the analytics and AI advantage that creates network effects.

---

## 9. Business & Go-to-Market Considerations

- **Pricing Tiers**: Per technician + per story (after allowance) + Enterprise
- **Onboarding**: Self-serve for small dealers + white-glove for large groups
- **Change Management**: This is the #1 risk. Technicians hate extra work.
- **Mercedes-Maybach Relationship**: Decide early — partner, independent, or acquisition target.
- **Competitive Moat**: The quality of your prompt library + approved story corpus will be extremely hard to replicate.

---

## 10. Immediate Next Steps (Recommended)

1. **Decide on Backend Strategy** (Supabase for speed vs custom for control)
2. **Build Auth + Multi-tenancy spike** (2-3 weeks)
3. **Create a proper data model** and migrate from localStorage
4. **Build the Grok proxy service** (critical security item)
5. **Design the approval workflow** with real service managers
6. **Start pilot conversations** with 3-5 friendly dealerships

---

## Conclusion

The current Maybach Tech app contains **one of the most valuable assets** for this vision: a battle-tested, high-quality prompt that produces stories that actually pass review.

The technology to scale it exists today. The biggest challenges will be:

- **Product**: Making it faster and less work for technicians than current methods
- **Go-to-Market**: Getting dealer groups to trust and adopt it
- **Partnerships**: Xentry/DMS integrations and relationship with Mercedes-Maybach

Would you like me to expand any section into a full spec (e.g., detailed database schema, API design, or Phase 1 project plan with user stories)?

I can also create a separate **"Pilot Dealer Onboarding Playbook"** if that would be helpful.

---

## Appendix A: Detailed Database Schema

```sql
-- Core Entities for National Scale

CREATE TABLE dealers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  dealer_code TEXT UNIQUE,
  address TEXT,
  contact_email TEXT,
  sso_config JSONB,  -- For enterprise SSO
  settings JSONB,    -- Branding, approval rules, default prompts
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  auth_provider TEXT,  -- 'auth0', 'clerk', etc.
  external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_dealer_roles (
  user_id UUID REFERENCES users(id),
  dealer_id UUID REFERENCES dealers(id),
  role TEXT NOT NULL,  -- 'technician', 'service_advisor', 'warranty_admin', 'dealer_owner', 'corporate'
  permissions JSONB,
  PRIMARY KEY (user_id, dealer_id)
);

CREATE TABLE repair_orders (
  id UUID PRIMARY KEY,
  dealer_id UUID REFERENCES dealers(id) NOT NULL,
  ro_number TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  vehicle JSONB NOT NULL,  -- {vin, year, model, mileage_in, mileage_out}
  customer JSONB,          -- {name, phone, etc.}
  complaints TEXT[],       -- A, B, C lines extracted from RO
  status TEXT DEFAULT 'in_progress',  -- in_progress, submitted, approved, rejected
  metadata JSONB
);

CREATE TABLE repair_lines (
  id UUID PRIMARY KEY,
  ro_id UUID REFERENCES repair_orders(id) NOT NULL,
  line_number INT,
  description TEXT,
  customer_concern TEXT,
  technician_notes TEXT,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE warranty_stories (
  id UUID PRIMARY KEY,
  line_id UUID REFERENCES repair_lines(id) NOT NULL,
  version INT DEFAULT 1,
  story_text TEXT NOT NULL,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  prompt_version_id UUID,
  ai_model TEXT,
  confidence_score FLOAT,
  is_approved BOOLEAN DEFAULT FALSE
);

CREATE TABLE story_approvals (
  id UUID PRIMARY KEY,
  story_id UUID REFERENCES warranty_stories(id),
  approver_id UUID REFERENCES users(id),
  role TEXT,
  decision TEXT,  -- approved, rejected, needs_revision
  comments TEXT,
  approved_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE story_attachments (
  id UUID PRIMARY KEY,
  line_id UUID REFERENCES repair_lines(id),
  type TEXT,  -- 'xentry_quick_test', 'guided_test', 'ro_photo'
  storage_path TEXT,  -- S3/R2 path
  extracted_data JSONB,  -- OCR + parsed codes, voltages, pins, etc.
  uploaded_by UUID,
  uploaded_at TIMESTAMPTZ
);

CREATE TABLE prompt_versions (
  id UUID PRIMARY KEY,
  version INT,
  prompt_text TEXT NOT NULL,
  approved_by UUID,
  effective_date TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE ai_usage_logs (
  id UUID PRIMARY KEY,
  dealer_id UUID,
  user_id UUID,
  ro_id UUID,
  line_id UUID,
  model TEXT,
  tokens_used INT,
  cost_cents INT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  dealer_id UUID,
  user_id UUID,
  action TEXT,  -- 'create_ro', 'generate_story', 'approve', 'view'
  entity_type TEXT,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance at scale
CREATE INDEX idx_ro_dealer ON repair_orders(dealer_id, created_at DESC);
CREATE INDEX idx_stories_line ON warranty_stories(line_id, version);
CREATE INDEX idx_audit_dealer_time ON audit_logs(dealer_id, timestamp DESC);
```

This schema supports full history, auditing, multi-version stories, and analytics queries.

---

## Appendix B: Key API Endpoints (REST + WebSocket for real-time)

**Auth & Tenant**
- POST /auth/login (SSO redirect)
- GET /me (current user + dealers)

**RO Management**
- GET /dealers/{dealerId}/ros?search=...&status=... (paginated list for history)
- POST /dealers/{dealerId}/ros (from scan or manual)
- GET /ros/{roId}
- PUT /ros/{roId} (update vehicle, complaints)
- POST /ros/{roId}/lines (add repair line)
- POST /lines/{lineId}/xentry-photos (upload + auto-OCR + extract)
- GET /lines/{lineId}/story (get latest version)
- POST /lines/{lineId}/generate-story (triggers Grok with full context + history examples)

**Workflow**
- POST /stories/{storyId}/submit-for-approval
- POST /approvals (approve/reject with comments)
- GET /dealers/{dealerId}/review-queue (for advisors/admins)

**AI & Governance**
- GET /prompts (current + history)
- POST /prompts (new version, requires approval)
- GET /dealers/{dealerId}/ai-usage (cost reports)

**Analytics (National)**
- GET /analytics/dealers/{dealerId}/summary
- GET /analytics/national/failure-modes?period=90d
- GET /analytics/corporate/cost-trends

**WebSocket**
- /ws/dealer/{dealerId} : real-time updates for approvals, new ROs, etc.

All endpoints enforce tenant isolation and RBAC.

---

## Appendix C: Phase 1 Detailed Project Plan (MVP - 16 weeks)

**Week 1-2: Foundation**
- Set up Supabase project + multi-tenant schema
- Implement Auth0 integration with dealer groups
- Backend: basic RO CRUD with RLS
- Frontend: update current PWA to call new API instead of localStorage
- Migrate existing local data on first login

**Week 3-4: Core Workflow**
- Add repair lines + Xentry photo upload (multi-file, auto-OCR + parse)
- Implement generate story via backend proxy (inject full prompt + history examples)
- Basic approval: submit -> advisor review UI
- Audit logging on all mutations

**Week 5-6: History & Search**
- Home screen: searchable list of all ROs (with thumbnails, status)
- Re-open full RO with photos, data, stories
- Versioning for stories

**Week 7-8: AI Governance**
- Grok proxy service (central keys, rate limiting, logging usage)
- Prompt versioning admin UI (corporate can update the master prompt)
- Include last N similar stories in context for "learning"

**Week 9-10: Dealer Experience**
- Dealer settings page (branding, rules)
- Role-based UI (hide approvals for techs)
- Offline support: queue changes, sync on reconnect

**Week 11-12: Integrations Spike**
- Xentry auth flow (per dealer)
- Basic DMS mock integration

**Week 13-14: Analytics & Polish**
- Dealer dashboard (volume, approval %, top issues)
- Export PDF/CSV for stories
- Polish UI, PWA install, performance

**Week 15-16: Pilot & Hardening**
- Deploy to 3-5 pilot dealers
- Feedback loop, bug fixes
- SOC2 prep (logging, access controls)
- Onboarding docs + training video

**Success Metrics for Phase 1:**
- 80% of stories approved on first try
- Techs generate story in <5 min after RO scan
- Zero data loss
- Positive NPS from pilot techs/managers

---

## Appendix D: Security & Compliance Deep Dive

- **Auth**: OIDC + JWT, short-lived tokens, refresh with rotation.
- **Data at Rest**: AES-256 in Postgres + encrypted object storage.
- **Data in Transit**: TLS 1.3 everywhere.
- **Access**: JWT claims include dealer_id; backend enforces RLS + RBAC.
- **Audit**: Every action logged to immutable table (append-only, no deletes).
- **Privacy**: VINs tokenized where possible; customer PII redacted in AI prompts.
- **Grok Calls**: Proxied; no customer data sent unless necessary (VINs masked in examples).
- **Compliance Path**:
  - Start with basic logging.
  - Target SOC 2 Type I by end of Phase 1.
  - GDPR/CCPA data export/delete endpoints.
  - Annual third-party pen test.

**Mercedes-Maybach Specific**: Expect them to require:
- Data residency in US.
- Ability to audit all stories.
- Integration with their warranty submission system (eventual auto-submit).

---

## Appendix E: Pilot Dealer Onboarding Playbook (Summary)

1. **Discovery Call** (1hr): Understand current process, pain points, volume.
2. **Setup** (1 day):
   - Create dealer tenant in platform.
   - Configure SSO if available.
   - Import sample ROs or run training session.
3. **Training** (2-4 hrs):
   - Scan RO demo.
   - Add Xentry photos.
   - Generate/approve story.
   - View history & analytics.
4. **Pilot Period** (4-6 weeks):
   - Daily use by 5-10 techs.
   - Weekly feedback calls.
   - Track metrics: time per story, rejection rate vs baseline.
5. **Go/No-Go**: If >70% adoption and positive feedback, expand.

**Materials**:
- Quickstart video (5 min)
- Cheat sheet for techs
- Admin guide for managers

---

This completes the core architecture document with expansions.

Next actions for you:
- Review this and pick 1-2 appendices to go deeper on (e.g. full OpenAPI spec).
- We can start implementing Phase 1 in code here if ready (e.g. add Supabase client to the current Vite app as a spike).

Let me know how you'd like to proceed! The current app (with the gear/settings and basic history) is a great starting point for the frontend evolution.