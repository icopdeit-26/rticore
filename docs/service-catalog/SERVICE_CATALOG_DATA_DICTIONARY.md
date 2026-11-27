# 4. Service Catalog Data Dictionary

Canonical schema: `migrations/0053_enterprise_service_catalog_pricing.sql` (`rticore_service_catalog_v2`, `rticore_service_activity_templates`, `rticore_complexity_matrices`).

## Key Entities & Fields
- **`rticore_service_catalog_v2`**:
  - `id`, `tenant_id`, `legal_entity_id`: multi-entity isolation keys.
  - `service_code`, `service_version`: unique per `(tenant_id, legal_entity_id, service_code, service_version)`.
  - `service_category`: constrained to all 29 canonical enterprise cybersecurity, SOC/MDR, DFIR, CTI, GRC, training, and technology categories.
  - `min_mandays_tenths`, `standard_mandays_tenths`, `max_mandays_tenths`: integer tenths (`80` = `8.0 MD`), constrained `min >= 5`, `std >= min`, `max >= std`.
  - `default_tool_cost_cents`, `default_third_party_cost_cents`, `default_travel_cost_cents`: integer minor units (IDR cents).
  - `overhead_allocation_bps`, `target_gross_margin_bps`, `min_acceptable_margin_bps`: integer basis points (`100 bps = 1%`).
  - `flexguard_eligible`: boolean integer (`0`/`1`), `standard_sla_hours`: integer hours.
  - `lifecycle_status`: `draft` → `approved` → `superseded` → `retired`; database CHECK enforces `approved_by != created_by` and `length(approval_notes) >= 12`.
- **`rticore_service_activity_templates`**: 12 standard phases (`presales_assessment` through `closure`) with `resource_role`, `skill_level`, `resource_count`, `standard_hours_per_unit_hundredths`, `min_effort_hours_hundredths`, `complexity_factor_bps`, `billable`, `depends_on_phase`.
- **`rticore_complexity_matrices`**: configurable factors grouped by `tier`, `environment`, `regulatory`, `delivery`, `emergency` with `multiplier_bps` (`5000`–`40000`).
