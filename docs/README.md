# Merlin Documentation Library

**Product:** Merlinus — Modular Dealership OS + Warranty Narrative Platform  
**Version:** 4.1.0  
**Entry point:** [Modular OS Overview](./Modular-OS-Overview.md) · [Main README](../README.md)

---

## Start here by role

| Role | Read first | Then use |
|------|------------|----------|
| **Ops / multi-rooftop rollout** | **[Rollout Runbook](./Rollout-Runbook.md)** (canonical sequence) | [Production-Readiness-Checklist](./Production-Readiness-Checklist.md) |
| **General Manager / Fixed Ops Director** | [Modular OS Overview](./Modular-OS-Overview.md) · [Master Rollout Document](./Master-Rollout-Document.md) | [Go-Live Summary](./Go-Live-Summary.md) |
| **Service Manager** | [Modular OS Overview](./Modular-OS-Overview.md) · [Master Rollout Document](./Master-Rollout-Document.md) | [Rollout Checklist](./Rollout-Checklist.md) · [Go-Live Email](./Go-Live-Email-Template.md) |
| **Dealership IT** | [Admin Setup Guide](./Admin-Setup-Guide.md) · [Rollout Runbook](./Rollout-Runbook.md) | [Go-Live Checklist](./Go-Live-Checklist.md) · [Support Playbook](./Support-Playbook.md) |
| **Trainer / Lead Technician** | [Training Outline](./Training-Outline.md) | [Technician Quick Start](./Technician-Quick-Start.md) |
| **Service Technician** | [Bay Reference Card](./Bay-Reference-Card.md) | [Technician Quick Start](./Technician-Quick-Start.md) |

---

## Complete document index

### Leadership & strategy
| Document | Purpose |
|----------|---------|
| [Modular-OS-Overview.md](./Modular-OS-Overview.md) | Feature-complete modular OS summary, architecture, pilot scenarios |
| [**Rollout-Runbook.md**](./Rollout-Runbook.md) | **Canonical multi-store rollout sequence** (prefer over older overlapping checklists) |
| [Multi-Tenant-Isolation.md](./Multi-Tenant-Isolation.md) | **Application-layer RLS on D1 (not true DB RLS)** + risk acceptance |
| [CDK-Sync-Deferred.md](./CDK-Sync-Deferred.md) | Why live CDK API is deferred; clipboard paste remains (P3-3) |
| [Master-Rollout-Document.md](./Master-Rollout-Document.md) | Leadership rollout overview (v4.1.0) |
| [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) | **CISO / legal residual risk sign-off** |
| [Go-Live-Summary.md](./Go-Live-Summary.md) | One-page executive approval brief |

### Enterprise reference (IT, legal, due diligence)
| Document | Purpose |
|----------|---------|
| [Technical-Specification-and-Architecture.md](./Technical-Specification-and-Architecture.md) | System design, workflows, API routes, voice architecture |
| [Compliance-Security-Audit-and-Legal.md](./Compliance-Security-Audit-and-Legal.md) | Security controls, audit spec, legal framework |
| [Full-Enterprise-Audit-History-and-Validation.md](./Full-Enterprise-Audit-History-and-Validation.md) | Historical audit notes (do not treat badge scores as current readiness) |
| [Deployment-Checklist-and-Operations.md](./Deployment-Checklist-and-Operations.md) | Environment variables, pre-rollout, Cloudflare Workers KV/D1, go-live checklists |

### Technical setup
| Document | Purpose |
|----------|---------|
| [Admin-Setup-Guide.md](./Admin-Setup-Guide.md) | Environment, validation, monitoring, encryption |
| [Product-Modules.md](./Product-Modules.md) | Product module catalog, seed defaults, manager toggles, core_story rule |
| [Apex-National-Platform.md](./Apex-National-Platform.md) | Apex modes, owners, fortress summary, onboarding pointer |
| [Apex-Dealer-Onboarding.md](./Apex-Dealer-Onboarding.md) | Secure multi-rooftop provision CLI, forced password, smoke tests |
| [Apex-DealerGroup-Owner-Dashboard.md](./Apex-DealerGroup-Owner-Dashboard.md) | DealerGroup model, group owner login, dashboard tiers G1–G5 |
| [Security-Fortress.md](./Security-Fortress.md) | App-layer tenancy (D1), audits, MFA, dual-key encryption — not Postgres RLS |

### Rollout execution
| Document | Purpose |
|----------|---------|
| [Rollout-Checklist.md](./Rollout-Checklist.md) | Full phased checklist (pre → day-of → post) |
| [Go-Live-Checklist.md](./Go-Live-Checklist.md) | Final go/no-go 24–48 hours before launch |
| [Go-Live-Deployment-Checklist.md](./Go-Live-Deployment-Checklist.md) | Deploy-time production checklist (env, modules, smoke) |
| [**Production-Readiness-Checklist.md**](./Production-Readiness-Checklist.md) | **SSoT go-live / national multi-rooftop sign-off** |
| [Buyer-Risk-Acceptance-Summary.md](./Buyer-Risk-Acceptance-Summary.md) | CISO/legal residual risk acceptance (app-layer D1 tenancy, etc.) |
| [Go-Live-Email-Template.md](./Go-Live-Email-Template.md) | Team announcement emails |

### Technician materials
| Document | Purpose |
|----------|---------|
| [Technician-Quick-Start.md](./Technician-Quick-Start.md) | Full bay-floor guide |
| [Bay-Reference-Card.md](./Bay-Reference-Card.md) | Laminated card — print instructions |
| [Bay-Reference-Card-Front.md](./Bay-Reference-Card-Front.md) | Card front layout |
| [Bay-Reference-Card-Back.md](./Bay-Reference-Card-Back.md) | Card back layout |

### Training & support
| Document | Purpose |
|----------|---------|
| [Training-Outline.md](./Training-Outline.md) | 30–45 minute hands-on session |
| [Support-Playbook.md](./Support-Playbook.md) | IT/SM troubleshooting and escalation |

### Screenshots
| Folder | Purpose |
|--------|---------|
| [images/](./images/) | Technician Quick Start screenshots (add before print) |

---

## Recommended rollout order

1. [Master Rollout Document](./Master-Rollout-Document.md) — leadership approval  
2. [Admin Setup Guide](./Admin-Setup-Guide.md) — IT provisioning + `npm run validate:pre-rollout`  
3. [Rollout Checklist](./Rollout-Checklist.md) Phase 1  
4. [Go-Live Checklist](./Go-Live-Checklist.md) — final sign-off  
5. [Training Outline](./Training-Outline.md) + [Bay Reference Card](./Bay-Reference-Card.md) — go-live day  
6. [Support Playbook](./Support-Playbook.md) — first two weeks post-launch  

---

*Replace `[BRACKETED]` placeholders in each document before distributing to dealerships.*