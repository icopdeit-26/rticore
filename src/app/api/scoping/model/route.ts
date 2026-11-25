import { authorizeBoQ, privateHeaders } from '@/lib/boq-auth';
import { activeScopingModel } from '@/lib/scoping-model-store';
import { calibrationFactor, isCalibrationDue } from '@/lib/scoping-calibration';
import { can } from '@/lib/boq-domain';
import { readBoundedJSON, RequestBodyError } from '@/lib/bounded-json';
import { estimateScopingPrice, validateCommercialContext, type CommercialContext } from '@/lib/scoping-pricing';
import { SCOPING_SERVICE_TYPES, type ScopingService } from '@/lib/scoping-service-options';
import {isLoopbackRequest,isSameLocalOrigin} from '@/lib/local-auth';

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

const stringMap=(value:unknown):value is Record<string,string> =>
  !!value && typeof value==='object' && !Array.isArray(value) &&
  Object.values(value).every(v=>typeof v==='string' && v.length<=400);

export async function POST(req:Request){
  const auth=await authorizeBoQ(req);
  if(!auth.ok)return auth.response;
  const {role,db}=auth.identity;
  const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:privateHeaders});
  if(!['admin','finance','presales','sales','approver'].includes(role))return reply({success:false},403);
  const origin=req.headers.get('origin');
  const sameOrigin=isLoopbackRequest(req)?isSameLocalOrigin(req):
    req.headers.get('sec-fetch-site')!=='cross-site'&&(!origin||origin===new URL(req.url).origin);
  if(!sameOrigin)return reply({success:false},403);
  try{
    const input=await readBoundedJSON(req,16000);
    const service=input.service as ScopingService;
    const ctx=input.ctx as CommercialContext|undefined;
    if(!SCOPING_SERVICE_TYPES.includes(service)||!ctx||typeof ctx.total_md!=='string'||
        !stringMap(ctx.costs)||!stringMap(ctx.role_md)||!stringMap(input.serviceValues)){
      return reply({success:false,message:'Parameter estimasi tidak valid'},422);
    }
    const canViewCost=can(role,'read_cost');
    const context={...ctx,costs:canViewCost?ctx.costs:{}};
    if(validateCommercialContext(context).length)return reply({success:false,message:'Parameter komersial tidak valid'},422);
    const number=(v:unknown,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:undefined;
    const model=await activeScopingModel(db);
    const estimate=estimateScopingPrice({service,ctx:context,serviceValues:input.serviceValues,
      vaptTotalMd:number(input.vaptTotalMd,100000),socBaseMrc:number(input.socBaseMrc,1e13),
      socMonths:number(input.socMonths,60),calibrationFactor:calibrationFactor(model?.factors,service),
      sellingOnly:!canViewCost});
    if(!canViewCost){
      estimate.staffing=estimate.staffing.map(row=>({...row,rate:0,subtotal:0}));
      estimate.costs={A:0,B:0,C:0,D:0,E:0};
      estimate.totalInternalCost=0;
      estimate.floor=null;
      estimate.marginAtStandard=null;
      estimate.marginWarning=false;
      estimate.heldAtFloor=false;
    }
    return reply({success:true,estimate,canViewCost,modelVersion:model?.version??null});
  }catch(e){
    return reply({success:false,message:'Estimasi scoping belum tersedia'},e instanceof RequestBodyError?e.status:503);
  }
}
