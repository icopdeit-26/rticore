-- RTICORE 0050: Governance Team login roles (governance_leader = Leader, governance_member = Member).
-- Both roles are scoped by the API to Governance, Risk & Compliance delivery projects (service
-- catalog group "Governance, Risk & Compliance": Cybersecurity Governance, GRC / Risk Management,
-- ISO 27001 / ISMS, ISO 27701, PDP / Data Privacy, DPO as a Service, IT Audit, IT Governance,
-- ICOFR, BCM / BCP / DRP, Third Party Risk) where the account has an active resource allocation
-- (rticore_resource_people.email). governance_leader additionally reviews its team's timesheets
-- on those projects and reads GRC Feasibility plans (read-only). Neither role is PM-eligible and
-- neither has ERP capability, so the ERP role matrix (0049) and PM triggers (0047) are unchanged.
-- Apply to a BACKED UP environment, after 0048 (offense) and 0049 (defense).
--
-- SQLite cannot alter a CHECK constraint. Same copy/drop/recreate pattern as 0047-0049: deferred
-- foreign keys let the refilled parent rows satisfy their children at COMMIT, and no
-- ALTER TABLE RENAME is used, so dependent triggers stay valid. The CHECK keeps every role
-- added by earlier migrations.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE rticore_members_backup_0050 AS SELECT email,role,active,created_at,created_by FROM rticore_members;
DROP TABLE rticore_members;
CREATE TABLE rticore_members (
 email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','viewer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 created_by TEXT
);
INSERT INTO rticore_members(email,role,active,created_at,created_by)
 SELECT email,role,active,created_at,created_by FROM rticore_members_backup_0050;
DROP TABLE rticore_members_backup_0050;
