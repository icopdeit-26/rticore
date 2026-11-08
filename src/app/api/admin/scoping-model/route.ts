import { authorizeBoQ, privateHeaders } from '@/lib/boq-auth';
import { readBoundedJSON, RequestBodyError } from '@/lib/bounded-json';
import { reserveAIRequest } from '@/lib/ai-request-budget';
import { getProviderRows, decryptProviderKey, invokeAI } from '@/lib/ai-credential-vault';
import { AI_PROVIDERS, isProviderId, safeModel } from '@/lib/ai-provider-registry';
import {
  statisticalFactors, buildCalibrationPrompt, parseAiProposal, isCalibrationDue, RECALIBRATION_DAYS,
} from '@/lib/scoping-calibration';
import {
  activeScopingModel, listScopingModels, currentDataset, saveDraftModel, activateModel,
  readModelSettings, saveModelSettings,
} from '@/lib/scoping-model-store';

export const dynamic = 'force-dynamic';
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });
const fail = (message: string, status = 422) => reply({ success: false, message }, status);

async function usableProviders(db: Parameters<typeof getProviderRows>[0]) {
  const rows = await getProviderRows(db);
  return rows.filter(r => r.enabled === 1 && r.tested_ok === 1 && !!r.key_ciphertext && isProviderId(r.provider_id))
    .map(r => ({ id: r.provider_id, name: AI_PROVIDERS.find(p => p.id === r.provider_id)?.name || r.provider_id,
      model: r.model, models: AI_PROVIDERS.find(p => p.id === r.provider_id)?.models || [r.model] }));
}

export async function GET(req: Request) {
  const a = await authorizeBoQ(req); if (!a.ok) return a.response;
  const { db, role } = a.identity;
  if (role !== 'admin') return fail('Hanya Admin dapat mengelola model scoping.', 403);
  try {
    const [active, history, dataset, settings, providers] = await Promise.all([
      activeScopingModel(db), listScopingModels(db), currentDataset(db), readModelSettings(db), usableProviders(db),
    ]);
    return reply({
      success: true, active, history, settings, providers,
      dataset: { stats: dataset.stats, statisticalFactors: statisticalFactors(dataset.stats) },
      due: isCalibrationDue(active?.activated_at), recalibrationDays: RECALIBRATION_DAYS,
    });
  } catch {
    return fail('Model scoping belum dapat dibaca dari database.', 503);
  }
}

export async function POST(req: Request) {
  const a = await authorizeBoQ(req); if (!a.ok) return a.response;
  const { db, role, email } = a.identity;
  if (role !== 'admin') return fail('Hanya Admin dapat memperbarui model scoping.', 403);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return fail('Origin ditolak', 403);
  let p: Record<string, unknown>;
  try { p = await readBoundedJSON(req, 4000); }
  catch (e) { return fail('Format permintaan tidak valid.', e instanceof RequestBodyError ? e.status : 400); }

  try {
    if (p.action === 'settings') {
      if (!isProviderId(p.provider_id) || !safeModel(p.model)) return fail('Pilih provider dan model AI yang valid.');
      const provider = (await usableProviders(db)).find(x => x.id === p.provider_id);
      if (!provider) return fail('Provider belum aktif atau belum lulus uji di menu API Key.');
      if (!(provider.models as readonly string[]).includes(p.model as string) && provider.model !== p.model) return fail('Model tidak tersedia untuk provider ini.');
      await saveModelSettings(db, p.provider_id, p.model as string, email);
      return reply({ success: true, message: 'AI untuk pembaruan model disimpan.' });
    }

    if (p.action === 'propose') {
      const { stats } = await currentDataset(db);
      const statistical = statisticalFactors(stats);
      if (p.mode === 'statistical') {
        const model = await saveDraftModel(db, { factors: statistical, stats, method: 'statistical', providerId: null, model: null,
          rationale: 'Faktor statistik (median rasio deal/indikasi dengan shrinkage) tanpa AI.', actor: email });
        return reply({ success: true, model, message: 'Draft model statistik v' + model.version + ' dibuat. Tinjau lalu aktifkan.' });
      }
      if (stats.totalSamples === 0) return fail('Belum ada data Closed Won yang memiliki estimasi scoping dan nilai PO. Gunakan mode statistik setelah data tersedia.');
      const settings = await readModelSettings(db);
      const providerId = isProviderId(p.provider_id) ? p.provider_id : settings?.provider_id;
      const rows = await getProviderRows(db);
      const row = rows.find(r => r.provider_id === providerId && r.enabled === 1 && r.tested_ok === 1 && !!r.key_ciphertext);
      if (!row || !isProviderId(row.provider_id)) return fail('Pilih AI yang aktif dan sudah lulus uji di menu API Key.');
      const modelName = safeModel(p.model) ? p.model as string : settings?.model && safeModel(settings.model) ? settings.model : row.model;
      if (!await reserveAIRequest(db, email, 'scoping_model')) return fail('Batas maksimal 20 permintaan AI per jam per pengguna.', 429);
      let content: string;
      try {
        content = await invokeAI(row.provider_id, modelName, await decryptProviderKey(row), buildCalibrationPrompt(stats, (await activeScopingModel(db))?.factors || null));
      } catch {
        return fail('Provider AI gagal merespons. Coba provider lain atau gunakan mode statistik.', 502);
      }
      let proposal;
      try { proposal = parseAiProposal(content, stats); }
      catch (e) { return fail((e instanceof Error ? e.message : 'Respons AI tidak valid') + ' Gunakan mode statistik atau ulangi.', 502); }
      const note = proposal.adjusted.length ? ' [Dibatasi guardrail: ' + proposal.adjusted.join(', ') + ']' : '';
      const model = await saveDraftModel(db, { factors: proposal.factors, stats, method: 'ai_assisted',
        providerId: row.provider_id, model: modelName, rationale: (proposal.rationale + note).slice(0, 2200), actor: email });
      return reply({ success: true, model, message: 'Draft model AI v' + model.version + ' dibuat oleh ' + row.provider_id + '. Tinjau lalu aktifkan.' });
    }

    if (p.action === 'activate') {
      if (typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id)) return fail('ID model tidak valid.');
      const ok = await activateModel(db, p.id, email);
      return ok ? reply({ success: true, message: 'Model diaktifkan dan dipakai pada scoping berikutnya.' }) : fail('Hanya draft yang dapat diaktifkan.', 409);
    }
    return fail('Aksi tidak didukung.');
  } catch {
    return fail('Pembaruan model scoping gagal disimpan.', 503);
  }
}
