/**
 * Going and reading the table a game publishes (issue #1526).
 *
 * The half of `./shippedEquivalents.ts` that cannot be tested: one run of the
 * game's own Lua through unitsync, with the game's archives mounted, and the
 * result folded into this machine's table for that game.
 *
 * Asked for rather than done on opening a panel. It mounts a whole game's
 * archive set to answer, one game in the world ships the file, and a table it
 * finds nothing in is worth saying once rather than every time.
 *
 * Nothing here can fail loudly enough to matter: a game with no file, an engine
 * with no unitsync and a Lua error all end as a line of text saying what
 * happened, and the conversion carries on suggesting what it suggested before.
 */

import { plural, t } from "@lingui/core/macro";
import { useCallback, useState } from "react";
import { unitsyncLuaExec } from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
import { usePreferredTarget } from "@/play/config";
import { equivalentsKey, rememberShippedEquivalents } from "./equivalentsStore";
import { SHIPPED_TABLE_LUA, shippedEquivalents } from "./shippedEquivalents";
import type { SideUnits } from "./substitution";

export function useShippedEquivalents(
  gameArchive: string | undefined,
  sides: readonly SideUnits[],
): {
  /** Go and read it, or nothing at all when there is nothing to read it with:
   *  no engine to run unitsync from, or no game. */
  read?: () => void;
  reading: boolean;
  /** What the last read found, in the words a person needs. */
  note?: string;
} {
  const { target } = usePreferredTarget();
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string>();

  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const read = useCallback(async () => {
    if (!enginePath || !dataDir || !gameArchive) return;
    setReading(true);
    try {
      const res = await unitsyncLuaExec({
        enginePath,
        dataDir,
        archive: gameArchive,
        source: SHIPPED_TABLE_LUA,
      });
      if (res.error) {
        const detail = res.error;
        setNote(t`Could not read this game's table: ${detail}`);
        return;
      }

      const theirs = shippedEquivalents(res.result, sides);
      if (theirs.groups.length === 0) {
        setNote(
          t`This game does not publish a table of which buildings are each side's version of the same thing, so there was nothing to read. Almost no game does.`,
        );
        return;
      }

      const gained = rememberShippedEquivalents(
        equivalentsKey(gameArchive),
        theirs,
      );
      const pairings = theirs.groups.length;
      setNote(
        gained > 0
          ? plural(pairings, {
              one: `Read # pairing this game publishes, ${gained} of them ones coilbox did not have.`,
              other: `Read # pairings this game publishes, ${gained} of them ones coilbox did not have.`,
            })
          : plural(pairings, {
              one: "Read # pairing this game publishes. Coilbox already had all of them.",
              other:
                "Read # pairings this game publishes. Coilbox already had all of them.",
            }),
      );
    } catch (e) {
      const detail = describeError(e);
      setNote(t`Could not read this game's table: ${detail}`);
    } finally {
      setReading(false);
    }
  }, [enginePath, dataDir, gameArchive, sides]);

  return {
    read: enginePath && dataDir && gameArchive ? read : undefined,
    reading,
    note,
  };
}
