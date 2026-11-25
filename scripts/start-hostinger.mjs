import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateHostingerConfig } from '../src/lib/hostinger-config.ts';

validateHostingerConfig(process.env);
await import('./hostinger-preflight.mjs');
if (process.exitCode) process.exit(process.exitCode);
const next = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
const port = process.env.PORT || '3000';
if (!/^\d+$/.test(port) || Number(port)<1 || Number(port)>65535) throw new Error('Invalid PORT');
const host = process.env.HOSTNAME_BIND || '127.0.0.1';
const child = spawn(process.execPath, [next, 'start', '-H', host, '-p', port], { stdio: 'inherit', env: process.env });
for (const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>child.kill(sig));
child.on('error',()=>{ console.error('Next.js could not start'); process.exitCode=1; });
child.on('exit',(code,signal)=>{ process.exitCode=code ?? (signal ? 1 : 0); });
