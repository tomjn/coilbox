import { contentDemoCommandRates } from "./bindings";
import { createReplayRead } from "./replayRead";

const read = createReplayRead((replayPath: string) =>
  contentDemoCommandRates({ replayPath }),
);

/**
 * One replay's commands per period, read once for the page (#1149). Reading
 * walks the whole demo stream, so nothing reads until `load` is called, which
 * the chart does when the reader asks for the commands per minute.
 */
export const useReplayCommandRates = read.useRead;

/** Forget what was read. For tests. */
export const resetReplayCommandRates = read.reset;
