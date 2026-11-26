# 2. Functional Requirement Specification (M01–M30)

Maps all 30 enterprise domains of RTICore V4.0 to implemented modules, APIs, schemas, and verification tests:

| Domain | Scope | Primary Code / Schema | Status |
|---|---|---|---|
| **M01** Executive Command Center | Revenue, Pipeline, Backlog, Profit, EBITDA view, FlexGuard, Resource, Budget & Risk | `/api/erp/executive-command`, `/erp/executive-command`, `/sales/executive` | Implemented & Tested |
| **M02** Organization & Legal Entity | Legal entity, division, department, team, cost/profit center, approval hierarchy | `0034`, `0052`, `/api/erp/organization`, `/erp/organization` | Implemented & Tested |
| **M03** CRM | Customer 360, contacts, segmentation, Indonesian postal reference `0029`, health signals | `/api/sales/customer360`, `/customers` | Implemented & Tested |
| **M04** Sales Pipeline & Opportunity | Leads, BANT, stages, weighted forecast, win/loss, SLA activities | `0003`–`0024`, `/api/sales/*`, `/sales/pipeline` | Implemented & Tested |
| **M05** Service Catalog & Product | 29 cybersecurity/GRC/tech categories, versioning, 12-phase templates, complexity matrix | `0053`, `/api/erp/service-catalog`, `/erp/service-catalog` | Implemented & Tested |
| **M06** Service Pricing & Mandays | 19-role rate card, loaded cost formula, 14 pricing methods, simulator, immutable snapshots, historical learning | `0053`, `src/lib/enterprise-pricing-engine.ts`, `/api/erp/pricing-engine`, `/erp/pricing-simulator` | Implemented & Tested |
| **M07** Proposal, Quotation & Tender | BoQ, DOCX quotation generator, RKS/KAK compliance, bid readiness, electronic approval | `/api/boq/*`, `/api/sales/quotation`, `/api/sales/compliance`, `/api/sales/bid-readiness` | Implemented & Tested |
| **M08** Contract & Subscription | Customer contracts, MSA/SOW/PO dual verification, milestones, renewals | `0008`, `0012`, `0027`, `/api/sales/award`, `/sales/renewals` | Implemented & Tested |
| **M09** FlexGuard Service Credits | Package builder, versioned conversion matrix, 12-type immutable ledger, 14-step workflow, SLA, Customer Portal, PSAK 115 bridge | `0030`, `0052`, `0054`, `/api/erp/flexguard-enterprise`, `/api/portal/flexguard` | Implemented & Tested |
| **M10** Project & PSA | Auto-handover, charter/baseline, WBS/tasks, milestones/BAST, profitability | `0025`, `0027`, `/api/sales/service-operations`, `/sales/delivery` | Implemented & Tested |
| **M11–M13** VAPT, SOC/MDR, DFIR | Offensive findings, SOC incidents, DFIR cases, SIEM/EDR connectors, team allowlists | `0037`, `0038`, `0044`, `0048`, `0049`, `/api/erp/cyber-operations` | Implemented & Tested |
| **M14** Cyber Threat Intelligence | CTI cases, TLP classification, 9 IOC indicator types, dissemination | `0055`, `/api/erp/cyber-grc-cti`, `/erp/cyber-grc-cti` | Implemented & Tested |
| **M15** GRC & Consulting Services | 10 frameworks (ISO 27001, UU PDP, OJK, BI, NIST, PCI-DSS, COBIT), gap & audit readiness | `0055`, `/api/erp/cyber-grc-cti`, `/erp/cyber-grc-cti` | Implemented & Tested |
| **M16–M17** Resource & Timesheets | Capacity/feasibility allocations, daily capacity timesheets, prorated labor cost | `0025`, `0033`, `/api/sales/feasibility`, `/api/psa/timesheets` | Implemented & Tested |
| **M18–M20** Procurement, Assets & HCM | Vendors, PR/PO, GRN, 3-way match, fixed assets, license inventory, HR employees/leave/skills | `0036`, `0042`, `0043`, `0052`, `/api/erp/procurement`, `/api/erp/hr` | Implemented & Tested |
| **M21–M26** RTI Finance Suite | GL, AR, AP, Treasury, Bank Recon, Budget/FP&A, Tax, Payroll, PSAK 115 Revenue, Close, Consolidation, ICOFR | `0035`, `0041`, `0052`, `/api/finance`, `/finance/[menuId]` | Implemented & Tested (Hostinger fail-closed pending certification) |
| **M27** Enterprise Risk & Compliance | Risk register, RCSA scores, KRIs, control register with SoD testing | `0055`, `/api/erp/cyber-grc-cti`, `/api/finance` (`F23`) | Implemented & Tested |
| **M28** Document Vault & Knowledge | AES-GCM encrypted chunks, SHA-256 original verification, access audit | `0015`, `0022`, `/api/sales/vault`, `/api/sales/document-vault` | Implemented & Tested |
| **M29** BI & Controlled AI | Read-only executive & financial analytics; AI prohibited from auto-posting/pricing/access mutation | `/api/erp/executive-command`, `/api/ai/*`, `/api/finance` (`F24`) | Implemented & Tested |
| **M30** System Admin & Operations | RBAC, feature flags (SoD), durable background jobs, DR drills, unified audit explorer | `0053`, `0055`, `/api/admin/feature-flags`, `/api/erp/operations-jobs`, `/erp/operations-center` | Implemented & Tested |
