/**
 * Writing into a game's own blueprint file, carefully (issue #1312).
 *
 * This is the dangerous half of the feature. The file belongs to the player, it
 * is the only copy of every layout they have made in game, and coilbox is
 * merging into it rather than writing its own. So three rules, none of them
 * optional:
 *
 * - Refuse while a game is running. The widget holds its list in memory and
 *   writes the whole file back when the player saves or the game exits, so
 *   anything written underneath it is thrown away without a word. That is about
 *   the files the engine writes rather than about every file, so a caller that
 *   says where the engine writes gets a file somewhere else written (issue
 *   #1488), and a caller that does not gets the refusal it always got.
 * - Copy the file before changing it, and copy it every time rather than once,
 *   because the thing worth protecting is whatever was there a moment ago.
 * - Never write over a file that could not be read. The format refuses rather
 *   than treating an unreadable file as an empty one, and that refusal reaches
 *   here before anything is written.
 *
 * The filesystem is passed in. Reading and writing a path is two Tauri commands
 * in the app and two functions in a test, and everything that decides what to
 * write is the format adapter, which is plain text in and plain text out.
 */

import { underEngineConfig } from "@/content/enginePaths";
import type { BlueprintFormat, MergePlan } from "./format";
import type { BaseBlueprint } from "./model";

/** Reading and writing one path. Null from `read` means there is no file. */
export interface BlueprintFileIO {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

export interface MergeRequest {
  io: BlueprintFileIO;
  format: BlueprintFormat;
  /** The file to merge into, as the user picked it. */
  path: string;
  layouts: BaseBlueprint[];
  /** Whether a game is running right now, which is a refusal for every file
   *  under `configDir`. */
  gameRunning: boolean;
  /** Where the engine writes, so a running game only stops a write going there.
   *  Absent means coilbox does not know, and a running game stops every write,
   *  which is what it did before there was anything to compare against. */
  configDir?: string;
  /** When this is happening, which names the copy. Passed in so a test can say. */
  now?: Date;
}

export interface MergeOutcome extends Omit<MergePlan, "text"> {
  /** Where the file was copied to first, absent when there was no file yet. */
  backup?: string;
}

/** `20260813-090530`, so copies of one file sort in the order they were made
 *  and none of them lands on the name of another. */
function stamp(now: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  const date = [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
  ].join("");
  const time = [
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
  return `${date}-${time}`;
}

/**
 * Merge layouts into a game's blueprint file, keeping everything that was
 * already in it.
 *
 * Throws rather than half-doing it: a game running, a file that is not this
 * format, or a copy that could not be written all stop before anything is
 * written to the file itself.
 */
export async function mergeIntoGameFile({
  io,
  format,
  path,
  layouts,
  gameRunning,
  configDir,
  now = new Date(),
}: MergeRequest): Promise<MergeOutcome> {
  if (gameRunning && underEngineConfig(configDir, path)) {
    throw new Error(
      configDir
        ? `A game is running and this file is one it writes. ${format.label} writes its whole blueprints file back when it saves or exits, so anything written now would be thrown away. Close the game, or save somewhere the game does not write.`
        : `A game is running, and coilbox does not know where this engine writes, so it cannot tell whether the game will write this file back over. ${format.label} writes its whole blueprints file back when it saves or exits, so anything written now would be thrown away. Close the game and try again.`,
    );
  }

  const existing = (await io.read(path)) ?? "";
  // Before the copy, because a file that cannot be read is a file that is not
  // going to be written either, and there is no point leaving a copy of it.
  const plan = format.merge(existing, layouts);

  let backup: string | undefined;
  if (existing.trim().length > 0) {
    backup = `${path}.${stamp(now)}.bak`;
    await io.write(backup, existing);
  }

  await io.write(path, plan.text);
  return {
    backup,
    replaced: plan.replaced,
    added: plan.added,
    kept: plan.kept,
  };
}
