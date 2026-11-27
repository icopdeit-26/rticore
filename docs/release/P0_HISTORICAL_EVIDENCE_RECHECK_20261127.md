# Historical evidence recheck — 2026-11-27
Read-only rehearsal database rticore_rehearsal (synthetic); no ledger, GL or approval mutations. PR21 passed five checks and merged into V6 at 82cfad03107beb3f4964e32d3cf98eaef512f7ec.
- Top-up and expiry: five credits each, 100,000 minor units each. Both have matching invoice references, approved invoice, matching nominal, a posted request with matching transaction type and amount, and distinct ledger actors. Top-up has no outbox; expiry event is received. Neither lot has independently approved allocation.
- Three unverified lots: three independently approved invoices, all amounts match, all fully paid, zero existing allocation records. This is candidate evidence for a current independent allocation review, not a historical approval.
- One journal lifecycle exception: no evidence of three distinct maker/checker/poster actors. Do not backdate or fabricate a workflow row.
- Actual source documents, original business approvals and production DB identity not verified.
New read-only aggregate scanner emits candidate coverage and existing exception counts, no IDs or PII. Existing fail-closed reconciliation criteria unchanged. Corrective posting must use approved policy and real evidence; no automatic mutation.
