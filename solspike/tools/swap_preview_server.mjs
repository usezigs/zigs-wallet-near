// Loopback-only dev harness. Serves the real application modules without starting a wallet.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nearQuote } from '../../cf/src/near.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = resolve(root, 'web');
let before = null;
try { before = execFileSync('git', ['show', '27a81b1:web/app-shell.js'], {
  cwd: root, stdio: ['ignore', 'pipe', 'ignore'],
}); } catch { /* A shallow checkout may have no historical comparison. */ }
const html = readFileSync(resolve(web, 'index.html'), 'utf8')
  .replace(/<link rel="(?:modulepreload|preload)" href="\/pkg[^>]*>/g, '')
  .replace(/<script type="module" src="\/(?:app|network-privacy-demo-entry)\.js"><\/script>/g,
    '<script type="module" src="/__swap_harness__.mjs"></script>');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/near/quote') { await replyQuote(req, res); return; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', (
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src "
      + "'self'; img-src 'self' data:; connect-src 'self'"
    ));
    replyGet(path, res);
  } catch { res.writeHead(404); res.end('Not found'); }
});

function replyGet(path, res) {
  if (path === '/__swap_preview__') { res.setHeader('Content-Type', 'text/html'); res.end(
    html); return; }
  if (path === '/openglass-dist/app.js') {
    res.setHeader('Content-Type', 'text/javascript');
    // Boot the real shell and bridge, substituting only the wallet entry for this fixture.
    res.end(readFileSync(resolve(web, 'openglass-dist/app.js'), 'utf8')
      .replaceAll('/network-privacy-demo-entry.js', '/__swap_harness__.mjs')); return;
  }
  if (path === '/__swap_before__.js') { replyBefore(res); return; }
  if (path === '/__swap_harness__.mjs') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync(resolve(root, 'solspike/harness/swap-preview.mjs'))); return;
  }
  const file = resolve(web, '.' + decodeURIComponent(path));
  if (!file.startsWith(web + '/')) { res.writeHead(403); res.end(); return; }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
}

// Only dry quotes are exposed. Live quote creation, status reads and payments have no route.
async function replyQuote(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); res.end('Use POST'); return; }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512) { res.writeHead(400); res.end('Quote request too large'); return; }
    chunks.push(chunk);
  }
  const request = new Request('http://localhost/near/quote', { method: 'POST',
    body: Buffer.concat(chunks) });
  const response = await nearQuote(request, {}, { key: 'loopback-preview',
    readBody: async (r) => new Uint8Array(await r.arrayBuffer()) });
  res.writeHead(response.status, { 'content-type': response.headers.get('content-type'),
    'cache-control': 'no-store' });
  res.end(Buffer.from(await response.arrayBuffer()));
}
function replyBefore(res) {
  res.setHeader('Content-Type', 'text/javascript');
  res.writeHead(before ? 200 : 404);
  res.end(before || 'Historical comparison unavailable');
}
server.listen(Number(process.env.ZIGS_SWAP_PORT || 8856), '127.0.0.1', () => {
  console.log('Swap preview: http://127.0.0.1:' + server.address().port + '/__swap_preview__');
});
