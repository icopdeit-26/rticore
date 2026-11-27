// Offline renderer. Creates candidate configuration only; never installs or starts services.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const dir=fileURLToPath(new URL('../deployment/hostinger/',import.meta.url));
function host(value){
 if(typeof value!=='string'||value.length>253||!value.includes('.')||!value.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))||value.endsWith('.invalid')||value.endsWith('.cloudflareaccess.com'))throw Error('Invalid DNS hostname');
 return value;
}
export function renderNativeIAM({appHost,ssoHost,emailDomains,mode,output}){
 appHost=host(appHost);ssoHost=host(ssoHost);
 if(appHost===ssoHost||!['staging','production'].includes(mode))throw Error('Distinct app/SSO host and explicit mode required');
 const productionHost=['rticore.store','www.rticore.store'].includes(appHost);
 if(productionHost!==(mode==='production'))throw Error('Target does not match release mode');
 if(!Array.isArray(emailDomains)||!emailDomains.length)throw Error('Approved email domains required');
 const domains=[...new Set(emailDomains.map(host))];
 if(!output||!path.isAbsolute(output))throw Error('Absolute new output directory required');
 const names=['app.env.example','keycloak.env.example','keycloak-realm.template.json','keycloak.service.example','oauth2-proxy.cfg.example','oauth2-proxy.env.example','oauth2-proxy.service.example','nginx-rticore.conf.example','nginx-sso.conf.example','rticore.service.example'];
 const rendered=names.map(name=>{
 let value=fs.readFileSync(path.join(dir,name),'utf8').replaceAll('rticore.example.invalid',appHost).replaceAll('sso.example.invalid',ssoHost);
 if(name==='oauth2-proxy.cfg.example')value=value.replace('email_domains = ["example.invalid"]','email_domains = '+JSON.stringify(domains));
 return [name,value];
 });
 // No overwrite and no writes until validation and all source reads succeed.
 fs.mkdirSync(output,{mode:0o700});
 for(const [name,value] of rendered)fs.writeFileSync(path.join(output,name),value,{mode:0o600,flag:'wx'});
 return names;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
 const [mode,appHost,ssoHost,domains,output]=process.argv.slice(2);
 const files=renderNativeIAM({mode,appHost,ssoHost,emailDomains:domains?.split(','),output});
 console.log('Rendered '+files.length+' candidate files; secrets, database host, TLS and operator review still required. No services changed.');
 }catch(e){console.error('Native IAM rendering refused: '+e.message);process.exitCode=1;}
}
