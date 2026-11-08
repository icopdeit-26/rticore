-- Scoping price-model calibration (ICOP indication vs final negotiated PO value).
-- Mirrors the on-demand DDL in src/lib/scoping-model-store.ts.
CREATE TABLE IF NOT EXISTS rticore_scoping_models (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, version INTEGER NOT NULL,
 status TEXT NOT NULL, factors_json TEXT NOT NULL, stats_json TEXT NOT NULL,
 method TEXT NOT NULL, provider_id TEXT, model TEXT, ai_rationale TEXT,
 sample_count INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 activated_by TEXT, activated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rticore_scoping_models_status ON rticore_scoping_models(tenant_id,status,version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_scoping_models_version ON rticore_scoping_models(tenant_id,version);
CREATE TABLE IF NOT EXISTS rticore_scoping_model_settings (
 tenant_id TEXT PRIMARY KEY, provider_id TEXT, model TEXT,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
