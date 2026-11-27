# FlexGuard enterprise PostgreSQL rehearsal — 27 November 2026
Candidate base 066cd863cdaade3e7bef7d106aadbf83e41fd28d. PostgreSQL 16.16 synthetic-only Neon project empty-bar-45943236, database rticore_rehearsal. Migrations 0057 and 0058 applied and reapplied successfully; 0059 applied/reapplied, approval alias collision discovered and corrected in 066cd863cdaade3e7bef7d106aadbf83e41fd28d; corrected function applied and onboarding rerun. Existing 267 triggers remain installed. During synthetic upstream PO fixture insertion only rticore_flow_po_insert was temporarily disabled/re-enabled in the same fixture transaction; no actual sales approval workflow was exercised or production trigger disabled. Other actual schema constraints and triggers remained enabled. Direct approved-source fixtures are synthetic and not actual customer evidence. Expiry positive test used an intentionally historical expired-lot fixture with no purchase outbox; this is flagged by reverse reconciliation, not a certified opening balance.
 
## Actual SQL scenarios
| Scenario | Status | Evidence |
|---|---|---|
| ack_idempotent | PASS | processed acknowledgement replay |
| adjustment_overrestore | PASS | FLEXGUARD_ADJUSTMENT_EXCEEDED |
| adjustment_requires_specific_policy | PASS | FLEXGUARD_APPROVED_ACCOUNTING_POLICY_REQUIRED |
| atomic_docking_hash | PASS | purchase, topup, consumption, two adjustments; no auto journal |
| consumption_balanced_draft | PASS | two exact GL lines; no auto-post |
| consumption_posted_ack | PASS | independently posted journal matched |
| consumption_requires_purchase_ack | PASS | FLEXGUARD_PURCHASE_RECONCILIATION_REQUIRED |
| consumption_snapshot | PASS | 20 credits at original lot rate |
| cross_entity_request | PASS | FLEXGUARD_ACCESS_DENIED |
| draft_idempotent_replay | PASS | same journal ID |
| duplicate_invoice | PASS | unique invoice |
| duplicate_review | PASS | FLEXGUARD_REQUEST_ALREADY_REVIEWED |
| early_expiry_rejected | PASS | FLEXGUARD_NOT_EXPIRED |
| expiry_after_lot_expiration | PASS | 5 expired credits valued at acquisition rate |
| expiry_no_auto_revenue | PASS | pending independent accounting policy |
| expiry_overdraw_rejected | PASS | FLEXGUARD_INSUFFICIENT_BALANCE |
| idempotency_payload_conflict | PASS | FLEXGUARD_IDEMPOTENCY_CONFLICT |
| idempotent_request_replay | PASS | same request ID |
| insufficient_available | PASS | FLEXGUARD_INSUFFICIENT_BALANCE |
| ledger_immutability | PASS | FLEXGUARD_ENTERPRISE_IMMUTABLE |
| legacy_dual_ledger_block | PASS | FLEXGUARD_ENTERPRISE_WALLET |
| lot_balance_reconciled | PASS | 50 purchased - 20 consumed - 5 adjusted + 2 restored |
| maker_cannot_review | PASS | FLEXGUARD_APPROVAL_DENIED |
| negative_adjustment | PASS | 5 credits removed, finance policy review |
| no_ack_before_post | PASS | FLEXGUARD_POSTED_JOURNAL_REQUIRED |
| no_duplicate_purchase_journal | PASS | FLEXGUARD_EXISTING_INVOICE_JOURNAL_REQUIRED |
| paid_purchase_and_value | PASS | net invoice excludes VAT |
| positive_adjustment_restore | PASS | 2 previously removed credits restored |
| purchase_finance_ack | PASS | independent acknowledgement |
| purchase_link_existing_journal | PASS | existing posted AR journal matched gross/net |
| purchase_request | PASS | pending approval |
| reservation_overuse | PASS | FLEXGUARD_RESERVATION_EXCEEDED |
| reservation_post | PASS | 30 reserved |
| reservation_release | PASS | 10 released |
| topup_distinct_rate | PASS | different lot rate |
| wallet_create_replay | PASS | same wallet |
| wallet_cross_scope_denied | PASS | FLEXGUARD_ACCESS_DENIED |
| wallet_independent_approval | PASS | entitlement independently approved |
| wallet_maker_approval_denied | PASS | FLEXGUARD_APPROVAL_DENIED |
| wallet_maker_create | PASS | scoped approved contract |
 
## Finance event state
- flexguard.credit_adjusted, received: 2
- flexguard.credit_consumed, processed: 1
- flexguard.credit_expired, received: 1
- flexguard.credit_purchased, processed: 1
- flexguard.credit_purchased, received: 1
 
Source scan on six emitted events: zero missing source, wrong entity, source mismatch. Reverse ledger scan: {"lots":"3","invalid_balance":"0","invoice_payment_review":"0","missing_outbox":"1","pending_finance_ack":"4","invalid_posted_link":"0","remaining_service_value_cents":"4700000"}. Remaining service value is not certified GL balance. Missing outbox on historical synthetic fixture is a known negative case; four emitted events still require Finance review/acknowledgement. Draft and posted-acknowledgement demonstrated for one consumption; purchase linked to already-posted AR invoice without duplicate journal. Journal review/post in rehearsal was performed via SQL transitions with existing triggers, not through Hostinger UI. Expiry and adjustment accounting require independent policy approval; no automatic revenue.
 
Production NO-GO: no real business data or Hostinger DB access, no full CI build or HTTP/browser UAT, no real GL source evidence, no automatic expiry job, no completed product/package pricing reconciliation or migrated legacy wallets. Runtime gate remains disabled. The 40 SQL tests are actual retained results in synthetic DB; CI test adds schema migration inventory and negative auth smoke, not all 40 workflow assertions. Full UAT and independent review required.
