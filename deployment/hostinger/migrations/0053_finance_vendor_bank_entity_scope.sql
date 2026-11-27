-- P0: explicit, PO-backed legal entity ownership for newly registered vendor bank accounts.
-- Existing accounts remain unassigned and inaccessible until independently reconciled.
CREATE TABLE IF NOT EXISTS rticore_finance_vendor_bank_scopes (
 tenant_id TEXT NOT NULL,
 bank_account_id TEXT NOT NULL,
 legal_entity_id TEXT NOT NULL,
 purchase_order_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,bank_account_id),
 FOREIGN KEY(tenant_id,bank_account_id) REFERENCES rticore_finance_vendor_bank_accounts(tenant_id,id),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES rticore_erp_org_units(tenant_id,id),
 FOREIGN KEY(tenant_id,purchase_order_id) REFERENCES rticore_purchase_orders(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS rticore_fin_vendor_scope_entity_idx ON rticore_finance_vendor_bank_scopes(tenant_id,legal_entity_id);
