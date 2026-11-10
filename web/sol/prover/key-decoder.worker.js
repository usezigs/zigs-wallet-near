/// <reference lib="webworker" />
/**
 * Decompresses runs of a key file's points for the prover worker when the
 * page has no thread pool (`key-decoders.ts`), on the runtime without shared
 * memory.
 */
import { importSingleRuntime } from "./runtime.js";
const runtime = importSingleRuntime().then(async (module) => {
    await module.default();
    return module;
});
self.addEventListener("message", (event) => {
    const { id, points, g2 } = event.data;
    runtime
        .then((module) => module.kernel_points(new Uint8Array(points), g2))
        .then((decoded) => {
        // wasm-bindgen copies the result out of the module's memory into a buffer of its own.
        const buffer = decoded.byteLength === decoded.buffer.byteLength ? decoded.buffer : decoded.slice().buffer;
        const response = { id, ok: true, points: buffer };
        self.postMessage(response, [buffer]);
    }, () => {
        const response = { id, ok: false };
        self.postMessage(response);
    });
});
