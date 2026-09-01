/**
 * The write path for an editor that saves as you go.
 *
 * The scenario and campaign editors have no save button: every edit is written
 * to disk as it is made, and each write carries the whole document. Two edits
 * made close enough together used to break that. Each one went out on its own,
 * so whichever the plugin finished last was the one left on disk, and an
 * earlier write finishing later put the earlier document back in the file with
 * the newer edit gone from it. A fast double click on the scenario map is two
 * placements and one of them disappeared (issue #893). Renaming a campaign and
 * then removing a mission is the same loss (issue #2221).
 *
 * So writes go through a queue, one at a time in the order they were asked
 * for. The last edit asked for is therefore the last one written, which is the
 * one the author made last. And only that last edit's stored document is
 * reported. An earlier write finishing later has nothing to say about the
 * document now being edited, so its result is dropped rather than shown.
 */

export interface DocumentSaver<T> {
  /** Write a document, behind anything already queued. Returns at once. */
  save(document: T): void;
  /** Resolves once every write asked for so far has finished. */
  settled(): Promise<void>;
}

export function createDocumentSaver<T>(opts: {
  /** Write a document and hand back the stored version now on disk. */
  write: (document: T) => Promise<T>;
  /** The newest document, as it was stored. Not called for a superseded write. */
  onWritten: (document: T) => void | Promise<void>;
  onError: (error: unknown) => void;
}): DocumentSaver<T> {
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
