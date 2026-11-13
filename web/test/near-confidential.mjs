// No external requests or funds. Tests reject missing/downgraded modes at the server, browser,
// approval and recovery boundaries; diagnostic requests must always remain unfunded.
import assert from 'node:assert/strict';
import { nearSwap, nearSwapSolGroup, nearSwapZec, nearStatus } from '../../cf/src/near.js';
import { NearIntentsSwapProvider } from '../near-intents-swap-provider.js';
import { swapPrivacyProblem } from '../swap-preview-model.js';
import { readSwapRecord } from '../swap-records.js';
import { poolSwapMark, poolSwapProblem } from '../sol/swap.js';
import { intentHex } from '../sol/intent.js';
import { base58 } from '../sol/docs.js';
import { proposePoolSwap } from '../sol/swap-source.js';
import { probeNearMode } from '../../solspike/tools/near-confidential-probe.mjs';

const ua = 'u1ddnjsdcpm36r6aq79n3s68shjweksnmwtdltrh046s8m6xcws9ygyawalxx8n6hg6vegk0wh8zjnafxgh6'
  + 'msppjsljvyt0ynece3lvm0';
const deposit = base58('5c'.repeat(32)), refundTo = base58('6d'.repeat(32));
const t1 = 't1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs';
const t3 = 't3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd';
const now = Date.now(), deadline = new Date(now + 6 * 3600_000).toISOString();
const env = { NEAR_LIVE: '1', NEAR_API_KEY: 'synthetic-partner-credential' };
const ctx = { key: 'test', readBody: async (r) => new Uint8Array(await r.arrayBuffer()) };
const ask = { amount: '100000000', slippageBps: 100, recipient: ua, refundTo };
const request = (body) => new Request('https://test.invalid/near/swap', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const quote = { amountIn: ask.amount, amountOut: '200000', minAmountOut: '198000',
  depositAddress: deposit, deadline };
let sent, hits = 0, edit = () => {}, upstreamStatus = 201;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  hits++;
  sent = JSON.parse(init.body);
  assert.ok(['public', 'basic'].includes(sent.confidentiality));
  assert.equal(new Headers(init.headers).get('x-api-key'),
    sent.confidentiality === 'basic' ? env.NEAR_API_KEY : null);
  const body = { quoteRequest: { ...sent }, quote: { ...quote,
    depositAddress: sent.originAsset.includes('zec.') ? t1 : deposit },
  timestamp: new Date(now).toISOString(), signature: 'synthetic-not-a-provider-signature' };
  edit(body);
  return Response.json(body, { status: upstreamStatus });
};
try {
  for (const [handler, body] of [[nearSwap, ask], [nearSwapSolGroup, ask],
    [nearSwapZec, { ...ask, recipient: refundTo, refundTo: t3 }]]) {
    const before = hits;
    const noKey = await handler(request(body), { NEAR_LIVE: '1' }, ctx);
    assert.equal(noKey.status, 503);
    assert.equal((await noKey.json()).error, 'confidential-unavailable');
    assert.equal(hits, before, 'no wallet address is forwarded without a configured credential');
    const valid = await handler(request(body), env, ctx);
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).confidentiality, 'basic');
    assert.equal(sent.confidentiality, 'basic', 'legacy requests never default to public');
    for (const mode of [undefined, 'public', 'advanced', 'unknown']) {
      edit = (response) => { response.quoteRequest.confidentiality = mode; };
      const refused = await handler(request(body), env, ctx);
      assert.equal(refused.status, 503, 'different mode refused: ' + mode);
      assert.equal((await refused.json()).error, 'confidential-unavailable');
    }
    edit = () => {};
    for (const code of [401, 403]) {
      upstreamStatus = code;
      assert.equal((await handler(request(body), env, ctx)).status, 503);
    }
    upstreamStatus = 201;
    const publicRequest = { ...body, confidentiality: 'public' };
    const standard = await handler(request(publicRequest), { NEAR_LIVE: '1' }, ctx);
    assert.equal(standard.status, 200, 'explicit standard execution needs no partner key');
    assert.equal((await standard.json()).confidentiality, 'public');
    assert.equal(sent.confidentiality, 'public');
    edit = (response) => { response.quoteRequest.confidentiality = 'basic'; };
    const beforeMismatch = hits;
    assert.equal((await handler(request(publicRequest), { NEAR_LIVE: '1' }, ctx)).status, 503);
    assert.equal(hits, beforeMismatch + 1, 'no retry changes the chosen mode');
    edit = () => {};
    for (const mode of ['preview', 'advanced', null]) {
      const beforeInvalid = hits;
      const invalid = await handler(request({ ...body, confidentiality: mode }), env, ctx);
      assert.equal(invalid.status, 400);
      assert.equal(hits, beforeInvalid);
    }
  }
  globalThis.fetch = async () => Response.json({ status: 'PENDING_DEPOSIT',
    quoteResponse: { quoteRequest: { dry: false, swapType: 'EXACT_INPUT',
      slippageTolerance: 100, originAsset: 'nep141:sol.omft.near',
      destinationAsset: 'nep141:zec.omft.near',
      depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN',
      amount: ask.amount, recipient: ua, refundTo, deadline }, quote } });
  const url = new URL('https://test.invalid/near/status?depositAddress=' + deposit);
  const tracking = await nearStatus(new Request(url), env, url, ctx);
  assert.equal((await tracking.json()).swap.confidentiality, 'public',
    'old public swaps remain readable without acquiring a confidential label');
} finally { globalThis.fetch = originalFetch; }
console.log('ok  authenticated required-mode requests, provider refusals and legacy tracking');

// Financial authentication is covered by swapflow.mjs. This explicit test seam isolates policy.
const opened = { ...quote, recipient: ua, refundTo, confidentiality: 'basic' };
let returned = opened;
const provider = new NearIntentsSwapProvider(async () => Response.json(returned), async () => true);
const input = { amountAtomic: ask.amount, recipient: ua, refundTo, slippageBps: 100 };
assert.equal((await provider.openSwap(input)).confidentiality, 'basic');
for (const mode of [undefined, 'public', 'advanced', 'unknown']) {
  returned = { ...opened, confidentiality: mode };
  await assert.rejects(provider.openSwap(input), (e) => e.code === 'confidential-unavailable');
}
returned = { ...opened, confidentiality: 'public' };
assert.equal((await provider.openSwap({ ...input, confidentiality: 'public' })).confidentiality,
  'public');
returned = opened;
await assert.rejects(provider.openSwap({ ...input, confidentiality: 'public' }),
  (e) => e.code === 'routing-unavailable');
assert.equal(swapPrivacyProblem({ swap: opened }), '');
assert.equal(swapPrivacyProblem({ swap: opened,
  status: { swap: { confidentiality: 'basic' } } }), '');
assert.match(swapPrivacyProblem({ swap: opened,
  status: { swap: { confidentiality: 'public' } } }), /Do not send funds/);
assert.match(swapPrivacyProblem({ swap: opened, status: { status: 'unknown' } }),
  /Do not send funds/);
assert.match(swapPrivacyProblem({ swap: opened, statusError: 'network unavailable' }),
  /Do not send funds/);
await assert.rejects(proposePoolSwap({}, { ...opened, confidentiality: 'advanced' }),
  /Choose a supported routing mode/);
const record = { version: 1, walletId: 'test-wallet', from: 'sol', funding: 'private',
  createdAt: now, swap: opened };
assert.equal(readSwapRecord(record).swap.confidentiality, 'basic');
const old = readSwapRecord({ ...record, swap: { ...opened, confidentiality: undefined } });
assert.equal(old.swap.confidentiality, 'public');
assert.match(swapPrivacyProblem(old), /Tracking is available/);
const standardRecord = readSwapRecord({ ...record, routeChoice: 'public',
  swap: { ...opened, confidentiality: 'public' } });
assert.equal(swapPrivacyProblem(standardRecord), '', 'explicit standard receipt can be resumed');
assert.equal(standardRecord.routeChoice, 'public');
assert.equal(readSwapRecord({ ...record, swap: { ...opened, confidentiality: 'unknown' } }), null);
const expiry = Math.floor((Date.parse(deadline) - 1800_000) / 1000);
const ss = { intent: intentHex('withdraw', { recipient: '5c'.repeat(32), amount: 100000000n,
  expiry, inputs: 1, outputs: 1 }), expiry: String(expiry),
swap: poolSwapMark(deposit, deadline, 'basic') };
assert.equal(poolSwapProblem(ss), null);
for (const mark of ['near-private-sol-zec ' + deposit + ' ' + deadline,
  poolSwapMark(deposit, deadline, 'advanced')]) {
  assert.match(poolSwapProblem({ ...ss, swap: mark }), /supported routing mode/);
}
console.log('ok  browser mode policy, recovery receipts and author-signed approval mode');

const credential = 'synthetic-diagnostic-secret';
let probeEdit = () => {};
const fetchFn = async (url, init) => {
  assert.equal(url, 'https://1click.chaindefuser.com/v0/quote');
  assert.equal(init.redirect, 'error', 'credential cannot follow redirects to another host');
  assert.equal(init.headers['x-api-key'], credential);
  const body = JSON.parse(init.body);
  assert.equal(body.dry, true, 'the diagnostic can never create a deposit');
  const response = { quoteRequest: body, quote: { amountIn: body.amount,
    amountOut: '200000', minAmountOut: '198000' } };
  probeEdit(response);
  return Response.json(response, { status: 201 });
};
const probe = () => probeNearMode({ confidentiality: 'basic', credential, fetchFn,
  now, verify: async () => true });
const accepted = await probe();
assert.equal(accepted.verified, true);
assert.equal(JSON.stringify(accepted).includes(credential), false,
  'credential never enters report');
for (const change of [(r) => { r.quoteRequest.confidentiality = 'public'; },
  (r) => { r.quote.depositAddress = deposit; }, (r) => { r.quote.amountIn = '1'; }]) {
  probeEdit = change;
  assert.equal((await probe()).verified, false);
}
console.log('ok  fixed-endpoint dry-only diagnostic, downgrade checks and credential redaction');
