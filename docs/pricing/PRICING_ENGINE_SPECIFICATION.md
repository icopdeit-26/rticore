# 6. Enterprise Service Pricing Engine Specification

Implemented in `src/lib/enterprise-pricing-engine.ts`, `migrations/0053_enterprise_service_catalog_pricing.sql`, `/api/erp/pricing-engine`, and `/erp/pricing-simulator`.

## Formulas (Zero Floating-Point Monetary Precision)
- **Resource Loaded Cost (`calculateLoadedResourceRate`, 19 roles):**
  - `Annual Loaded Resource Cost = (Monthly Comp + Benefits + Employer Contrib + Allocated Expenses) × 12`
  - `Productive Billable Mandays = Available Working Days × Target Utilization`
  - `Internal Cost per Manday = round(Annual Loaded Cost / Productive Billable Mandays)` (BigInt integer rounding).
- **Service Costing & Pricing (`calculateEnterpriseServicePricing`, 14 methods):**
  - `Total Direct Cost = Direct Labor + Tools + License + Travel + Third Party + Other Direct`
  - `Fully Loaded Cost = Total Direct Cost + Allocated Overhead + Risk Contingency` (= Break-Even Price)
  - `Target Selling Price = Fully Loaded Cost / (1 − Target Margin)` (or `× (1 + Markup)` for `cost_plus`)
  - **Margin Separation:** Independently reports `directGrossMarginBps` (based on `Total Direct Cost`) and `fullyLoadedMarginBps` (based on `Fully Loaded Cost`).
- **Governance & Immutability Controls:**
  - Sales/Presales are blocked (`HTTP 403`) from overriding approved DB internal cost rates and internal cost fields are masked on `GET`.
  - Negative margin scenarios (`netSellingPrice < breakEvenPrice`) are blocked (`HTTP 422`).
  - Approval escalates deterministically (`none` → `sales_manager` → `pricing_manager` → `finance_manager` → `director` → `ceo`) based on contract value, discount %, margin floor, strategic customer, payment terms >60d, credit risk, and exceptional terms.
  - On independent approval (SoD enforced), an immutable SHA-256 `rticore_pricing_snapshots` record freezes rate cards, activity breakdown, and financials (`NO UPDATE` / `NO DELETE` triggers) so future rate card revisions never alter historical quotations.
