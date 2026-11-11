-- RTICORE 0048: Offense Team login roles (offense_lead = Leader, offense_member = Member).
-- Both roles are scoped by the API to Offensive Security delivery projects (VAPT, Red Team /
-- Adversary Simulation, Attack Surface Management) where the account has an active resource
-- allocation (rticore_resource_people.email). offense_lead additionally reviews its team's
-- timesheets on those projects and reads Offensive Security Feasibility plans (read-only).
-- Neither role is PM-eligible and neither has ERP capability; PM triggers (0047) are unchanged.
-- Apply to a BACKED UP environment.
--
-- SQLite cannot alter a CHECK constraint. Same copy/drop/recreate pattern as 0047: deferred
-- foreign keys let the refilled parent rows satisfy their children at COMMIT, and no
-- ALTER TABLE RENAME is used, so dependent triggers stay valid.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE rticore_members_backup_0048 AS SELECT email,role,active,created_at,created_by FROM rticore_members;
DROP TABLE rticore_members;
CREATE TABLE rticore_members (
 email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','viewer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 created_by TEXT
);
INSERT INTO rticore_members(email,role,active,created_at,created_by)
 SELECT email,role,active,created_at,created_by FROM rticore_members_backup_0048;
DROP TABLE rticore_members_backup_0048;
-- Recorded so the release workflow applies this file exactly once.
INSERT INTO rticore_schema_migrations(version) VALUES(48);
