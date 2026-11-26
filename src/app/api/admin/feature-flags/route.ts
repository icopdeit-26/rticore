import { authorizeBoQ } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText } from '@/lib/erp-core';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(['admin', 'approver', 'itdev_leader'].includes(role), 'Hanya Admin, Approver, atau IT Dev Leader yang dapat membaca feature flags', 403);
    const entityId = new URL(req.url).searchParams.get('legal_entity_id');
    const rows = entityId
      ? await db.prepare('SELECT * FROM rticore_feature_flags WHERE tenant_id=? AND (legal_entity_id=? OR legal_entity_id IS NULL) ORDER BY flag_key').bind(TENANT, entityId).all()
      : await db.prepare('SELECT * FROM rticore_feature_flags WHERE tenant_id=? ORDER BY flag_key').bind(TENANT).all();
    return erpReply({ success: true, flags: rows.results });
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role, email } = a.identity;
  try {
    erpOrigin(req);
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan mengubah feature flags', 403);
    const v = (await readBoundedJSON(req, 8000)) as Record<string, unknown>;
    const action = String(v.action || '');

    if (action === 'request_flag') {
      erpAssert(['admin'].includes(role), 'Hanya Admin yang dapat mengajukan perubahan feature flag', 403);
      erpAssert(erpText(v.flag_key, 3, 96) && /^[a-z0-9_.-]+$/.test(String(v.flag_key)), 'Format flag_key tidak valid');
      erpAssert(erpText(v.description, 8, 500), 'Deskripsi feature flag minimal 8 karakter');
      const scope = String(v.rollout_scope || 'staging_only');
      erpAssert(['disabled', 'staging_only', 'entity_pilot', 'all_certified'].includes(scope), 'Rollout scope tidak valid');
      const legalEntityId = typeof v.legal_entity_id === 'string' && erpId(v.legal_entity_id) ? v.legal_entity_id : null;
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare('INSERT INTO rticore_feature_flags(id,tenant_id,legal_entity_id,flag_key,description,enabled,rollout_scope,status,requested_by) VALUES(?,?,?,?,?,0,?,\'pending\',?)')
            .bind(id, TENANT, legalEntityId, String(v.flag_key).trim(), String(v.description).trim(), scope, email),
        ],
        'feature_flags',
        id,
        'FLAG_REQUESTED',
        { flag_key: v.flag_key, rollout_scope: scope, legal_entity_id: legalEntityId },
      );
      return erpReply({ success: true, id, status: 'pending', enabled: 0 }, 201);
    }

    if (action === 'approve_flag') {
      erpAssert(['admin', 'approver'].includes(role), 'Hanya Admin independen atau Approver yang dapat menyetujui feature flag', 403);
      erpAssert(erpId(v.id) && erpText(v.approval_notes, 12, 500), 'ID flag dan catatan approval minimal 12 karakter wajib');
      const enable = v.enabled === true || v.enabled === 1 ? 1 : 0;
      const existing = await db.prepare('SELECT id, requested_by, version, flag_key FROM rticore_feature_flags WHERE tenant_id=? AND id=?').bind(TENANT, v.id as string).first<{ id: string; requested_by: string; version: number; flag_key: string }>();
      erpAssert(existing, 'Feature flag tidak ditemukan', 404);
      erpAssert(existing.requested_by.toLowerCase() !== email.toLowerCase(), 'Maker tidak boleh menyetujui feature flag sendiri (SoD)', 403);
      await erpAtom(
        a.identity,
        '1=1',
        [],
        [
          db.prepare("UPDATE rticore_feature_flags SET enabled=?, status='active', approved_by=?, approval_notes=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=? AND version=? AND lower(requested_by)!=?")
            .bind(enable, email, String(v.approval_notes).trim(), TENANT, existing.id, existing.version, email.toLowerCase()),
        ],
        'feature_flags',
        existing.id,
        'FLAG_APPROVED',
        { flag_key: existing.flag_key, enabled: enable },
      );
      return erpReply({ success: true, id: existing.id, status: 'active', enabled: enable });
    }

    return erpReply({ success: false, message: 'Action feature flag tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
