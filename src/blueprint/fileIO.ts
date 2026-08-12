/**
 * The app's filesystem, as {@link BlueprintFileIO} wants it.
 *
 * Two commands, both of which read and write a path the user picked and neither
 * of which knows or cares what is in the file. They are named for the first
 * thing that needed them rather than for what they do, which is worth giving
 * honest names, and is https://github.com/tomjn/coilbox/issues/1431.
 *
 * A read of a file that is not there answers with null rather than throwing,
 * because a player who has never saved a blueprint in game has no file yet and
 * that is not an error. Any other failure is thrown on, and that matters more
 * than it looks: a file coilbox cannot read must never be treated as a file that
 * is not there, or the merge would write a fresh one over it.
 */

import { contentExportKeymap } from "../content/bindings";
import { importContainerFile } from "../deeplink/bindings";
import type { BlueprintFileIO } from "./gameFile";

/** Whether a failed read was the file not being there. `os error 2` is
 *  `ErrorKind::NotFound` on every platform Rust formats it for. */
function notFound(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /os error 2\b|no such file or directory/i.test(message);
}

export const appFileIO: BlueprintFileIO = {
  read: async (path) => {
    try {
      const { text } = await importContainerFile({ src: path });
      return text;
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  },
  write: async (path, text) => {
    await contentExportKeymap({ dest: path, text });
  },
};
