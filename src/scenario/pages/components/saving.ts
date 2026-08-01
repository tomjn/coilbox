/**
 * The scenario editor's write path.
 *
 * The editor has no save button: every edit is written to disk as it is made,
 * and the stamped document that comes back is what the editor then shows, so
 * what is on screen is what is on disk. Two edits made close enough together
 * used to break that. Each one wrote its own snapshot and then set the editor to
 * whatever its own save handed back, so an earlier save resolving last put the
 * editor back to the earlier document, and the file kept whichever write
 * happened to land last. A fast double click on the map is two placements, and
 * one of them disappeared (issue #893).
 *
 * So writes go through a queue, one at a time in the order they were asked for.
 * The last edit asked for is therefore the last one written, which is the one
 * the author made last. And only that last edit's stamped document is shown.
 * An earlier save finishing later has nothing to say about the document now
 * being edited, so its result is dropped rather than displayed.
 */

import type { Scenario } from "../../model";

export interface ScenarioSaver {
  /** Write a document, behind anything already queued. Returns at once. */
  save(document: Scenario): void;
  /** Resolves once every write asked for so far has finished. */
  settled(): Promise<void>;
}

export function createScenarioSaver(opts: {
  /** Write a document and hand back the stamped version now on disk. */
  write: (document: Scenario) => Promise<Scenario>;
  /** The newest document, as it was stored. Not called for a superseded write. */
  onWritten: (document: Scenario) => void | Promise<void>;
  onError: (error: unknown) => void;
}): ScenarioSaver {
  let queue: Promise<void> = Promise.resolve();
  let latest = 0;

  return {
    save(document) {
      const seq = ++latest;
      queue = queue.then(async () => {
        try {
          const written = await opts.write(document);
          // A later edit has already been asked for, so this document is not
          // what the author is looking at. Writing it back would undo them.
          if (seq !== latest) return;
          await opts.onWritten(written);
        } catch (error) {
          opts.onError(error);
        }
      });
    },
    settled: () => queue,
  };
}
