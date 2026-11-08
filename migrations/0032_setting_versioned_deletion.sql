-- Settings deletion is a versioned, maker/checker-approved tombstone.
-- Retain the immutable settings ledger and audit trail; only hide approved tombstones from effective reads.
CREATE TABLE rticore_migration_0032_dependency(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO rticore_migration_0032_dependency(ok)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM rticore_schema_migrations WHERE version=31) THEN 1 ELSE 0 END;
DROP TABLE rticore_migration_0032_dependency;

DROP VIEW rticore_effective_settings;
CREATE VIEW rticore_effective_settings AS
 SELECT s.* FROM rticore_setting_versions s
 WHERE s.status='approved'
 AND s.version=(
  SELECT max(x.version) FROM rticore_setting_versions x
  WHERE x.tenant_id=s.tenant_id AND x.kind=s.kind
    AND x.setting_key=s.setting_key AND x.status='approved'
 )
 AND coalesce(json_extract(s.data_json,'$.deleted'),0)=0;

INSERT INTO rticore_schema_file_manifest(path,source_branch)
 VALUES('migrations/0032_setting_versioned_deletion.sql','settings-update-delete');
INSERT INTO rticore_schema_migrations(version) VALUES(32);
