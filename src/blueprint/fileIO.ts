/**
 * The app's filesystem, as {@link BlueprintFileIO} wants it.
 *
 * Two commands, one to read a path and one to write one, neither of which knows
 * or cares what is in the file.
 *
 * A read of a file that is not there answers with null rather than throwing,
 * because a player who has never saved a blueprint in game has no file yet and
 * that is not an error. Any other failure is thrown on, and that matters more
 * than it looks: a file coilbox cannot read must never be treated as a file that
 * is not there, or the merge would write a fresh one over it.
 */

import { contentWriteFile } from "../content/bindings";
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
    await contentWriteFile({ dest: path, text });
  },
};
