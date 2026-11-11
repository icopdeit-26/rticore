-- RTICORE 0051: IT Developer Team login roles (itdev_leader = Leader, itdev_member = Member).
-- Delivery duty: both roles are scoped by the API to Technology & Implementation delivery projects
-- (Cybersecurity Technology, SIEM / SOAR, IAM / PAM, Network / Endpoint, Cloud Security, DLP,
-- DevSecOps / Secure Code Review, OT / ICS, Security Hardening, legacy FortiSIEM) where the account
-- has an active resource allocation (rticore_resource_people.email). itdev_leader additionally
-- completes implementation tasks with Vault evidence, reviews its team's timesheets on those
-- projects and reads Technology Feasibility plans (read-only).
-- Platform duty: read-only diagnostics (/api/platform/diagnostics); no schema change needed.
-- Neither role is PM-eligible and neither has ERP capability, so the ERP role matrix (0049) and
-- PM triggers (0047) are unchanged.
-- Apply to a BACKED UP environment, after 0048 (offense), 0049 (defense) and 0050 (governance).
--
-- SQLite cannot alter a CHECK constraint. Same copy/drop/recreate pattern as 0047-0050: deferred
-- foreign keys let the refilled parent rows satisfy their children at COMMIT, and no
-- ALTER TABLE RENAME is used, so dependent triggers stay valid. The CHECK keeps every role
-- added by earlier migrations.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE rticore_members_backup_0051 AS SELECT email,role,active,created_at,created_by FROM rticore_members;
DROP TABLE rticore_members;
CREATE TABLE rticore_members (
 email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','governance_leader','governance_member','itdev_leader','itdev_member','viewer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 created_by TEXT
);
INSERT INTO rticore_members(email,role,active,created_at,created_by)
 SELECT email,role,active,created_at,created_by FROM rticore_members_backup_0051;
DROP TABLE rticore_members_backup_0051;
