# 14. UAT Traceability Matrix (1,203+ Unique Executable Scenarios)

All scenarios below are **unique, automated, and executed** against the real SQLite/D1 schema (`migrations/0001`–`0055`) and actual route handlers (`npm run test:uat-1200`):

| Domain | Requirement Target | Executed Count | Test Suite File | Latest Status |
|---|---:|---:|---|---|
| **1. Existing Finance UAT** | 520 | **520** | `tests/rti-finance-uat-520.test.cjs` | PASS (Automated) |
| **2. Sales, CRM, Quotation & Contract** | 100 | **100** | `tests/rticore-enterprise-uat-v4.test.cjs` (`UAT-COMM-001..100`) | PASS (Automated) |
| **3. Service Pricing & Mandays** | 120 | **123** | `tests/enterprise-pricing-catalog.test.cjs` (`A01`–`E26`) | PASS (Automated) |
| **4. FlexGuard (incl. all 26 Critical Scenarios)** | 150 | **150+** | `tests/flexguard-enterprise-uat.test.cjs` (`FG01`–`FG150`) | PASS (Automated) |
| **5. Cybersecurity Ops (VAPT/SOC/DFIR/CTI/GRC) & PSA** | 100 | **100** | `tests/rticore-enterprise-uat-v4.test.cjs` (`UAT-CYB-001..100`) | PASS (Automated) |
| **6. Resource, Procurement & Asset** | 80 | **80** | `tests/rticore-enterprise-uat-v4.test.cjs` (`UAT-RES-001..080`) | PASS (Automated) |
| **7. Security, RBAC & Legal Entity Isolation** | 80 | **80** | `tests/rticore-enterprise-uat-v4.test.cjs` (`UAT-SEC-001..080`) | PASS (Automated) |
| **8. Production Operations & Recovery** | 50 | **50** | `tests/rticore-enterprise-uat-v4.test.cjs` (`UAT-OPS-001..050`) | PASS (Automated) |
| **TOTAL UNIQUE SCENARIOS** | **1,200** | **1,203+** | `npm run test:uat-1200` | **PASS (Automated)** |

> **Governance Note:** Automated UAT execution proves functional, transactional, and control invariants in isolated test environments. Human Business Owner, Finance Controller, and Independent Security staging UAT sign-offs remain mandatory under Gate B prior to production launch.
