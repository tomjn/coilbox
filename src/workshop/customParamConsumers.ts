/**
 * Turning a custom parameter's consumer index into the line its row shows
 * (issue #2661).
 *
 * The engine ignores custom parameters, so a row can say a unit carries
 * `techlevel = 2` and nothing about what that does. The answer is in the game's
 * own Lua, and the worker's `--custom-params` scan finds it. This decides what
 * to say about what it found.
 *
 * The rule that matters is when to stop listing. A parameter named in one file
 * has an answer, and the file is it. A parameter named in fifteen has a count
 * and no answer, and printing fifteen paths under a form row buries the row
 * without telling the reader anything. Three is where this stops listing: two
 * or three files still read as an answer you can go and check, and past that
 * the count is the honest summary.
 */
import type {
  CustomParamConsumers,
  CustomParamsResult,
} from "@/content/bindings";

/** How many files are worth naming before the count says it better. */
const MAX_LISTED = 3;

/** What a custom parameter row says about who reads it. */
export interface ConsumerNote {
  /** The words before the files. A whole sentence when {@link
   *  ConsumerNote.files} is empty, and a lead-in like "Read by" when it is
   *  not. */
  text: string;
  /** The files to name, in order. Empty when there are too many to list, or
   *  when none were found. */
  files: string[];
}

/**
 * The parameter a field path names, lowercased, or `null` for a path that is
 * not inside a `customParams` table.
 *
 * Lowercased because that is how the scan is keyed and how the engine hands
 * `customParams` to Lua. `weapons.0.customParams.x` answers too, so a weapon's
 * parameters join the same way a unit's do.
 */
export function customParamKey(path: string): string | null {
  const parts = path.split(".");
  const at = parts.findIndex((part) => part.toLowerCase() === "customparams");
  if (at < 0 || at !== parts.length - 2) return null;
  return parts[parts.length - 1].toLowerCase();
}

/** Whether every file that names the parameter only ever assigns to it. */
const onlySet = (consumers: CustomParamConsumers) =>
  consumers.sites.length > 0 &&
  consumers.sites.every((s) => s.reads === 0 && s.writes > 0);

/**
 * What to say about one parameter, or `null` when there is no scan to say it
 * from, which is what a row gets while the scan is still running.
 */
export function consumerNote(
  path: string,
  scan: CustomParamsResult | null,
): ConsumerNote | null {
  const key = customParamKey(path);
  if (key === null || !scan) return null;
  const consumers = scan.params[key];

  if (!consumers || consumers.files === 0) {
    // Nothing names the key. That is only "nothing uses it" if nothing reads
    // the table whole either, and something usually does, so say which.
    const unattributed =
      scan.wholeTableFiles > 0
        ? ` ${scan.wholeTableFiles} file${scan.wholeTableFiles === 1 ? "" : "s"} read the whole customParams table, so a gadget may still use it without naming it.`
        : "";
    const partial = scan.truncated
      ? " The scan stopped before it had read the whole archive."
      : "";
    return {
      text: `No file in this game names this parameter.${unattributed}${partial}`,
      files: [],
    };
  }

  if (consumers.files > MAX_LISTED) {
    return {
      text: `Named in ${consumers.files} of this game's Lua files, so no one of them is the answer.`,
      files: [],
    };
  }

  return {
    text: onlySet(consumers) ? "Set by" : "Read by",
    files: consumers.sites.map((s) => s.file),
  };
}
