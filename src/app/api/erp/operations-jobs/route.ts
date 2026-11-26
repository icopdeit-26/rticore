import { authorizeBoQ } from '@/lib/boq-auth';
import { readBoundedJSON } from '@/lib/bounded-json';
import { TENANT } from '@/lib/sales-workflow';
import { erpReply, erpError, erpAssert, erpOrigin, erpAtom, erpId, erpText } from '@/lib/erp-core';

export const dynamic = 'force-dynamic';

const OPS_READ_ROLES = ['admin', 'approver', 'itdev_leader', 'finance'];

export async function GET(req: Request) {
  const a = await authorizeBoQ(req);
  if (!a.ok) return a.response;
  const { db, role } = a.identity;
  try {
    erpAssert(OPS_READ_ROLES.includes(role), 'Hanya Admin, Approver, Finance, atau IT Dev Leader yang dapat mengakses Operations Center', 403);
    const [jobs, drills, flags, auditEvents] = await Promise.all([
      db.prepare('SELECT * FROM rticore_background_jobs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100').bind(TENANT).all(),
      db.prepare('SELECT * FROM rticore_backup_drills WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50').bind(TENANT).all(),
      db.prepare('SELECT * FROM rticore_feature_flags WHERE tenant_id=? ORDER BY flag_key LIMIT 100').bind(TENANT).all(),
      db.prepare('SELECT id, area, entity_id, action, actor_email, created_at FROM rticore_operations_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 150').bind(TENANT).all(),
    ]);
    return erpReply({
      success: true,
      background_jobs: jobs.results,
      backup_drills: drills.results,
      feature_flags: flags.results,
      unified_audit_events: auditEvents.results,
    });
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
    erpAssert(!a.identity.rolePreview, 'Role preview tidak diizinkan mengubah operasi sistem', 403);
    const v = (await readBoundedJSON(req, 16000)) as Record<string, unknown>;
    const action = String(v.action || '');

    if (action === 'enqueue_job') {
      erpAssert(['admin', 'finance', 'approver'].includes(role), 'Hak akses enqueue job ditolak', 403);
      erpAssert(erpText(v.idempotency_key, 8, 160), 'idempotency_key minimal 8 karakter wajib');
      const jobType = String(v.job_type || '');
      const valid = ['finance_outbox_dispatch', 'flexguard_expiry_scan', 'sla_breach_monitor', 'sales_activity_sla', 'backup_verification', 'report_generation', 'renewal_signal_scan'];
      erpAssert(valid.includes(jobType), 'job_type tidak valid');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare("INSERT INTO rticore_background_jobs(id,tenant_id,legal_entity_id,job_type,idempotency_key,payload_json,status,max_attempts,created_by) VALUES(?,?,?,?,?,?,'queued',?,?)")
            .bind(id, TENANT, typeof v.legal_entity_id === 'string' && erpId(v.legal_entity_id) ? v.legal_entity_id : null, jobType, String(v.idempotency_key).trim(), JSON.stringify(v.payload || {}), Number(v.max_attempts || 5), email),
        ],
        'system_operations', id, 'BG_JOB_ENQUEUED', { job_type: jobType, idempotency_key: v.idempotency_key },
      );
      return erpReply({ success: true, id, status: 'queued' }, 201);
    }

    if (action === 'retry_dead_letter') {
      erpAssert(['admin'].includes(role), 'Hanya Admin yang dapat me-retry dead-letter job', 403);
      erpAssert(erpId(v.job_id), 'job_id wajib');
      const job = await db.prepare("SELECT id, status FROM rticore_background_jobs WHERE tenant_id=? AND id=? AND status IN ('failed','dead_letter')")
        .bind(TENANT, v.job_id as string).first<{ id: string; status: string }>();
      erpAssert(job, 'Job failed/dead_letter tidak ditemukan', 404);
      await erpAtom(
        a.identity, '1=1', [],
        [db.prepare("UPDATE rticore_background_jobs SET status='queued', attempts=0, last_error=NULL, next_run_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND id=?").bind(TENANT, job.id)],
        'system_operations', job.id, 'BG_JOB_RETRIED', { previous_status: job.status },
      );
      return erpReply({ success: true, id: job.id, status: 'queued' });
    }

    if (action === 'record_backup_drill') {
      erpAssert(['admin'].includes(role), 'Hanya Admin yang dapat mencatat hasil backup drill', 403);
      erpAssert(typeof v.sha256_checksum === 'string' && /^[a-f0-9]{64}$/i.test(v.sha256_checksum), 'sha256_checksum (64 hex) wajib');
      erpAssert(erpText(v.notes, 12, 1000), 'Catatan backup drill minimal 12 karakter wajib');
      const rpo = Number(v.rpo_minutes);
      const rto = Number(v.rto_minutes);
      erpAssert(Number.isSafeInteger(rpo) && rpo >= 0 && Number.isSafeInteger(rto) && rto >= 0, 'RPO/RTO wajib integer non-negatif');
      const id = crypto.randomUUID();
      await erpAtom(
        a.identity, '1=1', [],
        [
          db.prepare(
            `INSERT INTO rticore_backup_drills(id,tenant_id,environment_name,backup_kind,encrypted,sha256_checksum,rpo_minutes,rto_minutes,restore_verified,reconciliation_passed,notes,executed_by)
             VALUES(?,?,?,?,1,?,?,?,0,0,?,?)`,
          ).bind(id, TENANT, String(v.environment_name || 'local_rehearsal'), String(v.backup_kind || 'postgresql_logical'), v.sha256_checksum.toLowerCase(), rpo, rto, String(v.notes).trim(), email),
        ],
        'backup_recovery', id, 'BACKUP_DRILL_RECORDED', { environment_name: v.environment_name, rpo_minutes: rpo, rto_minutes: rto },
      );
      return erpReply({ success: true, id, restore_verified: 0 }, 201);
    }

    if (action === 'verify_backup_drill') {
      erpAssert(['admin', 'approver'].includes(role), 'Hanya verifikator independen (Admin/Approver) yang dapat mengesahkan restore drill', 403);
      erpAssert(erpId(v.drill_id), 'drill_id wajib');
      const drill = await db.prepare('SELECT id, executed_by, rpo_minutes, rto_minutes FROM rticore_backup_drills WHERE tenant_id=? AND id=?')
        .bind(TENANT, v.drill_id as string).first<{ id: string; executed_by: string; rpo_minutes: number; rto_minutes: number }>();
      erpAssert(drill, 'Backup drill tidak ditemukan', 404);
      erpAssert(drill.executed_by.toLowerCase() !== email.toLowerCase(), 'Pelaksana backup tidak boleh memverifikasi restore drill sendiri (SoD)', 403);
      const recon = v.reconciliation_passed === true || v.reconciliation_passed === 1 ? 1 : 0;
      await erpAtom(
        a.identity, '1=1', [],
        [db.prepare("UPDATE rticore_backup_drills SET restore_verified=1, reconciliation_passed=?, verified_by=? WHERE tenant_id=? AND id=? AND lower(executed_by)!=?").bind(recon, email, TENANT, drill.id, email.toLowerCase())],
        'backup_recovery', drill.id, 'BACKUP_DRILL_VERIFIED', { reconciliation_passed: recon, rpo_sla_met: drill.rpo_minutes <= 60, rto_sla_met: drill.rto_minutes <= 240 },
      );
      return erpReply({ success: true, id: drill.id, restore_verified: 1, rpo_sla_met: drill.rpo_minutes <= 60, rto_sla_met: drill.rto_minutes <= 240 });
    }

    return erpReply({ success: false, message: 'Action Operations Center tidak dikenali' }, 422);
  } catch (e) {
    return erpError(e);
  }
}
