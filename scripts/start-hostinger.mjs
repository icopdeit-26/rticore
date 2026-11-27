import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {validateHostingerConfig} from '../src/lib/hostinger-config.ts';
const require=createRequire(import.meta.url);
try {
 validateHostingerConfig(process.env);
 const port=process.env.PORT || '3000';
 if(!/^\d{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)throw Error('Invalid port');
 const host=process.env.HOSTNAME_BIND||'127.0.0.1';
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-H',host,'-p',port],{stdio:'inherit',env:process.env});
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));
 child.once('error',()=>{console.error('Native application startup failed');process.exitCode=1;});
 child.once('exit',(code,signal)=>{process.exitCode=code??(signal==='SIGTERM'?0:1);});
}catch{console.error('Native startup refused: verify Hostinger IAM, PostgreSQL TLS and bind configuration.');process.exitCode=1;}
