# 8. Accounting Event Mapping (PSAK 115 & RTI Finance Docking)

Implemented in `src/lib/rti-finance-core.ts`, `src/lib/flexguard-enterprise.ts`, `migrations/0052_rti_finance_enterprise_suite.sql`, and `/api/erp/flexguard-enterprise`.

## Separation of Operational vs Financial Events
RTICore explicitly separates cash receipt, invoice issuance, operational credit consumption, and PSAK 115 revenue recognition. Service credit balances live in the FlexGuard credit ledger and reconcile to the General Ledger via idempotent outbox events in `rticore_finance_integration_events`.

| Operational Event | Docking Event Type | Debit Account | Credit Account | Policy / Control Rule |
|---|---|---|---|---|
| Prepaid FlexGuard / Retainer Invoice | `flexguard.credit_purchased` | `1120` Accounts Receivable | `2140` Contract Liability | Revenue deferred until performance obligation is satisfied |
| Customer Cash Receipt | `customer.payment_received` | `1110` Cash / Bank | `1120` Accounts Receivable | Clears AR; does NOT recognize revenue |
| FlexGuard Service Delivery & Acceptance | `flexguard.credit_consumed` | `2140` Contract Liability | `4110` Service Revenue | Triggered only after QA + Customer Acceptance |
| Direct Labor / Delivery Cost | `timesheet.approved` / `resource.cost_allocated` | `5110` Cost of Services | `2120` Accrued Labor / Payroll | Matched to project / FlexGuard engagement |
| Unused Expired Credits (Breakage) | `flexguard.credit_expired` | `2140` Contract Liability | `4190` Breakage Revenue | **Blocked by default (`HTTP 409`)** until explicit Finance PSAK 115 breakage policy approval |
| Milestone BAST Acceptance | `project.milestone_accepted` | `1130` Contract Asset / `2140` Liability | `4110` Service Revenue | Allocated via PSAK 115 SSP schedule (`F09`) |
