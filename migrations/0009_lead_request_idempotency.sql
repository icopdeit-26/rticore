-- RTICORE marketing safe retry semantics. Apply after 0005, only after backup.
-- Existing lead IDs remain unchanged; old rows have NULL request_key.
ALTER TABLE rticore_marketing_leads ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_marketing_lead_request
ON rticore_marketing_leads(tenant_id,created_by,request_key)
WHERE request_key IS NOT NULL;
INSERT OR IGNORE INTO rticore_schema_migrations(version) VALUES(9);
