// Bounded, whitelisted recovery data. Stored receipts cannot claim wallet confirmation.
import { nearConfidentiality } from './near-swap-policy.js';
const INTEGER = /^\d{1,40}$/;
const ADDRESS = /^[0-9A-Za-z]{20,405}$/;
const STATES = new Set(["unknown", "other", "PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]);
const shortText = (value, max = 512) => typeof value === "string" && value.length <= max;
const atomicText = (value) => typeof value === "string" && INTEGER.test(value);

function readSwapData(w) {
  if (!validSwapAddresses(w)) return null;
  const amounts = ["amountIn", "amountOut", "minAmountOut"];
  if (!amounts.every((k) => atomicText(w[k]) && BigInt(w[k]) > 0n)) return null;
  if (BigInt(w.minAmountOut) > BigInt(w.amountOut)
    || !Number.isFinite(Date.parse(w.deadline))) return null;
  const keys = ["depositAddress", "recipient", "refundTo", ...amounts, "deadline"];
  const swap = Object.fromEntries(keys.map((k) => [k, w[k]]));
  swap.confidentiality = nearConfidentiality(w.confidentiality);
  for (const k of ["correlationId", "signature", "timeWhenInactive"]) {
    if (shortText(w[k], 2048)) swap[k] = w[k];
  }
  copySignedQuote(w, swap);
  return swap;
}

function validSwapAddresses(w) {
  return w && nearConfidentiality(w.confidentiality) !== null
    && ["depositAddress", "recipient", "refundTo"].every((k) => ADDRESS.test(w[k] || ""));
}

function copySignedQuote(source, target) {
  if (source.signedQuote && JSON.stringify(source.signedQuote).length <= 24576) {
    target.signedQuote = source.signedQuote;
  }
}

function readSavedStatus(value) {
  if (!value || !STATES.has(value.status)) return null;
  const status = { status: value.status };
  for (const k of ["originTxs", "destinationTxs"]) {
    const hashes = Array.isArray(value[k]) ? value[k] : [];
    status[k] = hashes.filter((h) => typeof h === "string"
      && /^[0-9A-Za-z]{16,128}$/.test(h)).slice(0, 8);
  }
  for (const k of ["amountOut", "refundedAmount"]) {
    if (atomicText(value[k])) status[k] = value[k];
  }
  if (shortText(value.refundReason, 160)) status.refundReason = value.refundReason;
  return status;
}

function readSavedProposal(value) {
  if (!value || typeof value !== "object") return null;
  const proposal = { attempted: value.attempted === true };
  if (shortText(value.id, 64)) proposal.id = value.id;
  if (shortText(value.error, 500)) proposal.error = value.error;
  return proposal;
}

function validRecord(value) {
  if (!value || typeof value !== "object") return false;
  return [value.version === 1, shortText(value.walletId, 160), !!value.walletId,
    ["sol", "zec"].includes(value.from), ["private", "plain", "outside"].includes(value.funding),
    Number.isFinite(value.createdAt)].every(Boolean);
}

export function readSwapRecord(value) {
  if (!validRecord(value)) return null;
  const swap = readSwapData(value.swap);
  if (!swap) return null;
  return { version: 1, walletId: value.walletId,
    routeChoice: ['public', 'basic'].includes(value.routeChoice) ? value.routeChoice : undefined,
    wallet: shortText(value.wallet, 200) ? value.wallet : "Wallet",
    from: value.from, funding: value.funding, group: value.group === true, swap,
    status: readSavedStatus(value.status), proposal: readSavedProposal(value.proposal),
    createdAt: value.createdAt, hidden: value.hidden === true };
}

export function swapRecordOf(live) {
  return readSwapRecord({ version: 1, walletId: live.walletId, wallet: live.wallet,
    routeChoice: live.routeChoice,
    from: live.from, group: live.group, funding: live.funding, swap: live.swap,
    status: live.status, proposal: live.proposal, createdAt: live.createdAt, hidden: live.hidden });
}
