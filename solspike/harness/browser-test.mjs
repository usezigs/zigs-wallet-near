// Shared browser selection for local runs and Linux CI. Never imports production page modules.
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const engines = createRequire(new URL("../../web/package.json", import.meta.url))("playwright");
export const browserName = process.env.ZIGS_BROWSER || "chromium";
if (!["chromium", "webkit"].includes(browserName)) throw new Error("Unknown ZIGS_BROWSER");

export function launchTestBrowser() {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = browserName === "webkit" ? process.env.WEBKIT_EXECUTABLE
    : process.env.CHROME_EXECUTABLE || (!process.env.CI && existsSync(chrome) ? chrome : undefined);
  return engines[browserName].launch({ headless: true, executablePath });
}

export function browserOutput(name, override) {
  const output = resolve(override || process.env.ZIGS_BROWSER_OUTPUT
    && resolve(process.env.ZIGS_BROWSER_OUTPUT, name) || resolve(tmpdir(), "zigs-browser", name));
  mkdirSync(output, { recursive: true });
  return output;
}
