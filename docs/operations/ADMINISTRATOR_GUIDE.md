# 19. System Administrator Guide (M30)

## Key Administrative Workspaces
- **User & Role Registry:** `/boq/users` — provision active staff in `rticore_members` with least-privilege roles.
- **Organization & Legal Entities:** `/erp/organization` — manage `legal_entity`, `division`, `department`, `team`, `cost_center`, and dual-controlled staff-to-entity assignments (`rticore_erp_staff_org`).
- **Service Catalog & 19-Role Rate Cards:** `/erp/service-catalog` — Admin/Finance configure rate cards; independent Approver activates versions (immutable once approved).
- **Feature Flags Governance:** `POST /api/admin/feature-flags` — all new features start `enabled=0` (`pending`) and require independent second Admin/Approver activation (`approved_by != requested_by`).
- **Operations Center & Unified Audit Explorer:** `/erp/operations-center` — monitor durable background jobs (`rticore_background_jobs`), retry dead-letter items, verify encrypted backup/DR drills (`rticore_backup_drills`), and audit cross-domain events (`rticore_operations_events`).
- **Platform Diagnostics:** `/platform/diagnostics` — read-only health and audit telemetry for Admin and IT Dev Leader.

## Operational Commands
- Local dev setup: `npm run local:setup -- --admin admin@company.co.id`
- Trigger generation & parity check: `node scripts/generate-postgres-triggers.mjs && npm run test:pg-triggers`
- Full 1,203+ UAT suite: `npm run test:uat-1200`
- Hostinger preflight: `npm run preflight:hostinger`
- Encrypted DR rehearsal: `npm run drill:backup-restore`
