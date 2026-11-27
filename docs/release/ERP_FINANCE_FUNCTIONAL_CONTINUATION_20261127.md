# V6 ERP / Finance functional continuation — 27 November 2026
Baseline main b44ace1711f96f757e7a851979e6543a6d501c50.
This change implements Finance register projections for 23 operational register menus and dedicated F01/F24 workspaces; it does not certify transactions or Hostinger. Existing API 503 release gate is intentionally unchanged.

## ERP target coverage (20 groups)
Existing paths are evidence of implementation surface, not acceptance. No menu counts are inflated by placeholders.

|Target|Existing surface / next development gap|
|---|---|
|01 Command Center|/sales/executive, /sales/activities; verify KPI and tasks|
|02 Marketing|/sales/campaigns, /sales/leads, /sales/lead-intelligence; lead conversion|
|03 CRM|/customers, /sales/pipeline, /sales/communications; customer ownership|
|04 Presales|/scoping, /sales/compliance, /sales/bid-readiness, /sales/feasibility; tender regression|
|05 Commercial|/boq, /pricing, /approvals; pricing/mandays and approval|
|06 Contracts|/sales/renewals, /sales/award, /post-po; obligation lifecycle|
|07 PSA|/sales/delivery, /psa/timesheets; cost, utilization and acceptance|
|08 Cyber Ops|/erp/cyber-operations, /erp/security-integrations; service-specific workflow verification|
|09 Service Desk|No dedicated page in baseline; ticket/SLA/escalation implementation required|
|10 Finance AR|/sales/billing, /sales/revenue, F04/F06/F09; posting bridge|
|11 Finance GL|/erp/general-ledger, /erp/treasury, F03/F05/F07/F16/F20; closed-period and scope|
|12 Procurement|/partners, /sales/procurement, /erp/procurement; P2P atomicity|
|13 HR|/erp/hr, /psa/timesheets; resource and payroll bridge|
|14 Asset/Inventory|F17/F18; lifecycle and physical inventory verification|
|15 FlexGuard|/flexguard, F19; wallet valuation and entitlement consumption|
|16 Planning|/sales/forecast, F12/F13; scenario and budget approval|
|17 Reporting|/reports, F21/F24; reconciliation and data traceability|
|18 Vault|/sales/documents; retention, role and evidence|
|19 GRC|/sales/compliance, F23, /erp/security-integrations; independent control testing|
|20 Administration|/erp/organization, /settings/system, /platform/diagnostics, F25; native MFA and CAMS docking|

## Gates
- Actual typecheck/build, Finance register tests, route tests, PostgreSQL transaction tests, and role/entity browser journeys.
- All 420 ERP / 520 Finance scenario outcomes require evidence, not catalog counts.
- Existing PRs #1/#4/#5/#6/#8 need integration and review. Migration 0053/0054 rehearsal, historical reconciliation and recovery evidence remain outstanding. No public production gate bypass.
