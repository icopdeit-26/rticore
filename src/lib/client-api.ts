/**
 * Browser helpers for RTICORE API calls.
 * A server/proxy failure can answer with HTML or an empty body; never surface
 * raw parser errors ("Unexpected token <") or "Error: " prefixes to users.
 */
export type ApiBody={success?:boolean;message?:string;missing?:string[];[key:string]:unknown};

// Same loose typing as Response.json(): callers already describe their payloads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readApiJSON(response:Response):Promise<any>{
  const text=await response.text();
  if(!text)return {success:response.ok,message:response.ok?undefined:'Server tidak mengirim respons (HTTP '+response.status+').'};
  try{return JSON.parse(text) as ApiBody;}
  catch{return {success:false,message:'Server mengirim respons tidak valid (HTTP '+response.status+'). Coba muat ulang halaman.'};}
}

export function errorText(error:unknown,fallback='Transaksi gagal'):string{
  if(error instanceof Error)return error.message||fallback;
  if(typeof error==='string')return error.replace(/^Error:\s*/,'')||fallback;
  return fallback;
}

/** Whole rupiah for display; forecast weighting can produce fractions. */
export function rupiah(value:number,prefix='Rp '):string{
  return prefix+Math.round(Number(value)||0).toLocaleString('id-ID');
}
