// Local presentation preview only. It has no wallet server or chain endpoints.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";

const root=fileURLToPath(new URL("../../web/",import.meta.url));
const mime={ ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json", ".wasm":"application/wasm",
  ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml",
  ".woff2":"font/woff2", ".ico":"image/x-icon" };
const server=createServer(async(req,res)=>{
  try {
    if (!["GET","HEAD"].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
    const target=resolve(root,"."+(path==="/"?"/index.html":path));
    if (!target.startsWith(root.endsWith(sep)?root:root+sep)) {
      res.writeHead(403); res.end(); return;
    }
    let data=await readFile(target);
    if (target.endsWith("/index.html")) data=Buffer.from(data.toString()
      .replace("<title>",'<script src="/shim.js"></script><title>'));
    res.writeHead(200,{ "Content-Type":mime[extname(target)]||"application/octet-stream",
      "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
    res.end(req.method==="HEAD"?undefined:data);
  } catch { res.writeHead(404); res.end("Not available in this local presentation preview."); }
});
server.listen(Number(process.env.ZIGS_ZEBRA_PORT||8942),"127.0.0.1",()=>{
  console.log(`Local: http://127.0.0.1:${server.address().port}/`);
});
