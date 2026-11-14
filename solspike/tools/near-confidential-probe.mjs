// Read-only compatibility probe. Fixed public test addresses; every request is dry:true.
// No deposit address is requested, no wallet is opened, no transaction is signed or sent.
// node solspike/tools/near-confidential-probe.mjs [--key-file <600 file>] [--output <json>]
// --unauthenticated explicitly runs the same diagnostic without a partner credential.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyNearQuote } from '../../web/near-quote-signature.js';

const ENDPOINT = 'https://1click.chaindefuser.com/v0/quote';
const MODES = ['public', 'basic', 'advanced'];
const UA = 'u1ddnjsdcpm36r6aq79n3s68shjweksnmwtdltrh046s8m6xcws9ygyawalxx8n6hg6vegk0wh8zjnafxgh6'
  + 'msppjsljvyt0ynece3lvm0';
const SOL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function probeRequest(confidentiality, now) {
  return { dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: 'nep141:sol.omft.near', depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:zec.omft.near', amount: '100000000', refundTo: SOL,
    refundType: 'ORIGIN_CHAIN', recipient: UA, recipientType: 'DESTINATION_CHAIN',
    confidentiality, deadline: new Date(now + 3600_000).toISOString(), quoteWaitingTimeMs: 3000 };
}

const probeHeaders = (credential) => ({ 'content-type': 'application/json',
  accept: 'application/json', ...(credential ? { 'x-api-key': credential } : {}) });

function probeAmounts(q) {
  return ['amountIn', 'amountOut', 'minAmountOut'].every((k) =>
    typeof q?.[k] === 'string' && /^\d{1,40}$/.test(q[k]) && BigInt(q[k]) > 0n);
}

function matchingDryQuote(body, request) {
  const q = body.quote;
  return Object.keys(request).every((k) => body.quoteRequest?.[k] === request[k])
    && probeAmounts(q) && q.amountIn === request.amount
    && BigInt(q.minAmountOut) <= BigInt(q.amountOut) && !q.depositAddress;
}

function reportedProbeMode(body) {
  const mode = body?.quoteRequest?.confidentiality;
  return MODES.includes(mode) ? mode : 'unsupported';
}

async function inspectProbe(res, result, request, verify) {
  result.http = res.status;
  if (![200, 201].includes(res.status)) {
    result.error = [401, 403].includes(res.status) ? 'authentication-or-access-refused'
      : 'quote-refused';
    return result;
  }
  const body = await res.json();
  result.signatureValid = await verify(body);
  result.echoedConfidentiality = reportedProbeMode(body);
  result.verified = result.signatureValid && matchingDryQuote(body, request);
  if (!result.verified) result.error = 'quote-or-mode-not-verified';
  // Retain only bounded, expected public test data. Never serialize headers or the credential.
  if (probeAmounts(body.quote)) Object.assign(result, { amountOut: body.quote.amountOut,
    minAmountOut: body.quote.minAmountOut });
  return result;
}

export async function probeNearMode({ confidentiality, credential = '', fetchFn = fetch,
  now = Date.now(), verify = verifyNearQuote }) {
  if (!MODES.includes(confidentiality)) throw new Error('Unsupported diagnostic mode');
  const request = probeRequest(confidentiality, now);
  const result = { at: new Date(now).toISOString(), authenticated: !!credential,
    confidentiality, request, verified: false };
  try {
    const res = await fetchFn(ENDPOINT, { method: 'POST', headers: probeHeaders(credential),
      redirect: 'error',
      signal: AbortSignal.timeout(25_000), body: JSON.stringify(request) });
    return await inspectProbe(res, result, request, verify);
  } catch {
    result.error = 'request-failed';
  }
  return result;
}

async function credentialOf(path) {
  if (!path && process.env.NEAR_API_KEY) return credentialText(process.env.NEAR_API_KEY);
  const file = path || join(homedir(), '.config', 'zigs', 'near-api-key');
  if (!await privateCredentialFile(file)) {
    throw new Error('Configure the NEAR partner key in ~/.config/zigs/near-api-key with mode 600, '
      + 'set NEAR_API_KEY, or use --key-file with a private file. '
      + 'Do not put the key in arguments.');
  }
  return credentialText(await readFile(file, 'utf8'));
}

function credentialText(text) {
  const key = text.trim();
  if (!key || /\s/.test(key)) {
    throw new Error('The credential file must hold only the partner JWT.');
  }
  return key;
}

async function privateCredentialFile(file) {
  const info = await stat(file).catch(() => null);
  return info?.isFile() && (info.mode & 0o777) === 0o600 && info.size > 0;
}

function probeOptions() {
  const { values } = parseArgs({ strict: true, options: {
    'key-file': { type: 'string' }, output: { type: 'string' },
    mode: { type: 'string', default: 'all' },
    unauthenticated: { type: 'boolean', default: false }, help: { type: 'boolean' } } });
  if (values.unauthenticated && values['key-file']) {
    throw new Error('Choose one credential source.');
  }
  if (values.mode !== 'all' && !MODES.includes(values.mode)) throw new Error('Unknown probe mode.');
  return values;
}

async function main() {
  const values = probeOptions();
  if (values.help) {
    console.log('Unfunded NEAR SOL-to-shielded-ZEC quote probe. Uses public test addresses only.\n'
      + 'Options: --key-file <600 file> --output <json> --unauthenticated\n'
      + '         --mode public|basic|advanced|all\n'
      + 'Every request is dry:true. This cannot prove settlement, spendability or unlinkability.');
    return;
  }
  const credential = values.unauthenticated ? '' : await credentialOf(values['key-file']);
  const modes = values.mode === 'all' ? MODES : [values.mode];
  const results = await Promise.all(modes.map((confidentiality) =>
    probeNearMode({ confidentiality, credential })));
  const output = values.output || fileURLToPath(new URL('../logs/near-confidential-'
    + new Date().toISOString().replace(/[:.]/g, '-') + '.json', import.meta.url));
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify({ scope: 'Unfunded dry quotes with public test addresses. '
    + 'No wallet keys, deposit addresses or funds. Mode echoes are provider assertions, not signed '
    + 'privacy guarantees.', results }, null, 2) + '\n', { mode: 0o600 });
  for (const r of results) console.log(JSON.stringify({ mode: r.confidentiality,
    authenticated: r.authenticated, http: r.http, signatureValid: r.signatureValid,
    verified: r.verified, error: r.error }));
  console.log('Saved diagnostic: ' + resolve(output));
  if (!results.every((r) => r.verified)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 2; });
}
