/** Race work against cancellation even when an I/O implementation ignores signals. */
export function abortable(work, signal) {
    if (signal === undefined)
        return work;
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        const cleanup = () => signal.removeEventListener("abort", abort);
        // Always observe work, including when the signal was already aborted.
        work.then((value) => {
            cleanup();
            if (signal.aborted)
                reject(signal.reason);
            else
                resolve(value);
        }, (error) => {
            cleanup();
            reject(signal.aborted ? signal.reason : error);
        });
        if (signal.aborted)
            abort();
        else
            signal.addEventListener("abort", abort, { once: true });
    });
}
/** Rethrows a cancellation, so a caller that swallows other errors still stops. */
export function rethrowAbort(error, signal) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError")
        throw error;
}
