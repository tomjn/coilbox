import { eachTypedArray, type LandJob, runLandJob } from "./landJob";

/** Runs one {@link LandJob} per message and posts back its result or its error. */
self.onmessage = (event: MessageEvent<{ id: number; job: LandJob }>) => {
  const { id, job } = event.data;
  try {
    const result = runLandJob(job);
    // The pixels are megabytes, so they are handed over rather than copied.
    const buffers = new Set<ArrayBuffer>();
    eachTypedArray(result, (_holder, _key, array) => {
      buffers.add(array.buffer as ArrayBuffer);
    });
    self.postMessage({ id, result }, { transfer: [...buffers] });
  } catch (err) {
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
