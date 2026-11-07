import { measurePlayability, type PlayabilityJob } from "./playability";

/** Measures one map and posts back the numbers or the error. */
self.onmessage = (event: MessageEvent<PlayabilityJob>) => {
  try {
    self.postMessage({ result: measurePlayability(event.data) });
  } catch (err) {
    self.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
