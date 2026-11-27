// Shared runtime boundary for CAMS receiver and inbox; never opens the production approval gate.
export type CamsRuntimeEnv=Record<string,string|undefined>;
export function camsDatabaseMode(env:CamsRuntimeEnv):'hostinger'|'local'|null{
 if(!env.DATABASE_URL||env.RTICORE_DB_ENGINE==='sqlite')return null;
 if(env.RTICORE_RUNTIME==='hostinger')return env.RTICORE_LOCAL_MODE==='0'&&env.RTICORE_DB_ENGINE==='postgres'?'hostinger':null;
 return env.NODE_ENV!=='production'&&env.RTICORE_LOCAL_MODE==='1'?'local':null;
}
export function camsInboxScope(env:CamsRuntimeEnv,requestedEntity:string|null){
 const mode=camsDatabaseMode(env);
 if(!mode||env.CAMS_FINANCE_DOCKING_ENABLED!=='true')return null;
 const source=env.CAMS_FINANCE_SOURCE_TENANT_ID,entity=env.CAMS_FINANCE_LEGAL_ENTITY_ID;
 if(!source||!entity||!requestedEntity||requestedEntity!==entity)return null;
 return {mode,source,entity};
}
export function camsLegacyPostingAllowed(env:CamsRuntimeEnv){
 return camsDatabaseMode(env)==='local'&&env.CAMS_FINANCE_DOCKING_ENABLED==='true';
}
