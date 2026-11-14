// Starts an ephemeral, local-only Worker. No production config, secrets or saved wallets used.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { setTimeout as pause } from "node:timers/promises";
import { browserOutput } from "../../solspike/harness/browser-test.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = browserOutput("ceremonies");
const temporary = mkdtempSync(resolve(tmpdir(), "zigs-browser-worker-"));
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;
  await new Promise((done) => server.close(done)); return port;
}
const port = await freePort(), inspector = await freePort();
const config = resolve(temporary, "wrangler.json");
writeFileSync(config, JSON.stringify({ name: "zigs-browser-ceremony",
  main: resolve(root, "cf/src/index.js"), compatibility_date: "2026-09-15",
  observability: { enabled: false },
  vars: { SOL: "0", SOL_MAINNET: "0", SOL_POOL_MAINNET: "0", NEAR_LIVE: "0", DEV_NO_AUTH: "1" },
  assets: { directory: resolve(root, "web"), binding: "ASSETS", run_worker_first: true },
  durable_objects: { bindings: [{ name: "STORE", class_name: "Store" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["Store"] }],
}, null, 2));
const worker = spawn(process.execPath, [resolve(root, "cf/node_modules/wrangler/bin/wrangler.js"),
  "dev", "--config", config, "--local", "--ip", "127.0.0.1", "--port", String(port),
  "--inspector-port", String(inspector), "--persist-to", resolve(temporary, "state"),
  "--log-level", "error"], { cwd: temporary, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
let workerError = null, exited = false;
worker.on("error", (e) => { workerError = e; }); worker.on("exit", () => { exited = true; });
// Drain the pipes without copying connection URLs or environment details into audit artifacts.
worker.stdout.resume(); worker.stderr.resume();
async function ready() {
  for (let i = 0; i < 120; i++) {
    if (workerError || exited) throw workerError || new Error("Local Worker stopped before ready");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* wait for local startup */ }
    await pause(250);
  }
  throw new Error("The isolated local Worker did not become ready");
}
async function run(script) {
  const child = spawn(process.execPath, [resolve(root, script)], {
    cwd: root, stdio: "inherit", env: { ...process.env, ZIGS_BROWSER: "chromium",
      ZIGS_SINGLE_BROWSER_ORIGIN: `http://localhost:${port}`,
      ZIGS_CEREMONY_ORIGIN: `http://localhost:${port}`,
      ZIGS_OPTIONAL_ORIGIN: `http://localhost:${port}`,
      ZIGS_UI_OPTIONAL_PASSKEY: "1", ZIGS_UI_PHASE: "after" },
  });
  return new Promise((done, reject) => {
    child.once("error", reject); child.once("exit", (code) => done(code ?? 1));
  });
}
try {
  await ready();
  for (const script of ["web/openglass/single-browser-check.mjs", "web/openglass/recovery-check.mjs",
    "web/openglass/multidevice-check.mjs", "solspike/tools/optional_passkey_browser.mjs"]) {
    const code = await run(script);
    if (code) { process.exitCode = code; break; }
  }
} finally {
  worker.kill("SIGTERM");
  if (!exited) await Promise.race([new Promise((done) => worker.once("exit", done)), pause(3000)]);
  if (!exited) { worker.kill("SIGKILL"); await pause(250); }
  rmSync(temporary, { recursive: true, force: true });
  writeFileSync(resolve(output, "scope.json"), JSON.stringify({
    scope: "Fresh local Worker state, disposable browser stores, chain/provider routes blocked.",
    mainnetPaymentsSubmitted: 0, artifacts: "Masked PNG and assertion JSON only; no backups or profiles.",
  }, null, 2));
}
