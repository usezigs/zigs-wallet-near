// Disposable audit relay only. Never loads repository dev.vars or Cloudflare credentials.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const freePort = async () => {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
};
const port = await freePort(), inspector = await freePort();
const temporary = mkdtempSync(resolve(tmpdir(), 'zigs-audit-worker-'));
const config = resolve(temporary, 'wrangler.json');
writeFileSync(config, JSON.stringify({ name: 'zigs-disposable-audit',
  main: resolve(root, 'cf/src/index.js'), compatibility_date: '2026-09-15',
  observability: { enabled: false },
  vars: { SOL: '0', SOL_MAINNET: '0', SOL_POOL_MAINNET: '0', NEAR_LIVE: '0', DEV_NO_AUTH: '1' },
  assets: { directory: resolve(root, 'web'), binding: 'ASSETS', run_worker_first: true },
  durable_objects: { bindings: [{ name: 'STORE', class_name: 'Store' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['Store'] }],
}));
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
env.WRANGLER_SEND_METRICS = 'false';
const worker = spawn(process.execPath, [resolve(root, 'cf/node_modules/wrangler/bin/wrangler.js'),
  'dev', '--config', config, '--local', '--ip', '127.0.0.1', '--port', String(port),
  '--inspector-port', String(inspector), '--persist-to', resolve(temporary, 'state'), '--log-level', 'error'],
{ cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] });
worker.stdout.resume(); worker.stderr.resume();
let exited = false, failed = false, stopping = false;
worker.on('exit', () => { exited = true; });
worker.on('error', () => { failed = true; });
async function stop() {
  if (stopping) return; stopping = true;
  worker.kill('SIGTERM');
  for (let i = 0; i < 25 && !exited; i++) await pause(100);
  if (!exited) worker.kill('SIGKILL');
  rmSync(temporary, { recursive: true, force: true });
}
process.on('SIGINT', async () => { await stop(); process.exit(0); });
process.on('SIGTERM', async () => { await stop(); process.exit(0); });
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (failed || exited) throw new Error('Disposable audit Worker failed to start');
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(1000) });
      if (r.ok) { ready = true; break; }
    } catch { /* local startup */ }
    await pause(250);
  }
  if (!ready) throw new Error('Disposable audit Worker startup timed out');
  console.log(JSON.stringify({ origin: 'http://localhost:' + port,
    scope: 'Fresh temporary config/state; no dev.vars; chain/provider flags disabled. Stop with Ctrl+C.' }));
  while (!exited) await pause(1000);
} finally { await stop(); }
