# P0 F14 expense authorization — interim fail-closed policy

The Finance 520 Domain 09 negative test expects a Sales user with an approved direct entity affiliation but no maker authority to receive HTTP 403 and create no claim. The prior selfExpense exception returned 201. Apply the existing F14 menu + entity + maker gate, preserving authenticated employee identity and independent approval. No assertion was weakened. This is an interim conservative interpretation of the acceptance baseline; employee self-service submission requires a separately approved scoped claimant policy and evidence/ownership controls before enabling it. Do not treat entity affiliation alone as financial mutation authority. Existing Hostinger production certification lock remains unchanged.

CAMS SQL acceptance restores paired PostgreSQL dollar quote delimiters. Cross-entity rejection and rollback assertions are unchanged. Exact-SHA CI and staging certification are outstanding.
