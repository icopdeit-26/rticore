# 10. RTICore V4.0 Enterprise API Documentation

All APIs are gated by `src/middleware.ts` (Origin/CSRF enforcement on Hostinger, legacy demo endpoints fail-closed with `503`) and individually authorized server-side via `authorizeBoQ()` (`src/lib/boq-auth.ts`).

## New V4.0 Enterprise Endpoints (Migrations 0053–0055)

| Endpoint | Methods | Purpose | Authorization & Isolation |
|---|---|---|---|
| `/api/admin/feature-flags` | `GET`, `POST` | Request (`admin`) & independently approve (`admin`/`approver`, SoD) feature flags | Server RBAC + SoD (`approved_by != requested_by`) |
| `/api/erp/service-catalog` | `GET`, `POST` | Manage 29-category service master, 12-phase activity templates, complexity matrix, 19-role rate cards | Legal entity scoped; `internal_cost_rate_cents` masked for non-Finance/Admin |
| `/api/erp/pricing-engine` | `GET`, `POST` | Simulate 14 pricing methods, block negative margin, prevent Sales cost override, approve & freeze immutable SHA-256 snapshot, record historical benchmarks | Legal entity scoped + SoD + immutable snapshot |
| `/api/erp/flexguard-enterprise` | `GET`, `POST` | Package builder, versioned conversion matrix, 12-type immutable ledger, 14-step service request workflow, SLA breach logging, Finance outbox bridge, portal grants | Legal entity scoped + idempotency + double-spend guard + SoD |
| `/api/portal/flexguard` | `GET`, `POST` | Customer Portal: balance, lots, history, monthly statement, submit request, approve scope, accept delivery | Strictly scoped to customer's `rticore_flexguard_portal_grants`; recursive sanitizer strips all internal costs/margins |
| `/api/erp/cyber-grc-cti` | `GET`, `POST` | CTI cases & 9 IOC types (M14), GRC engagements across 10 frameworks (M15), Enterprise Risk & Control Register with independent testing (M27) | Legal entity scoped + SoD (`tested_by != control_owner_email`) |
| `/api/erp/executive-command` | `GET` | Real-time live DB KPIs for Commercial, Service Profitability, Resource, FlexGuard, Budget & Risk (M01) | `admin`, `finance`, `approver` + legal entity scoped |
| `/api/erp/operations-jobs` | `GET`, `POST` | Durable background job queue enqueue/DLQ retry (H08), encrypted backup/DR drill registry & SoD verification (H11), unified audit explorer (M30) | `admin`, `approver`, `finance`, `itdev_leader` + SoD |
| `/api/erp/cyber-delivery` | `GET`, `POST` | VAPT Engagement lifecycle & RoE SoD authorization, CVSS findings & QA/retest (M11), DFIR incidents & immutable Chain of Custody (M13), SOC/MDR SLA & profitability (M12) | Team roles (`offense_*`, `defense_*`), `pm`, `approver`, `finance`, `admin` + entity isolation |
| `/api/erp/enterprise-approvals` | `GET` | Unified Cross-Module SoD Approval Inbox across Service Catalog, Rate Cards, Pricing, FlexGuard Packages/Adjustments, VAPT RoE, Feature Flags & DR Drills | `admin`, `approver`, `finance`, `project_manager`; strictly excludes maker's own items |
| `/api/erp/finance-docking-bridge` | `GET`, `POST` | Inspect & process operational outbox events emitted by FlexGuard, Timesheets, Procurement, Milestones, Invoices, Payments & Contracts | `admin`, `finance`, `approver`; fail-closed `503` on Hostinger pending Finance certification |
| `/api/health/live` & `/api/health/ready` | `GET` | Liveness & DB readiness probe with `X-Request-Id` correlation ID & DB latency ms (fail-closed `503` without prod config; Finance status explicitly reported) | Loopback / Nginx health route |
