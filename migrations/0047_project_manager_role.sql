-- RTICORE 0047: Project Manager login role.
-- A project_manager member is scoped by the API to delivery projects where it is the
-- assigned PM (rticore_delivery_projects.pm_email). It may be assigned as PM alongside
-- Presales/Admin. ERP role matrices are unchanged: project_manager has no ERP capability.
-- Apply to a BACKED UP environment.
--
-- SQLite cannot alter a CHECK constraint. The table is copied, dropped, recreated under the
-- same name and refilled: with deferred foreign keys, re-inserting each parent row clears the
-- violation the DROP recorded for its children (member orgs, ERP staff, HR, sales targets),
-- and the check runs at COMMIT. No ALTER TABLE RENAME, so dependent triggers stay valid.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE rticore_members_backup_0047 AS SELECT email,role,active,created_at,created_by FROM rticore_members;
DROP TABLE rticore_members;
CREATE TABLE rticore_members (
 email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','viewer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 created_by TEXT
);
INSERT INTO rticore_members(email,role,active,created_at,created_by)
 SELECT email,role,active,created_at,created_by FROM rticore_members_backup_0047;
DROP TABLE rticore_members_backup_0047;

-- A Project Manager member may be assigned as PM of a delivery project.
DROP TRIGGER IF EXISTS rticore_project_pm_active;
CREATE TRIGGER rticore_project_pm_active BEFORE UPDATE OF pm_email ON rticore_delivery_projects WHEN NEW.pm_email IS NOT NULL AND NOT EXISTS(SELECT 1 FROM rticore_members WHERE email=NEW.pm_email AND active=1 AND role IN ('presales','admin','project_manager'))
BEGIN SELECT RAISE(ABORT,'DELIVERY_CONFLICT: PM must be an active delivery member'); END;

-- Reuse an unambiguous PM already allocated in an approved Feasibility plan (0027 + PM role).
DROP TRIGGER IF EXISTS rticore_delivery_assign_planned_pm;
DROP VIEW IF EXISTS rticore_delivery_planned_pm;
CREATE VIEW rticore_delivery_planned_pm AS
 SELECT f.tenant_id,f.opportunity_id,min(e.email) pm_email,f.start_date,f.end_date
 FROM rticore_feasibility_plans f JOIN rticore_resource_allocations a ON a.tenant_id=f.tenant_id AND a.opportunity_id=f.opportunity_id AND a.status='active' AND lower(trim(a.work_role)) IN ('pm','project manager','project_manager')
 JOIN rticore_resource_people e ON e.tenant_id=a.tenant_id AND e.id=a.person_id AND e.active=1
 JOIN rticore_members m ON lower(m.email)=lower(e.email) AND m.active=1 AND m.role IN ('presales','admin','project_manager')
 WHERE f.status='approved' GROUP BY f.tenant_id,f.opportunity_id HAVING count(DISTINCT lower(e.email))=1;
CREATE TRIGGER rticore_delivery_assign_planned_pm AFTER INSERT ON rticore_delivery_projects
WHEN EXISTS(SELECT 1 FROM rticore_delivery_planned_pm x WHERE x.tenant_id=NEW.tenant_id AND x.opportunity_id=NEW.opportunity_id)
BEGIN
 UPDATE rticore_delivery_projects SET pm_email=(SELECT x.pm_email FROM rticore_delivery_planned_pm x WHERE x.tenant_id=NEW.tenant_id AND x.opportunity_id=NEW.opportunity_id),
 start_date=(SELECT x.start_date FROM rticore_delivery_planned_pm x WHERE x.tenant_id=NEW.tenant_id AND x.opportunity_id=NEW.opportunity_id),
 end_date=(SELECT x.end_date FROM rticore_delivery_planned_pm x WHERE x.tenant_id=NEW.tenant_id AND x.opportunity_id=NEW.opportunity_id),version=version+1 WHERE id=NEW.id AND tenant_id=NEW.tenant_id;
END;
