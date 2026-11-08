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
  return typeof process!=='undefined'&&process?.env?.RTICORE_LOCAL_MODE==='1';
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
  return (await getCloudflareContext({async:true})).env as T;
}
