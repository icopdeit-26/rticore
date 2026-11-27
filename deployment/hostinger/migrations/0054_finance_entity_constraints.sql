-- PostgreSQL only. Apply in a maintenance window after backup and staging validation.
-- No silent cleanup. Any legacy cross-entity mismatch aborts the complete migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE UNIQUE INDEX IF NOT EXISTS p0_entity_parent_1_uq ON rticore_gl_periods(tenant_id,legal_entity_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS p0_entity_parent_2_uq ON rticore_gl_accounts(tenant_id,legal_entity_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS p0_entity_parent_3_uq ON rticore_gl_journals(tenant_id,legal_entity_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS p0_entity_parent_4_uq ON rticore_finance_performance_obligations(tenant_id,legal_entity_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS p0_entity_parent_5_uq ON rticore_finance_tax_rules(tenant_id,legal_entity_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS p0_entity_parent_6_uq ON rticore_treasury_accounts(tenant_id,legal_entity_id,id);
DO $p0$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_gl_journals'::regclass AND conname='p0_journal_period_entity_fk') THEN
  ALTER TABLE rticore_gl_journals ADD CONSTRAINT p0_journal_period_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,period_id) REFERENCES rticore_gl_periods(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_gl_journals VALIDATE CONSTRAINT p0_journal_period_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_period_controls'::regclass AND conname='p0_period_control_entity_fk') THEN
  ALTER TABLE rticore_finance_period_controls ADD CONSTRAINT p0_period_control_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,period_id) REFERENCES rticore_gl_periods(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_period_controls VALIDATE CONSTRAINT p0_period_control_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_coa_hierarchy'::regclass AND conname='p0_coa_account_entity_fk') THEN
  ALTER TABLE rticore_finance_coa_hierarchy ADD CONSTRAINT p0_coa_account_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_coa_hierarchy VALIDATE CONSTRAINT p0_coa_account_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_coa_hierarchy'::regclass AND conname='p0_coa_parent_entity_fk') THEN
  ALTER TABLE rticore_finance_coa_hierarchy ADD CONSTRAINT p0_coa_parent_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,parent_account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_coa_hierarchy VALIDATE CONSTRAINT p0_coa_parent_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_posting_rules'::regclass AND conname='p0_postrule_debit_entity_fk') THEN
  ALTER TABLE rticore_finance_posting_rules ADD CONSTRAINT p0_postrule_debit_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,debit_account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_posting_rules VALIDATE CONSTRAINT p0_postrule_debit_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_posting_rules'::regclass AND conname='p0_postrule_credit_entity_fk') THEN
  ALTER TABLE rticore_finance_posting_rules ADD CONSTRAINT p0_postrule_credit_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,credit_account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_posting_rules VALIDATE CONSTRAINT p0_postrule_credit_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_journal_workflows'::regclass AND conname='p0_workflow_journal_entity_fk') THEN
  ALTER TABLE rticore_finance_journal_workflows ADD CONSTRAINT p0_workflow_journal_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,journal_id) REFERENCES rticore_gl_journals(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_journal_workflows VALIDATE CONSTRAINT p0_workflow_journal_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_journal_dimensions'::regclass AND conname='p0_dimension_journal_entity_fk') THEN
  ALTER TABLE rticore_finance_journal_dimensions ADD CONSTRAINT p0_dimension_journal_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,journal_id) REFERENCES rticore_gl_journals(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_journal_dimensions VALIDATE CONSTRAINT p0_dimension_journal_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_revenue_schedules'::regclass AND conname='p0_schedule_obligation_entity_fk') THEN
  ALTER TABLE rticore_finance_revenue_schedules ADD CONSTRAINT p0_schedule_obligation_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,obligation_id) REFERENCES rticore_finance_performance_obligations(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_revenue_schedules VALIDATE CONSTRAINT p0_schedule_obligation_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_revenue_schedules'::regclass AND conname='p0_schedule_journal_entity_fk') THEN
  ALTER TABLE rticore_finance_revenue_schedules ADD CONSTRAINT p0_schedule_journal_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,journal_id) REFERENCES rticore_gl_journals(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_revenue_schedules VALIDATE CONSTRAINT p0_schedule_journal_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_budgets'::regclass AND conname='p0_budget_account_entity_fk') THEN
  ALTER TABLE rticore_finance_budgets ADD CONSTRAINT p0_budget_account_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_budgets VALIDATE CONSTRAINT p0_budget_account_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_tax_rules'::regclass AND conname='p0_tax_rule_account_entity_fk') THEN
  ALTER TABLE rticore_finance_tax_rules ADD CONSTRAINT p0_tax_rule_account_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,tax_account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_tax_rules VALIDATE CONSTRAINT p0_tax_rule_account_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_tax_transactions'::regclass AND conname='p0_tax_transaction_rule_entity_fk') THEN
  ALTER TABLE rticore_finance_tax_transactions ADD CONSTRAINT p0_tax_transaction_rule_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,tax_rule_id) REFERENCES rticore_finance_tax_rules(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_tax_transactions VALIDATE CONSTRAINT p0_tax_transaction_rule_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_tax_transactions'::regclass AND conname='p0_tax_transaction_journal_entity_fk') THEN
  ALTER TABLE rticore_finance_tax_transactions ADD CONSTRAINT p0_tax_transaction_journal_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,journal_id) REFERENCES rticore_gl_journals(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_tax_transactions VALIDATE CONSTRAINT p0_tax_transaction_journal_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_finance_bank_statements'::regclass AND conname='p0_statement_bank_entity_fk') THEN
  ALTER TABLE rticore_finance_bank_statements ADD CONSTRAINT p0_statement_bank_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,bank_account_id) REFERENCES rticore_treasury_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_finance_bank_statements VALIDATE CONSTRAINT p0_statement_bank_entity_fk;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='rticore_treasury_accounts'::regclass AND conname='p0_treasury_gl_entity_fk') THEN
  ALTER TABLE rticore_treasury_accounts ADD CONSTRAINT p0_treasury_gl_entity_fk FOREIGN KEY(tenant_id,legal_entity_id,gl_account_id) REFERENCES rticore_gl_accounts(tenant_id,legal_entity_id,id) NOT VALID;
 END IF;
 ALTER TABLE rticore_treasury_accounts VALIDATE CONSTRAINT p0_treasury_gl_entity_fk;
END
$p0$;
COMMIT;
