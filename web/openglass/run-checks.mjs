// Portable entry points for fixture presentation checks; a failed child always fails the gate.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const mode = process.argv[2] || "full";
if (!["smoke", "full"].includes(mode)) throw new Error("Choose smoke or full");
const root = fileURLToPath(new URL("../../", import.meta.url));
const scripts = ["welcome-check.mjs", "local-devices-check.mjs", "security-text-check.mjs",
  "interaction-check.mjs"];
if (mode === "full") scripts.push("flow-audit.mjs");
for (const script of scripts) {
  const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    cwd: root, stdio: "inherit", env: { ...process.env,
      ZIGS_BROWSER_SMOKE: mode === "smoke" ? "1" : "0" },
  });
  const code = await new Promise((done, reject) => {
    child.once("error", reject); child.once("exit", (code) => done(code ?? 1));
  });
  if (code) { process.exitCode = code; break; }
}
