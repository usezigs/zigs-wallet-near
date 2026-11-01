// R0b of the swap plan: one live swap from SOL to ZEC through the Worker of staging.zigs.app
// (PRIVACY.md, "Live swap from SOL to ZEC"). The script asks /near/swap for a live quote, checks
// that the answer repeats the amount and the two addresses, and prints the deposit address, the
// amount and the deadline. Then it reads /near/status every 10 s until the state is final, or
// until 2 hours after the deadline. It sends no SOL and signs nothing: the owner pays the exact
// amount from the wallet of the refund address, outside Zigs. --quote-only stops after the quote
// (R0a: a live quote with no deposit). A deposit address that nobody pays ends at its deadline.
// Each run writes solspike/logs/near-r0b-<time>.json: the ask, the answer and each new state.
// The password of the staging gate comes from ~/.config/zigs/staging-password (mode 600). It goes
// to staging.zigs.app only and is never printed or logged.
// Usage: node solspike/tools/near-r0b.mjs --ua <u1...> --refund <SOL address> --lamports <N>
//          [--quote-only]
// Exit codes: 0 SUCCESS (or a sound quote with --quote-only), 1 refused or not SUCCESS, 2 bad use.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ORIGIN = "https://staging.zigs.app";
const PASSWORD_FILE = join(homedir(), ".config", "zigs", "staging-password");
const LOGS = join(dirname(fileURLToPath(import.meta.url)), "..", "logs");
const SLIPPAGE_BPS = 100; // the middle choice of the page: a refund wastes the run
const READ_MS = 10_000;
const AFTER_DEADLINE_MS = 7_200_000;
const CALL_MS = 15_000;
const FINAL = ["SUCCESS", "REFUNDED", "FAILED"];
const UA = /^u1[02-9ac-hj-np-z]{60,400}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LAMPORTS = /^[1-9]\d{0,15}$/;

class Usage extends Error {}

function options(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: {
      ua: { type: "string" }, refund: { type: "string" }, lamports: { type: "string" },
      "quote-only": { type: "boolean", default: false } } }));
  } catch (err) {
    throw new Usage(err.message);
  }
  if (!UA.test(values.ua ?? "")) throw new Usage("--ua must be a mainnet unified address (u1...)");
  if (!SOL_ADDRESS.test(values.refund ?? "")) throw new Usage("--refund must be a Solana address");
  if (!LAMPORTS.test(values.lamports ?? "")) throw new Usage("--lamports must be a whole number");
  return { ua: values.ua, refund: values.refund, lamports: values.lamports,
    quoteOnly: values["quote-only"] };
}

function authHeader() {
  if ((statSync(PASSWORD_FILE).mode & 0o777) !== 0o600) {
    throw new Usage(`${PASSWORD_FILE} must have mode 600`);
  }
  const password = readFileSync(PASSWORD_FILE, "utf8").replace(/\n/g, "");
  if (!password) throw new Usage(`${PASSWORD_FILE} is empty`);
  return `Basic ${Buffer.from(`demo:${password}`).toString("base64")}`;
}

// A redirect could take the password to another host, so the call refuses it.
async function call(auth, path, body) {
  const headers = { authorization: auth, accept: "application/json" };
  const init = { headers, redirect: "error", signal: AbortSignal.timeout(CALL_MS) };
  if (body) {
    Object.assign(init, { method: "POST", body: JSON.stringify(body) });
    headers["content-type"] = "application/json";
  }
  const res = await fetch(ORIGIN + path, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const units = (atomic, decimals) => {
  const text = String(atomic).padStart(decimals + 1, "0");
  return `${text.slice(0, -decimals)}.${text.slice(-decimals)}`;
};
const writeLog = (file, record) => writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

// The reasons that the answer is not the swap that was asked for. The owner pays a sound one only.
function quoteProblems(answer, ask, now = Date.now()) {
  const checks = [
    [answer?.amountIn === ask.amount, "amountIn is not the asked amount"],
    [answer?.recipient === ask.recipient, "the recipient is not the asked address"],
    [answer?.refundTo === ask.refundTo, "the refund address is not the asked one"],
    [SOL_ADDRESS.test(answer?.depositAddress ?? ""), "the deposit address is not a Solana address"],
    [Date.parse(answer?.deadline) > now, "the deadline is not in the future"],
  ];
  return checks.filter(([ok]) => !ok).map(([, why]) => why);
}

async function quote(auth, opts, record, file) {
  const ask = { amount: opts.lamports, recipient: opts.ua, refundTo: opts.refund,
    slippageBps: SLIPPAGE_BPS };
  record.ask = ask;
  const { status, body } = await call(auth, "/near/swap", ask);
  record.quote = { at: new Date().toISOString(), status, body };
  writeLog(file, record);
  if (status !== 200) {
    const min = body?.error === "too-low" ? ` (the minimum is ${body.minAmount} lamports)` : "";
    throw new Error(`/near/swap answered ${status} ${body?.error ?? ""}${min}`);
  }
  const problems = quoteProblems(body, ask);
  if (problems.length) throw new Error(`do not pay: ${problems.join("; ")}`);
  return body;
}

function printQuote(swap) {
  console.log(`Pay exactly ${units(swap.amountIn, 9)} SOL (${swap.amountIn} lamports)`);
  console.log(`To:     ${swap.depositAddress}`);
  console.log(`From:   ${swap.refundTo} (the refund address)`);
  console.log(`Before: ${swap.deadline}`);
  console.log(`Payout: about ${units(swap.amountOut, 8)} ZEC, at least`
    + ` ${units(swap.minAmountOut, 8)} ZEC, to ${swap.recipient}`);
  console.log(`Quote id: ${swap.correlationId ?? "none"}`);
}

async function readState(auth, depositAddress) {
  try {
    const { status, body } = await call(auth,
      `/near/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    return { status, body, state: status === 200 ? body?.status : body?.error ?? `HTTP ${status}` };
  } catch (err) {
    return { status: 0, body: null, state: `no answer (${err.message})` };
  }
}

async function follow(auth, swap, record, file) {
  const stop = Date.parse(swap.deadline) + AFTER_DEADLINE_MS;
  record.states = [];
  let last = "";
  while (Date.now() < stop) {
    const { status, body, state } = await readState(auth, swap.depositAddress);
    if (state !== last) {
      record.states.push({ at: new Date().toISOString(), status, body });
      writeLog(file, record);
      console.log(`${new Date().toISOString()} ${state}`);
      last = state;
    }
    if (FINAL.includes(state)) return state;
    await sleep(READ_MS);
  }
  return last;
}

async function main() {
  const opts = options(process.argv.slice(2));
  const auth = authHeader();
  mkdirSync(LOGS, { recursive: true });
  const file = join(LOGS, `near-r0b-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const record = { origin: ORIGIN, startedAt: new Date().toISOString(),
    quoteOnly: opts.quoteOnly };
  const swap = await quote(auth, opts, record, file);
  printQuote(swap);
  console.log(`Log: ${file}`);
  if (opts.quoteOnly) return 0;
  console.log("Reading the state every 10 s. Ctrl-C stops the reads; the swap goes on.");
  const end = await follow(auth, swap, record, file);
  const last = record.states.at(-1)?.body ?? {};
  console.log(`End: ${end}. Solana: ${last.originTxs ?? "none"}.`
    + ` Zcash: ${last.destinationTxs ?? "none"}.`);
  return end === "SUCCESS" ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(`near-r0b: ${err.message}`);
  process.exitCode = err instanceof Usage ? 2 : 1;
});
