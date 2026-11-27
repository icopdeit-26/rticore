import {getLocalD1} from './local-d1';
import {getLocalPostgresDB} from './postgres-db';
import {validateHostingerConfig} from './hostinger-config';

/** Native Node runtime: explicit Hostinger or loopback development; no remote fallback. */
declare const process:{env:Record<string,string|undefined>}|undefined;
declare const navigator:{userAgent?:string}|undefined;

export function isLocalMode():boolean{
  if(typeof navigator!=='undefined'&&navigator?.userAgent==='Cloudflare-Workers')return false;
  return typeof process!=='undefined'&&process?.env?.RTICORE_RUNTIME!=='hostinger'&&process?.env?.RTICORE_LOCAL_MODE==='1';
}

const LOCAL_KEYS=['RTICORE_PUBLIC_ORIGIN','RTICORE_OIDC_CLIENT_SECRET','RTICORE_OIDC_ISSUER','RTICORE_OIDC_CLIENT_ID','RTICORE_OIDC_AUDIENCE','RTICORE_AI_ENCRYPTION_KEY',
  'RTICORE_DOCUMENT_ENCRYPTION_KEY','RTICORE_SECURITY_ALLOWED_HOSTS','RTICORE_SIEM_OUTBOUND_TOKEN','RTICORE_EDR_OUTBOUND_TOKEN','RTICORE_LOCAL_SESSION_SECRET'] as const;

export async function getRuntimeEnv<T=Record<string,unknown>>():Promise<T>{
  if(typeof navigator==='undefined'||navigator?.userAgent!=='Cloudflare-Workers'){
    if(typeof process!=='undefined'&&process?.env?.RTICORE_RUNTIME==='hostinger'){
      const e=process.env;
      validateHostingerConfig(e);
      const env:Record<string,unknown>={RTICORE_DB:getLocalPostgresDB(),RTICORE_LOCAL_MODE:'0',RTICORE_RUNTIME:'hostinger'};
      for(const key of LOCAL_KEYS)if(key!=='RTICORE_LOCAL_SESSION_SECRET'&&!key.startsWith('RTICORE_ACCESS_')&&e[key])env[key]=e[key];
      return env as T;
    }
  }
  if(isLocalMode()){
    const db=process?.env?.RTICORE_DB_ENGINE==='sqlite'?getLocalD1():getLocalPostgresDB();
    const env:Record<string,unknown>={RTICORE_LOCAL_MODE:'1',RTICORE_DB:db};
    for(const key of LOCAL_KEYS)if(process?.env?.[key])env[key]=process.env[key];
    return env as T;
  }
  throw new Error('RTICORE runtime not configured: native Hostinger or explicit local mode required');
}

// Worker secrets cannot be read back or renamed, so those provisioned before the
// RTICORE rename stay usable under their INDIA_ name until they are re-issued.
const LEGACY_SECRETS=['AI_ENCRYPTION_KEY','DOCUMENT_ENCRYPTION_KEY','SECURITY_ALLOWED_HOSTS',
  'SIEM_OUTBOUND_TOKEN','EDR_OUTBOUND_TOKEN'] as const;

export function withLegacySecretNames<T extends object>(env:T):T{
  const source=env as Record<string,unknown>,aliased=Object.create(env) as Record<string,unknown>;
  for(const name of LEGACY_SECRETS)
    if(source['RTICORE_'+name]===undefined&&source['INDIA_'+name]!==undefined)aliased['RTICORE_'+name]=source['INDIA_'+name];
  return aliased as T;
}
