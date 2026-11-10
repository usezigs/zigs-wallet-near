import { keyForProveRequest, MAX_BROWSER_MERGE_INPUTS } from "./shapes.js";
import { abortable } from "./abortable.js";
/** How `url` addresses the prover at `proverUrl`; undefined if it is not a proving route. */
export function proveRoute(url, proverUrl) {
    const endpoint = new URL(proverUrl);
    const prove = `${endpoint.pathname.replace(/\/+$/u, "")}/prove`;
    if (url.origin !== endpoint.origin)
        return undefined;
    if (url.pathname === prove)
        return { kind: "prove" };
    if (!url.pathname.startsWith(`${prove}/`))
        return undefined;
    // A key segment is a key file name without `.key`, which always ends in its
    // shape; `/prove/status`, the poll path, is not one.
    const key = url.pathname.slice(prove.length + 1);
    return /^[a-z0-9_-]+_\d+_\d+$/u.test(key)
        ? { kind: "prove", keyFile: `${key}.key` }
        : { kind: "unsupported" };
}
/** Observe only public circuit metadata; never retain the witness body. */
export function observeProofRequests(fetch, proverUrl, onShape) {
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (proveRoute(url, proverUrl)?.kind === "prove") {
            const signal = init?.signal !== undefined
                ? (init.signal ?? undefined)
                : input instanceof Request
                    ? input.signal
                    : undefined;
            signal?.throwIfAborted();
            const body = typeof init?.body === "string"
                ? init.body
                : input instanceof Request
                    ? await abortable(input.clone().text(), signal)
                    : undefined;
            if (body !== undefined) {
                const shape = proofRequestShape(body);
                if (shape !== undefined)
                    onShape(shape);
            }
        }
        return fetch(input, init);
    };
}
/** Whether `body` is a merge of more notes than the browser proves. */
export function isWideMerge(body) {
    try {
        const parsed = JSON.parse(body);
        return (typeof parsed === "object" &&
            parsed !== null &&
            "circuitType" in parsed &&
            parsed.circuitType === "merge" &&
            "inputs" in parsed &&
            Array.isArray(parsed.inputs) &&
            parsed.inputs.length > MAX_BROWSER_MERGE_INPUTS);
    }
    catch {
        return false;
    }
}
export function proofRequestShape(body) {
    try {
        const parsed = JSON.parse(body);
        if (typeof parsed !== "object" ||
            parsed === null ||
            !("circuitType" in parsed) ||
            typeof parsed.circuitType !== "string")
            return undefined;
        if (parsed.circuitType === "merge") {
            if (!("inputs" in parsed) || !Array.isArray(parsed.inputs))
                return undefined;
            return keyForProveRequest(parsed.circuitType, parsed.inputs.length, 1);
        }
        if (!("nInputs" in parsed) ||
            !("nOutputs" in parsed) ||
            typeof parsed.nInputs !== "number" ||
            typeof parsed.nOutputs !== "number")
            return undefined;
        return keyForProveRequest(parsed.circuitType, parsed.nInputs, parsed.nOutputs);
    }
    catch {
        return undefined;
    }
}
