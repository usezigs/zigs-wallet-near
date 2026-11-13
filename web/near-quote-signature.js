// 1Click's published signing format: stable JSON of selected request/quote fields + timestamp,
// SHA-256, then Ed25519 over the Base58 digest text. Key checked against the official SDK source
// on 2026-11-13: defuse-protocol/one-click-sdk-typescript, src/quote-signature.ts.
import { nearConfidentiality } from './near-swap-policy.js';
const MANAGER_KEY = 'reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const REQUEST = ['dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType',
  'destinationAsset', 'amount', 'refundTo', 'refundType', 'recipient', 'recipientType', 'deadline'];
const REQUEST_OPTIONAL = ['quoteWaitingTimeMs', 'referral', 'virtualChainRecipient',
  'virtualChainRefundRecipient', 'customRecipientMsg'];
const QUOTE = ['amountIn', 'amountInFormatted', 'amountInUsd', 'minAmountIn', 'amountOut',
  'amountOutFormatted', 'amountOutUsd', 'minAmountOut'];
const LIVE = ['depositAddress', 'depositMemo', 'deadline', 'timeWhenInactive', 'timeEstimate',
  'refundFee', 'withdrawFee'];

export function nearQuoteEnvelope(raw) {
  if (!raw || !raw.quoteRequest || !raw.quote) return undefined;
  const out = { quoteRequest: raw.quoteRequest, quote: raw.quote,
    timestamp: raw.timestamp, signature: raw.signature, correlationId: raw.correlationId };
  return JSON.stringify(out).length <= 24576 ? out : undefined;
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .filter((k) => value[k] !== undefined).map((k) =>
       JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

function selected(object, keys, truthy = false) {
  return Object.fromEntries(keys.filter((k) => truthy ? !!object[k] : object[k] !== undefined)
    .map((k) => [k, object[k]]));
}

export function nearSignedPayload(envelope) {
  const request = envelope.quoteRequest, quote = envelope.quote;
  return stable({ ...selected(request, REQUEST), ...selected(request, REQUEST_OPTIONAL, true),
    ...selected(quote, QUOTE), ...(!request.dry ? selected(quote, LIVE, true) : {}),
    timestamp: envelope.timestamp });
}

export function nearBase58(bytes) {
  let value = 0n, out = '';
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  while (value) { out = ALPHABET[Number(value % 58n)] + out; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out; }
  return out;
}

function decoded(text, size) {
  const raw = text.replace(/^ed25519:/, '');
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(raw) || raw.length > 100) throw new Error('Invalid Base58');
  let value = 0n;
  for (const ch of raw) value = value * 58n + BigInt(ALPHABET.indexOf(ch));
  const out = new Uint8Array(size);
  for (let at = size - 1; at >= 0; at--) { out[at] = Number(value % 256n); value /= 256n; }
  if (value || nearBase58(out) !== raw) throw new Error('Invalid key or signature length');
  return out;
}

/** The optional public key is only a test seam. Production pins the provider's manager key. */
export async function verifyNearQuote(envelope, publicKey = MANAGER_KEY) {
  try {
    if (!nearQuoteEnvelope(envelope) || typeof envelope.timestamp !== 'string') return false;
    const hash = await crypto.subtle.digest('SHA-256',
       new TextEncoder().encode(nearSignedPayload(envelope)));
    const key = await crypto.subtle.importKey('raw', decoded(publicKey, 32), 'Ed25519',
       false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, decoded(envelope.signature, 64),
      new TextEncoder().encode(nearBase58(new Uint8Array(hash))));
  } catch { return false; }
}

const NONE = ['depositMemo', 'customRecipientMsg', 'virtualChainRecipient',
   'virtualChainRefundRecipient'];
const noExtras = (object) => NONE.every((key) => object[key] == null);
function supportedForm(envelope) {
  const r = envelope.quoteRequest;
  return [r.dry === false, r.swapType === 'EXACT_INPUT', [50, 100,
     200].includes(r.slippageTolerance),
    r.depositType === 'ORIGIN_CHAIN', r.refundType === 'ORIGIN_CHAIN',
    r.recipientType === 'DESTINATION_CHAIN', nearConfidentiality(r.confidentiality) !== null,
    noExtras(r), noExtras(envelope.quote)].every(Boolean);
}

/** Bind the authenticated payload to the exact, simplified fields consumed by the page. */
export async function authenticateNearSwap(body, expected) {
  const envelope = body.signedQuote;
  if (!await verifyNearQuote(envelope) || !supportedForm(envelope)) return false;
  return signedSwapMatches(envelope, expected);
}

export function signedSwapMatches(envelope, expected) {
  const r = envelope.quoteRequest, q = envelope.quote;
  const keys = ['recipient', 'refundTo'];
  const amounts = ['amountIn', 'amountOut', 'minAmountOut'];
  return [keys.every((k) => r[k] === expected[k]),
    amounts.every((k) => expected[k] === undefined || q[k] === expected[k]),
    r.amount === expected.amountIn, q.depositAddress === expected.depositAddress,
    Date.parse(q.deadline || r.deadline) === Date.parse(expected.deadline),
    r.originAsset === expected.originAsset, r.destinationAsset === expected.destinationAsset,
    // Consistency check only: confidentiality is NOT in the provider's signed payload.
    // This assertion relies on the authenticated provider connection through the Zigs proxy.
    expected.confidentiality === undefined
      || nearConfidentiality(r.confidentiality) === expected.confidentiality,
    expected.slippageBps === undefined
      || r.slippageTolerance === expected.slippageBps].every(Boolean);
}
