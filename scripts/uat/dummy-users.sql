-- TEST FIXTURE ONLY. DO NOT APPLY TO RTICORE PRODUCTION/SHARED DATABASE.
-- Target database: rticore-uat-users-db (eaed652e-7322-4950-a304-dd50baa5de02).
-- The .invalid reserved addresses cannot receive email and have NO Cloudflare Access identity.
-- Registration is RBAC fixture data, not an authentication bypass or login credential.
INSERT OR IGNORE INTO rticore_members(email,role,active,created_by) VALUES
('uat.admin@rticore.invalid','admin',1,'RTICORE_UAT_FIXTURE_20261020'),
('uat.sales.a@rticore.invalid','sales',1,'RTICORE_UAT_FIXTURE_20261020'),
('uat.sales.b@rticore.invalid','sales',1,'RTICORE_UAT_FIXTURE_20261020'),
('uat.presales@rticore.invalid','presales',1,'RTICORE_UAT_FIXTURE_20261020'),
('uat.finance@rticore.invalid','finance',1,'RTICORE_UAT_FIXTURE_20261020'),
('uat.approver@rticore.invalid','approver',1,'RTICORE_UAT_FIXTURE_20261020'),
('uat.viewer@rticore.invalid','viewer',1,'RTICORE_UAT_FIXTURE_20261020');
-- Active=0 mirrored rows in rticore-staging-db remain disabled and never authenticate.
-- Cleanup on UAT DB, after UAT:
-- DELETE FROM rticore_members WHERE created_by='RTICORE_UAT_FIXTURE_20261020';
