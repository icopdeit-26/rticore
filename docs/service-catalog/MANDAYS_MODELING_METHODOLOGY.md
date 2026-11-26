# 5. Activity-Based Mandays Modeling Methodology

Implemented in `src/lib/enterprise-pricing-engine.ts` (`calculateActivityBasedMandays`, `computeHistoricalEffortRecommendation`).

## Formula
1. **Base Effort Hours (person-hours):** `Quantity × Standard Hours per Unit × Resource Count`
2. **Adjusted Effort Hours:** `max(Base Effort Hours × Complexity Factor × Environment Factor × Other Approved Factors, Min Effort Hours)`
3. **Estimated Mandays (person-days, NOT calendar duration):** `Adjusted Effort Hours / Working Hours per Manday` (default `8` working hours/manday, configurable `4–12`), rounded according to configurable policy (`tenth`, `half_day`, `whole_day`) with configurable minimum charge floor.
4. **Calendar Duration Estimate:** `ceil(Estimated Mandays / Parallel Resource Count)` per phase — strictly separated from billable person-days.
5. **12 Standard Activity Phases:** Presales Technical Assessment (default non-billable), Scope Validation, Preparation, Kickoff, Technical Execution, Analysis, Quality Assurance, Reporting, Presentation, Retest, Project Management, Closure.
6. **Baseline Complexity Tiers (configurable in `rticore_complexity_matrices`):** Basic `0.75x`, Standard `1.00x`, Medium `1.25x`, High `1.50x`, Critical `2.00x`.
7. **Historical Learning (`rticore_historical_effort_benchmarks`):** Empirical-Bayes shrinkage weight `n / (n + 5)` bounded to `[-30%, +40%]` generates `recommended_mandays_tenths` with `autoApplied: false` and `requiresApproval: true` — standard mandays and rate cards are NEVER altered automatically.
