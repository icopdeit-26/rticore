import {getCloudflareContext} from '@opennextjs/cloudflare';
import {getLocalD1} from './local-d1';
import {getLocalPostgresDB} from './postgres-db';

/**
 * Single entry point for runtime bindings.
 *
 * Cloud (default): Cloudflare Worker env via OpenNext (D1 binding, secrets, vars).
 * Local (RTICORE_LOCAL_MODE=1 on Node.js): local PostgreSQL database (.pgdata or
 * DATABASE_URL) + values from .env.local. No Cloudflare account, Access, D1 or
 * external cloud service is used.
 */
declare const process:{env:Record<string,string|undefined>}|undefined;
declare const navigator:{userAgent?:string}|undefined;

export function isLocalMode():boolean{
  if(typeof navigator!=='undefined'&&navigator?.userAgent==='Cloudflare-Workers')return false;
  return typeof process!=='undefined'&&process?.env?.RTICORE_RUNTIME!=='hostinger'&&process?.env?.RTICORE_LOCAL_MODE==='1';
}

const LOCAL_KEYS=['RTICORE_ACCESS_AUD','RTICORE_ACCESS_TEAM_DOMAIN','RTICORE_AI_ENCRYPTION_KEY',
  'RTICORE_DOCUMENT_ENCRYPTION_KEY','RTICORE_SECURITY_ALLOWED_HOSTS','RTICORE_LOCAL_SESSION_SECRET'] as const;

export async function getRuntimeEnv<T=Record<string,unknown>>():Promise<T>{
  if(isLocalMode()){
    const db=process?.env?.RTICORE_DB_ENGINE==='sqlite'?getLocalD1():getLocalPostgresDB();
    const env:Record<string,unknown>={RTICORE_LOCAL_MODE:'1',RTICORE_DB:db};
    for(const key of LOCAL_KEYS)if(process?.env?.[key])env[key]=process.env[key];
    return env as T;
  }
  // Explicit native hosting mode: retain Cloudflare Access JWT verification,
  // never enable the localhost account picker or embedded database in production.
  if(typeof process!=='undefined'&&process?.env?.RTICORE_RUNTIME==='hostinger'){
    if(!process.env.DATABASE_URL&&!process.env.POSTGRES_URL)throw Error('Hostinger PostgreSQL configuration required');
    const env:Record<string,unknown>={RTICORE_DB:getLocalPostgresDB()};
    for(const key of LOCAL_KEYS)if(key!=='RTICORE_LOCAL_SESSION_SECRET'&&process.env[key])env[key]=process.env[key];
    return env as T;
  }
  return withLegacySecretNames((await getCloudflareContext({async:true})).env) as T;
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
