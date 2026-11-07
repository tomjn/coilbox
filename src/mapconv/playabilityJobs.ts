import {
  measurePlayability,
  type Playability,
  type PlayabilityJob,
} from "./playability";

/**
 * {@link measurePlayability} on a worker of its own, because a large map is
 * seconds of arithmetic. Where there is no `Worker`, which is the test runner,
 * it runs here. The signal stops the worker, so a page that moves on to
 * another map or game does not wait for the last one.
 */
export function measureOffThread(
  job: PlayabilityJob,
  signal?: AbortSignal,
): Promise<Playability> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("measuring stopped", "AbortError"));
  }
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() => measurePlayability(job));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./playability.worker.ts", import.meta.url),
      { type: "module" },
    );
    const stop = () => {
      worker.terminate();
      reject(new DOMException("measuring stopped", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ result?: Playability; error?: string }>,
    ) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      const { result, error } = event.data;
      if (result) resolve(result);
      else reject(new Error(error ?? "the measuring worker failed"));
    };
    worker.onerror = (event) => {
      signal?.removeEventListener("abort", stop);
      worker.terminate();
      reject(new Error(event.message || "the measuring worker stopped"));
    };
    worker.postMessage(job);
  });
}
