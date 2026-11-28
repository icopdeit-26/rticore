-- Disposable CI only: upstream commercial snapshots seeded before canonical triggers.
-- This is not a Sales lifecycle UAT; binding/wallet/PSA/ledger commands are exercised AFTER all triggers are installed.
INSERT INTO rticore_sales_accounts(id,tenant_id,legal_name,customer_number,created_by) VALUES('fg-ci-customer','defendit360','FG CI customer','FG-CI-001','ci');
INSERT INTO rticore_sales_opportunities(id,tenant_id,company_id,title,stage,estimated_value_idr,created_by) VALUES('fg-ci-opportunity','defendit360','fg-ci-customer','FG CI opportunity','closed_won',2000,'ci');
INSERT INTO rticore_boq(id,tenant_id,project_name,customer_name,quotation_number,service_type,opportunity_id,status,created_by,updated_by,approved_by) VALUES('fg-ci-boq','defendit360','FG CI project','FG CI customer','FG-CI-Q1','FlexGuard','fg-ci-opportunity','approved','ci-maker','ci-maker','ci-checker');
INSERT INTO rticore_sales_releases(id,tenant_id,opportunity_id,version,status,scope_snapshot,account_snapshot,scope_notes,scoped_by,proposal_snapshot,proposal_reference,proposal_sha256,proposed_by,boq_id,boq_version,boq_edit_seq,approved_by)
VALUES('fg-ci-release','defendit360','fg-ci-opportunity',1,'approved','{}','{}','Synthetic scope snapshot','ci-maker','{}','fg-ci-proposal',repeat('a',64),'ci-maker','fg-ci-boq',1,0,'ci-checker');
INSERT INTO rticore_delivery_projects(id,tenant_id,opportunity_id,customer_id,release_id,po_number,title,service_family,baseline_json,budget_json,contract_cents,status,start_date,end_date,created_by)
VALUES('fg-ci-project','defendit360','fg-ci-opportunity','fg-ci-customer','fg-ci-release','FG-CI-PO','FG CI project','FlexGuard','{}','[]',200000,'active',(CURRENT_DATE-1)::text,(CURRENT_DATE+30)::text,'ci');
INSERT INTO rticore_service_contracts(id,tenant_id,project_id,customer_id,model,start_date,end_date,status,configured_by,approved_by)
VALUES('fg-ci-contract','defendit360','fg-ci-project','fg-ci-customer','FlexGuard',(CURRENT_DATE-1)::text,(CURRENT_DATE+30)::text,'active','ci-maker','ci-checker');
INSERT INTO rticore_document_library(id,tenant_id,opportunity_id,kind,version,file_name,media_type,byte_length,sha256,iv,chunk_count,created_by)
VALUES('fg-ci-doc','defendit360','fg-ci-opportunity','supporting',1,'synthetic.pdf','application/pdf',1,repeat('b',64),repeat('a',16),1,'ci');
INSERT INTO rticore_delivery_milestones(id,tenant_id,project_id,title,amount_cents,status,document_id,accepted_by,created_by)
VALUES('fg-ci-milestone','defendit360','fg-ci-project','Synthetic accepted milestone',200000,'accepted','fg-ci-doc','ci-checker','ci-maker');
INSERT INTO rticore_billing_invoices(id,tenant_id,project_id,milestone_id,number,issue_date,due_date,amount_cents,vat_cents,document_id,status,created_by,reviewed_by)
VALUES('fg-ci-invoice','defendit360','fg-ci-project','fg-ci-milestone','FG-CI-INV',CURRENT_DATE::text,(CURRENT_DATE+15)::text,200000,0,'fg-ci-doc','approved','ci-maker','ci-checker');
INSERT INTO rticore_billing_payments(id,tenant_id,invoice_id,reference,payment_date,amount_cents,document_id,status,created_by,reviewed_by)
VALUES('fg-ci-payment','defendit360','fg-ci-invoice','FG-CI-PAY',CURRENT_DATE::text,200000,'fg-ci-doc','approved','ci-maker','ci-checker');

-- Synthetic DFIR scope for native custody SQL tests; before canonical triggers.
INSERT INTO rticore_sales_accounts(id,tenant_id,legal_name,customer_number,created_by) VALUES('dfir-ci-customer','defendit360','DFIR CI customer','DFIR-CI-001','ci');
INSERT INTO rticore_sales_opportunities(id,tenant_id,company_id,title,stage,estimated_value_idr,created_by) VALUES('dfir-ci-opportunity','defendit360','dfir-ci-customer','DFIR CI opportunity','closed_won',2000,'ci');
INSERT INTO rticore_boq(id,tenant_id,project_name,customer_name,quotation_number,service_type,opportunity_id,status,created_by,updated_by,approved_by) VALUES('dfir-ci-boq','defendit360','DFIR CI project','DFIR CI customer','DFIR-CI-Q1','DFIR','dfir-ci-opportunity','approved','ci-maker','ci-maker','ci-checker');
INSERT INTO rticore_sales_releases(id,tenant_id,opportunity_id,version,status,scope_snapshot,account_snapshot,scope_notes,scoped_by,proposal_snapshot,proposal_reference,proposal_sha256,proposed_by,boq_id,boq_version,boq_edit_seq,approved_by) VALUES('dfir-ci-release','defendit360','dfir-ci-opportunity',1,'approved','{}','{}','Synthetic scope snapshot','ci-maker','{}','dfir-ci-proposal',repeat('a',64),'ci-maker','dfir-ci-boq',1,0,'ci-checker');
INSERT INTO rticore_delivery_projects(id,tenant_id,opportunity_id,customer_id,release_id,po_number,title,service_family,baseline_json,budget_json,contract_cents,status,start_date,end_date,created_by) VALUES('dfir-ci-project','defendit360','dfir-ci-opportunity','dfir-ci-customer','dfir-ci-release','DFIR-CI-PO','DFIR CI project','DFIR','{}','[]',200000,'active',(CURRENT_DATE-1)::text,(CURRENT_DATE+30)::text,'ci');
INSERT INTO rticore_document_library(id,tenant_id,opportunity_id,kind,version,file_name,media_type,byte_length,sha256,iv,chunk_count,created_by) VALUES('dfir-ci-doc','defendit360','dfir-ci-opportunity','supporting',1,'synthetic.pdf','application/pdf',1,repeat('c',64),repeat('a',16),1,'ci');
