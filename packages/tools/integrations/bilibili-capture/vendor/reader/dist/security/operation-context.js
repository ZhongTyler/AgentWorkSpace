import { AsyncLocalStorage } from "node:async_hooks";
const operationContext = new AsyncLocalStorage();
export function runWithOperationSignal(signal, operation) {
    return operationContext.run({ signal }, operation);
}
export function getOperationSignal(explicitSignal) {
    return explicitSignal ?? operationContext.getStore()?.signal;
}
export function createAbortError() {
    return new DOMException("The operation was aborted.", "AbortError");
}
export function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw createAbortError();
    }
}
export function linkAbortSignal(source, target) {
    if (!source)
        return () => { };
    if (source.aborted) {
        target.abort(createAbortError());
        return () => { };
    }
    const onAbort = () => target.abort(createAbortError());
    source.addEventListener("abort", onAbort, { once: true });
    return () => source.removeEventListener("abort", onAbort);
}
export function abortableDelay(milliseconds, signal) {
    throwIfAborted(signal);
    if (milliseconds <= 0)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            reject(createAbortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
//# sourceMappingURL=operation-context.js.map