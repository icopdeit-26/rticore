-- RTICORE 0049: SOC Defense Team login roles (defense_leader, defense_member).
-- Scope is the ERP cyber_ops capability: an independently approved staff placement and
-- cyber_ops grant on the legal unit of an approved SOC/DFIR project scope. The role alone
-- opens nothing. Leader triages and assigns SOC/DFIR cases to analysts, returns or QA-reviews
-- submitted investigations and closes reviewed cases. Member opens cases, investigates the
-- cases assigned to it and submits notes with original Vault evidence. A reviewer is never
-- the case maker or the investigating assignee. Apply to a BACKED UP environment.
--
-- SQLite cannot alter a CHECK constraint. Tables are copied, dropped, recreated under the
-- same name and refilled (as in 0047/0048): deferred foreign keys are re-satisfied at COMMIT, no
-- ALTER TABLE RENAME, so triggers on other tables that name these tables stay valid.
-- DROP TABLE does not fire DELETE triggers; triggers ON the rebuilt tables are recreated.
PRAGMA defer_foreign_keys=ON;

-- 1. Login roles.
CREATE TABLE rticore_members_backup_0049 AS SELECT email,role,active,created_at,created_by FROM rticore_members;
DROP TABLE rticore_members;
CREATE TABLE rticore_members (
 email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','finance','presales','sales','approver','legal','project_manager','offense_lead','offense_member','defense_leader','defense_member','viewer')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 created_by TEXT
);
INSERT INTO rticore_members(email,role,active,created_at,created_by)
 SELECT email,role,active,created_at,created_by FROM rticore_members_backup_0049;
DROP TABLE rticore_members_backup_0049;

-- 2. ERP role-capability matrix accepts the Defense roles; both may hold cyber_ops only.
CREATE TABLE rticore_erp_role_matrix_backup_0049 AS SELECT role,capability,allowed,updated_at FROM rticore_erp_role_capability_matrix;
DROP TABLE rticore_erp_role_capability_matrix;
CREATE TABLE rticore_erp_role_capability_matrix (
 role TEXT NOT NULL, capability TEXT NOT NULL,
 allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(role,capability),
 CHECK(role IN ('admin','marketing','sales','presales','finance','approver','legal','defense_leader','defense_member','viewer')),
 CHECK(capability IN ('finance_gl','finance_ap','procurement','cyber_ops','resource','hr','audit'))
);
INSERT INTO rticore_erp_role_capability_matrix(role,capability,allowed,updated_at)
 SELECT role,capability,allowed,updated_at FROM rticore_erp_role_matrix_backup_0049;
DROP TABLE rticore_erp_role_matrix_backup_0049;
INSERT OR IGNORE INTO rticore_erp_role_capability_matrix(role,capability,allowed) VALUES
 ('defense_leader','cyber_ops',1),('defense_member','cyber_ops',1);
CREATE TRIGGER rticore_erp_role_matrix_no_delete BEFORE DELETE ON rticore_erp_role_capability_matrix
BEGIN SELECT RAISE(ABORT,'ROLE_POLICY_VERSIONED_CHANGE_REQUIRED'); END;
CREATE TRIGGER rticore_erp_role_matrix_versioned BEFORE UPDATE ON rticore_erp_role_capability_matrix
WHEN NOT EXISTS(SELECT 1 FROM rticore_erp_role_policy_changes x
 WHERE x.role=OLD.role AND x.capability=OLD.capability AND x.to_allowed=NEW.allowed AND x.from_allowed=OLD.allowed
 AND x.status='approved')
BEGIN SELECT RAISE(ABORT,'ROLE_POLICY_CHANGE_REQUIRED'); END;

-- 3. Versioned matrix change requests may target the Defense roles.
CREATE TABLE rticore_erp_policy_changes_backup_0049 AS SELECT * FROM rticore_erp_role_policy_changes;
DROP TABLE rticore_erp_role_policy_changes;
CREATE TABLE rticore_erp_role_policy_changes(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','marketing','sales','presales','finance','approver','legal','defense_leader','defense_member','viewer')),
 capability TEXT NOT NULL CHECK(capability IN ('finance_gl','finance_ap','procurement','cyber_ops','resource','hr','audit')),
 from_allowed INTEGER NOT NULL CHECK(from_allowed IN (0,1)),
 to_allowed INTEGER NOT NULL CHECK(to_allowed IN (0,1)),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 12 AND 800),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 version INTEGER NOT NULL DEFAULT 1,requested_by TEXT NOT NULL COLLATE NOCASE,
 reviewed_by TEXT COLLATE NOCASE,review_notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,id),CHECK(from_allowed!=to_allowed),
 CHECK(reviewed_by IS NULL OR lower(reviewed_by)!=lower(requested_by)),
 CHECK(status='pending' OR (reviewed_by IS NOT NULL AND coalesce(length(review_notes),0)>=12))
);
INSERT INTO rticore_erp_role_policy_changes(id,tenant_id,role,capability,from_allowed,to_allowed,reason,status,version,requested_by,reviewed_by,review_notes,created_at)
 SELECT id,tenant_id,role,capability,from_allowed,to_allowed,reason,status,version,requested_by,reviewed_by,review_notes,created_at FROM rticore_erp_policy_changes_backup_0049;
DROP TABLE rticore_erp_policy_changes_backup_0049;
CREATE TRIGGER rticore_erp_policy_change_review BEFORE UPDATE ON rticore_erp_role_policy_changes
WHEN OLD.status!='pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.version!=OLD.version+1
 OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.role IS NOT OLD.role
 OR NEW.capability IS NOT OLD.capability OR NEW.from_allowed IS NOT OLD.from_allowed
 OR NEW.to_allowed IS NOT OLD.to_allowed OR NEW.reason IS NOT OLD.reason
 OR NEW.requested_by IS NOT OLD.requested_by OR lower(NEW.reviewed_by)=lower(OLD.requested_by)
BEGIN SELECT RAISE(ABORT,'ROLE_POLICY_CHANGE_IMMUTABLE'); END;
CREATE TRIGGER rticore_erp_policy_change_no_delete BEFORE DELETE ON rticore_erp_role_policy_changes
BEGIN SELECT RAISE(ABORT,'ROLE_POLICY_CHANGE_IMMUTABLE'); END;
CREATE TRIGGER rticore_erp_policy_change_apply AFTER UPDATE OF status ON rticore_erp_role_policy_changes
WHEN NEW.status='approved' AND OLD.status='pending'
BEGIN
 SELECT CASE WHEN coalesce((SELECT allowed FROM rticore_erp_role_capability_matrix
 WHERE role=NEW.role AND capability=NEW.capability),0)!=NEW.from_allowed
 THEN RAISE(ABORT,'ROLE_POLICY_STALE') END;
 INSERT INTO rticore_erp_role_capability_matrix(role,capability,allowed) VALUES(NEW.role,NEW.capability,NEW.to_allowed)
 ON CONFLICT(role,capability) DO UPDATE SET allowed=excluded.allowed,updated_at=CURRENT_TIMESTAMP;
END;

-- 4. SOC case assignment: Leader â†’ analyst investigation â†’ submission â†’ Leader QA.
-- One assignment row per case; the case row itself keeps its 0037 lifecycle.
CREATE TABLE rticore_cyber_case_assignments(
 tenant_id TEXT NOT NULL,case_id TEXT NOT NULL,
 assignee_email TEXT NOT NULL COLLATE NOCASE,
 assigned_by TEXT NOT NULL COLLATE NOCASE,
 status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','submitted','returned')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 investigation_notes TEXT CHECK(investigation_notes IS NULL OR length(investigation_notes) BETWEEN 12 AND 2000),
 evidence_document_id TEXT,
 leader_notes TEXT CHECK(leader_notes IS NULL OR length(leader_notes) BETWEEN 12 AND 800),
 assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 submitted_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,case_id),
 FOREIGN KEY(tenant_id,case_id) REFERENCES rticore_cyber_cases(tenant_id,id),
 CHECK(status!='submitted' OR (investigation_notes IS NOT NULL AND evidence_document_id IS NOT NULL AND submitted_at IS NOT NULL)),
 CHECK(status!='returned' OR leader_notes IS NOT NULL)
);
CREATE INDEX rticore_cyber_assignment_queue ON rticore_cyber_case_assignments(tenant_id,assignee_email,status);
CREATE TRIGGER rticore_cyber_assignment_open BEFORE INSERT ON rticore_cyber_case_assignments
BEGIN
 SELECT CASE WHEN NEW.status!='assigned' OR NEW.version!=1 OR NOT EXISTS(SELECT 1 FROM rticore_cyber_cases c
  WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.case_id AND c.status='open' AND c.kind IN ('soc_incident','dfir_incident'))
 THEN RAISE(ABORT,'CYBER_ASSIGNMENT_CASE_NOT_OPEN') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rticore_members m WHERE m.email=NEW.assignee_email AND m.active=1 AND m.role IN ('defense_leader','defense_member'))
 THEN RAISE(ABORT,'CYBER_ASSIGNEE_NOT_DEFENSE_MEMBER') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rticore_members m WHERE m.email=NEW.assigned_by AND m.active=1 AND m.role IN ('defense_leader','admin'))
 THEN RAISE(ABORT,'CYBER_ASSIGNER_NOT_LEADER') END;
END;
CREATE TRIGGER rticore_cyber_assignment_flow BEFORE UPDATE ON rticore_cyber_case_assignments
BEGIN
 SELECT CASE WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.case_id IS NOT OLD.case_id
  OR NEW.assigned_at IS NOT OLD.assigned_at OR NEW.version!=OLD.version+1 OR NOT (
  (OLD.status IN ('assigned','returned') AND NEW.status='assigned') OR
  (OLD.status IN ('assigned','returned') AND NEW.status='submitted' AND NEW.assignee_email IS OLD.assignee_email) OR
  (OLD.status='submitted' AND NEW.status='returned' AND NEW.assignee_email IS OLD.assignee_email
   AND lower(NEW.assigned_by)!=lower(OLD.assignee_email))
 ) THEN RAISE(ABORT,'CYBER_ASSIGNMENT_IMMUTABLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rticore_cyber_cases c WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.case_id AND c.status='open')
 THEN RAISE(ABORT,'CYBER_ASSIGNMENT_CASE_NOT_OPEN') END;
 SELECT CASE WHEN NEW.status='assigned' AND NOT EXISTS(SELECT 1 FROM rticore_members m WHERE m.email=NEW.assignee_email AND m.active=1 AND m.role IN ('defense_leader','defense_member'))
 THEN RAISE(ABORT,'CYBER_ASSIGNEE_NOT_DEFENSE_MEMBER') END;
 SELECT CASE WHEN NEW.status IN ('assigned','returned') AND NOT EXISTS(SELECT 1 FROM rticore_members m WHERE m.email=NEW.assigned_by AND m.active=1 AND m.role IN ('defense_leader','admin'))
 THEN RAISE(ABORT,'CYBER_ASSIGNER_NOT_LEADER') END;
END;
CREATE TRIGGER rticore_cyber_assignment_no_delete BEFORE DELETE ON rticore_cyber_case_assignments
BEGIN SELECT RAISE(ABORT,'CYBER_ASSIGNMENT_IMMUTABLE'); END;
-- An assigned case is reviewed only after the analyst submitted, by someone other than the analyst.
CREATE TRIGGER rticore_cyber_case_assignment_gate BEFORE UPDATE ON rticore_cyber_cases
WHEN OLD.status='open' AND NEW.status IN ('reviewed','rejected') AND EXISTS(SELECT 1 FROM rticore_cyber_case_assignments x WHERE x.tenant_id=OLD.tenant_id AND x.case_id=OLD.id)
BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_cyber_case_assignments x WHERE x.tenant_id=OLD.tenant_id AND x.case_id=OLD.id AND x.status!='submitted')
 THEN RAISE(ABORT,'CYBER_ASSIGNMENT_NOT_SUBMITTED') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_cyber_case_assignments x WHERE x.tenant_id=OLD.tenant_id AND x.case_id=OLD.id AND lower(x.assignee_email)=lower(NEW.reviewer_email))
 THEN RAISE(ABORT,'CYBER_REVIEWER_IS_ASSIGNEE') END;
END;
-- Recorded so the release workflow applies this file exactly once.
INSERT INTO rticore_schema_migrations(version) VALUES(49);
