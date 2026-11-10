/**
 * The prover runtime: zopro-spr's `web` module as wasm-bindgen emits it
 * (`zopro_spr.js` beside its wasm), which the package ships in `runtime/`
 * beside the compiled worker, built twice: `threads/` with shared memory and a
 * thread pool, for a cross-origin isolated page, and `single/` without, for any
 * other page, where SharedArrayBuffer is missing.
 */
/** The runtime with a thread pool, uninitialized; the app's bundler emits it with its wasm and thread helpers. */
export async function importThreadedRuntime() {
    return await import("./runtime/threads/zopro_spr.js");
}
/** The runtime without shared memory, uninitialized; the app's bundler emits it with its wasm. */
export async function importSingleRuntime() {
    return await import("./runtime/single/zopro_spr.js");
}
