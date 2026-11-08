-- Conversion integrity: block two leads from creating duplicate Sales customer master.
-- Review existing normalized-name duplicates before applying on production.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_sales_account_legal_name
 ON rticore_sales_accounts(tenant_id,lower(trim(legal_name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_lead_converted_accounts
 ON rticore_marketing_leads(tenant_id,converted_account_id)
 WHERE converted_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_lead_converted_deals
 ON rticore_marketing_leads(tenant_id,converted_opportunity_id)
 WHERE converted_opportunity_id IS NOT NULL;
-- Note: conversion requires existing 0003, 0004, and 0005 schema.
INSERT OR IGNORE INTO rticore_schema_migrations(version) VALUES(6);
