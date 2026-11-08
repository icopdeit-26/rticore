/**
 * Persistence for scoping calibration models. Portable SQL (D1/SQLite and the local
 * PostgreSQL adapter). Tables are created on demand so existing databases need no
 * manual migration; migrations/0046_scoping_model_calibration.sql mirrors them.
 */
import type { D1DB } from './boq-auth';
import { TENANT } from './sales-workflow';
import {
  computeCalibration, parseFactors, sampleFromDealFields,
  type CalibrationSample, type CalibrationStats, type ModelFactors,
} from './scoping-calibration';

export type ScopingModelRow = {
  id: string; version: number; status: 'draft' | 'active' | 'archived';
  factors_json: string; stats_json: string; method: string;
  provider_id: string | null; model: string | null; ai_rationale: string | null;
  sample_count: number; created_by: string; created_at: string;
  activated_by: string | null; activated_at: string | null;
};
export type ScopingModelPublic = Omit<ScopingModelRow, 'factors_json' | 'stats_json'> & {
  factors: ModelFactors; stats: CalibrationStats | null;
};

const DDL = [
  `CREATE TABLE IF NOT EXISTS rticore_scoping_models (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, version INTEGER NOT NULL,
    status TEXT NOT NULL, factors_json TEXT NOT NULL, stats_json TEXT NOT NULL,
    method TEXT NOT NULL, provider_id TEXT, model TEXT, ai_rationale TEXT,
    sample_count INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    activated_by TEXT, activated_at TEXT)`,
  // Concurrent drafts cannot share a version number; the loser gets a clear 503 and retries.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_rticore_scoping_models_version ON rticore_scoping_models(tenant_id,version)`,
  `CREATE TABLE IF NOT EXISTS rticore_scoping_model_settings (
    tenant_id TEXT PRIMARY KEY, provider_id TEXT, model TEXT,
    updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

const ready = new WeakSet<object>();
export async function ensureScopingModelTables(db: D1DB): Promise<void> {
  if (ready.has(db)) return;
  for (const sql of DDL) await db.prepare(sql).run();
  ready.add(db);
}

const COLUMNS = 'id,version,status,factors_json,stats_json,method,provider_id,model,ai_rationale,sample_count,created_by,created_at,activated_by,activated_at';

export function toPublic(row: ScopingModelRow): ScopingModelPublic {
  let stats: CalibrationStats | null = null;
  try { stats = JSON.parse(row.stats_json) as CalibrationStats; } catch { stats = null; }
  const { factors_json, stats_json, ...rest } = row;
  void stats_json;
  return { ...rest, version: Number(row.version), sample_count: Number(row.sample_count), factors: parseFactors(factors_json), stats };
}

export async function activeScopingModel(db: D1DB): Promise<ScopingModelPublic | null> {
  await ensureScopingModelTables(db);
  const row = await db.prepare(`SELECT ${COLUMNS} FROM rticore_scoping_models WHERE tenant_id=? AND status='active' ORDER BY version DESC LIMIT 1`)
    .bind(TENANT).first<ScopingModelRow>();
  return row ? toPublic(row) : null;
}

export async function listScopingModels(db: D1DB, limit = 12): Promise<ScopingModelPublic[]> {
  await ensureScopingModelTables(db);
  const rows = await db.prepare(`SELECT ${COLUMNS} FROM rticore_scoping_models WHERE tenant_id=? ORDER BY version DESC LIMIT ?`)
    .bind(TENANT, limit).all<ScopingModelRow>();
  return rows.results.map(toPublic);
}

/** Closed Won opportunities that carry both a scoping base estimate and a PO value. */
export async function loadCalibrationSamples(db: D1DB): Promise<Partial<CalibrationSample>[]> {
  const rows = await db.prepare(`SELECT data_json FROM rticore_sales_opportunities WHERE tenant_id=? AND stage='closed_won' LIMIT 5000`)
    .bind(TENANT).all<{ data_json: string }>();
  const samples: Partial<CalibrationSample>[] = [];
  for (const row of rows.results) {
    let fields: Record<string, unknown>;
    try { fields = JSON.parse(row.data_json || '{}'); } catch { continue; }
    if (!fields || typeof fields !== 'object' || !fields.scoping_estimate_base) continue;
    samples.push(sampleFromDealFields(fields));
  }
  return samples;
}

export async function currentDataset(db: D1DB) {
  const samples = await loadCalibrationSamples(db);
  return { samples, stats: computeCalibration(samples) };
}

export async function saveDraftModel(db: D1DB, input: {
  factors: ModelFactors; stats: CalibrationStats; method: 'statistical' | 'ai_assisted';
  providerId: string | null; model: string | null; rationale: string | null; actor: string;
}): Promise<ScopingModelPublic> {
  await ensureScopingModelTables(db);
  const last = await db.prepare('SELECT MAX(version) AS v FROM rticore_scoping_models WHERE tenant_id=?').bind(TENANT).first<{ v: number | null }>();
  const row: ScopingModelRow = {
    id: crypto.randomUUID(), version: Number(last?.v || 0) + 1, status: 'draft',
    factors_json: JSON.stringify(input.factors), stats_json: JSON.stringify(input.stats), method: input.method,
    provider_id: input.providerId, model: input.model, ai_rationale: input.rationale,
    sample_count: input.stats.totalSamples, created_by: input.actor, created_at: new Date().toISOString(),
    activated_by: null, activated_at: null,
  };
  await db.prepare(`INSERT INTO rticore_scoping_models(id,tenant_id,version,status,factors_json,stats_json,method,provider_id,model,ai_rationale,sample_count,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id, TENANT, row.version, row.status, row.factors_json, row.stats_json,
    row.method, row.provider_id, row.model, row.ai_rationale, row.sample_count, row.created_by, row.created_at).run();
  return toPublic(row);
}

/** Maker-checker is the Admin themself here; activation archives the previous active model atomically. */
export async function activateModel(db: D1DB, id: string, actor: string): Promise<boolean> {
  await ensureScopingModelTables(db);
  const draft = await db.prepare(`SELECT id FROM rticore_scoping_models WHERE tenant_id=? AND id=? AND status='draft'`).bind(TENANT, id).first<{ id: string }>();
  if (!draft) return false;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE rticore_scoping_models SET status='archived' WHERE tenant_id=? AND status='active'`).bind(TENANT),
    db.prepare(`UPDATE rticore_scoping_models SET status='active',activated_by=?,activated_at=? WHERE tenant_id=? AND id=? AND status='draft'`).bind(actor, now, TENANT, id),
  ]);
  return true;
}

export async function readModelSettings(db: D1DB): Promise<{ provider_id: string | null; model: string | null } | null> {
  await ensureScopingModelTables(db);
  return db.prepare('SELECT provider_id,model FROM rticore_scoping_model_settings WHERE tenant_id=?').bind(TENANT)
    .first<{ provider_id: string | null; model: string | null }>();
}

export async function saveModelSettings(db: D1DB, providerId: string, model: string, actor: string): Promise<void> {
  await ensureScopingModelTables(db);
  const now = new Date().toISOString();
  const exists = await db.prepare('SELECT tenant_id FROM rticore_scoping_model_settings WHERE tenant_id=?').bind(TENANT).first();
  if (exists) await db.prepare('UPDATE rticore_scoping_model_settings SET provider_id=?,model=?,updated_by=?,updated_at=? WHERE tenant_id=?')
    .bind(providerId, model, actor, now, TENANT).run();
  else await db.prepare('INSERT INTO rticore_scoping_model_settings(tenant_id,provider_id,model,updated_by,updated_at) VALUES(?,?,?,?,?)')
    .bind(TENANT, providerId, model, actor, now).run();
}
