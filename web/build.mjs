import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["openglass/app.jsx"],
  outdir: "openglass-dist",
  entryNames: "app",
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  logLevel: "info",
});
