# 11. Role-Based Access Control (RBAC) Matrix

RTICore enforces server-side identity and authorization across **17 core application roles** (`rticore_members`), **ERP capability grants** (`rticore_erp_capability_grants`), **18 RTI Finance roles** (`rticore_finance_role_assignments`), and **2 Customer Portal roles** (`rticore_flexguard_portal_grants`: `customer_admin`, `customer_user`).

Client-controlled role headers (including `x-finance-role`) are strictly rejected (`HTTP 403`).

| Role Category | Roles | Permitted Domains | Explicit Restrictions |
|---|---|---|---|
| **Executive & Approver** | `approver`, `ceo`, `cfo`, `director` | Executive Command (`M01`), Approvals, Rate Card/Pricing/Package/Flag/DR Approvals, Finance (`F01`–`F25`) | Cannot self-approve any transaction they created |
| **System Administration** | `admin`, `super_admin` | User/Org/Feature Flags/Operations Center/System Settings | `super_admin` cannot approve journals or payments (`F03`/`F07` Rule 22); cannot self-approve flags or drills |
| **Commercial & Sales** | `sales`, `marketing` | CRM (`M03`), Pipeline (`M04`), Pricing Simulator (selling view), FlexGuard Reservations | **Blocked** from internal cost rates, rate card creation, GL, Executive Command, Operations Center |
| **Presales & Pricing** | `presales` | Service Catalog (`M05`), Smart Scoping, Pricing Scenarios, Feasibility, FlexGuard Requests | **Blocked** from overriding approved Finance internal cost rates or verifying POs |
| **Delivery & Cyber Ops** | `project_manager`, `offense_lead/member`, `defense_leader/member`, `governance_leader/member`, `itdev_leader/member` | Scoped Projects (`M10`), Timesheets (`M17`), VAPT/SOC/DFIR/CTI/GRC (`M11`–`M15`), Platform Diagnostics (`itdev_*`) | Team-level API allow-lists (`boq-auth.ts`); scoped strictly to authorized legal entities/projects |
| **Finance & Accounting** | `finance` + 18 RTI Finance roles (`cfo`, `financial_controller`, `finance_manager`, `accounting_officer`, `ar_officer`, `ap_officer`, `treasury_officer`, `tax_officer`, `budget_officer`, etc.) | RTI Finance (`F01`–`F25`), Rate Cards, FlexGuard Allocation/Consumption/Reconciliation, Executive Command | Menu-level & approval-limit enforcement; entity isolation; Hostinger fail-closed pending certification |
| **Customer Portal** | `customer_admin`, `customer_user` | `/api/portal/flexguard`, `/portal/flexguard` ONLY | Strictly scoped to single `customer_id`; zero visibility of internal costs, compensation, margins, or other customers |
