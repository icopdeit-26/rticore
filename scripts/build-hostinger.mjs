import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const env = {
  ...process.env,
  TOKIO_WORKER_THREADS: '1',
  RAYON_NUM_THREADS: '1',
  UV_THREADPOOL_SIZE: '2',
};
const result = spawnSync(process.execPath, [
  require.resolve('next/dist/bin/next'), 'build', '--webpack', ...process.argv.slice(2),
], { env, stdio: 'inherit' });
if (result.error) console.error(result.error);
if (result.signal) console.error('Next.js build terminated by', result.signal);
process.exitCode = result.status ?? 1;
