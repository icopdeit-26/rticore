import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {PGlite} from '@electric-sql/pglite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version='33d362f827030606ab15a4f29a42c22c2eba3c7b';
const source=`https://raw.githubusercontent.com/mrayhanfadil/kodepos-id/${version}/kodepos_parsed.csv`;
const cache=path.join(root,'.local-data','postal-reference.csv');
fs.mkdirSync(path.dirname(cache),{recursive:true});
if(!fs.existsSync(cache)){
 const response=await fetch(source,{signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error(`Unduhan referensi gagal: HTTP ${response.status}`);
 fs.writeFileSync(cache,await response.text());
}
// RFC4180-style parser: quoted commas, escaped quotes and embedded newlines.
const records=[];let row=[],cell='',quoted=false;
const text=fs.readFileSync(cache,'utf8').replace(/^\uFEFF/,'');
for(let i=0;i<text.length;i++){
 const char=text[i];
 if(char==='"'){
  if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
 }else if(!quoted&&(char===','||char==='\n')){
  row.push(cell.replace(/\r$/,''));cell='';
  if(char==='\n'){records.push(row);row=[];}
 }else cell+=char;
}
if(quoted)throw Error('CSV referensi tidak lengkap');
if(cell||row.length){row.push(cell.replace(/\r$/,''));records.push(row);}
const headers=records.shift();
const mapped=new Map();
for(const record of records){
 if(record.length!==headers.length)continue;
 const r=Object.fromEntries(headers.map((key,i)=>[key,record[i].trim()]));
 if(!/^\d{5}$/.test(r.kode_pos)||!r.kode_wilayah||!r.desa)continue;
 let province=r.prov_code,regency=province+'.'+r.kab_code,district=regency+'.'+r.kec_code,code=r.kode_wilayah;
 if(province.length!==2||regency.length!==5||district.length!==8)continue;
 // Same source correction used by import-indonesia-postal.py.
 if(r.provinsi==='Papua Barat Daya'){
  if(province!=='92')throw Error('Kode sumber Papua Barat Daya berubah');
  province='96';regency='PBD-'+r.kab_code;district=regency+'-'+r.kec_code;code='PBD:'+code;
 }
 mapped.set(code,[code,r.kode_pos,province,r.provinsi,regency,r.dt2+' '+r.kabupaten,district,r.kecamatan,r.desa,r.is_kelurahan==='1'?'Kelurahan':'Desa',version]);
}
const rows=[...mapped.values()];
const provinces=[...new Set(rows.map(r=>r[2]))].sort();
const expected='11 12 13 14 15 16 17 18 19 21 31 32 33 34 35 36 51 52 53 61 62 63 64 65 71 72 73 74 75 76 81 82 91 92 93 94 95 96'.split(' ');
if(rows.length<80000||JSON.stringify(provinces)!==JSON.stringify(expected))throw Error('Cakupan referensi tidak lengkap; impor dibatalkan');
const matches=rows.filter(r=>r[1]==='42117');
if(!matches.length)throw Error('Kode pos regresi 42117 tidak ada di sumber; impor dibatalkan');
console.log(`Referensi tervalidasi: ${rows.length} desa/kelurahan, ${provinces.length} provinsi.`);
if(process.argv.includes('--download-only'))process.exit(0);

// Stop the application before opening the same PGlite directory with this CLI.
const running=await new Promise(resolve=>{
 const socket=net.connect({host:'127.0.0.1',port:3000});
 socket.once('connect',()=>{socket.destroy();resolve(true);});
 socket.once('error',()=>{socket.destroy();resolve(false);});
 socket.setTimeout(2000,()=>{socket.destroy();resolve(true);});
});
if(running)throw Error('Hentikan server RTICORE di port 3000 sebelum impor referensi lokal.');
const db=await PGlite.create(process.env.PGLITE_DATA_DIR||path.join(root,'.pgdata'));
const cols=['region_code','postal_code','province_code','province_name','regency_code','regency_name','district_code','district_name','village_name','village_kind','source_version'];
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
try{
 await db.exec('BEGIN');
 await db.exec("DELETE FROM rticore_postal_areas WHERE source_version='LOCAL-PG-READY'");
 for(let i=0;i<rows.length;i+=500){
  const values=rows.slice(i,i+500).map(r=>'('+r.map(quote).join(',')+')').join(',');
  await db.exec(`INSERT INTO rticore_postal_areas(${cols.join(',')}) VALUES ${values} ON CONFLICT(region_code) DO UPDATE SET ${cols.slice(1).map(c=>`${c}=EXCLUDED.${c}`).join(',')}`);
 }
 await db.exec(`INSERT INTO rticore_postal_lookup(postal_code,areas_json,village_count,source_version)
 SELECT postal_code,json_agg(json_build_object(${cols.slice(0,10).map(c=>`${quote(c)},${c}`).join(',')}) ORDER BY region_code)::text,count(*),${quote(version)}
 FROM rticore_postal_areas GROUP BY postal_code
 ON CONFLICT(postal_code) DO UPDATE SET areas_json=EXCLUDED.areas_json,village_count=EXCLUDED.village_count,source_version=EXCLUDED.source_version`);
 await db.exec(`INSERT INTO rticore_postal_import_state(singleton,status,source_version,row_count,province_count,postal_count)
 SELECT 1,'ready',${quote(version)},count(*),count(DISTINCT province_code),count(DISTINCT postal_code) FROM rticore_postal_areas
 ON CONFLICT(singleton) DO UPDATE SET source_version=EXCLUDED.source_version,row_count=EXCLUDED.row_count,province_count=EXCLUDED.province_count,postal_count=EXCLUDED.postal_count,verified_at=CURRENT_TIMESTAMP`);
 await db.exec('COMMIT');
 console.log('Impor lokal selesai. Kode pos 42117:',matches.map(r=>r[8]+', '+r[7]+', '+r[5]).join('; '));
}catch(error){await db.exec('ROLLBACK');throw error;}finally{await db.close();}
