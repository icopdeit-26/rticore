import { authorizeBoQ, privateHeaders } from '@/lib/boq-auth';
import { activeScopingModel } from '@/lib/scoping-model-store';
import { isCalibrationDue } from '@/lib/scoping-calibration';

export const dynamic = 'force-dynamic';

/** Active calibration factors for any authenticated member (no stats, no rationale). */
export async function GET(req: Request) {
  const a = await authorizeBoQ(req); if (!a.ok) return a.response;
  try {
    const active = await activeScopingModel(a.identity.db);
    return Response.json({ success: true,
      model: active ? { version: active.version, factors: active.factors, activated_at: active.activated_at } : null,
      due: a.identity.role === 'admin' ? isCalibrationDue(active?.activated_at) : undefined,
    }, { headers: privateHeaders });
  } catch {
    return Response.json({ success: true, model: null }, { headers: privateHeaders });
  }
}
