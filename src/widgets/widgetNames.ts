/**
 * The name a game saves each widget's on or off state under (issue #1290).
 *
 * Every handler keys that state by the name in `GetInfo().name`, and by the
 * file name (with its extension) when there is none. Writing under any other
 * name adds an entry for a widget that does not exist and leaves the real one
 * alone, with nothing to say so. So a switch is only offered for a file whose
 * name is certain, and {@link WidgetSwitch} says why when it is not.
 */

import type { PlayerWidgetFile } from "@/content/bindings";
import type { WidgetHandler } from "./handlers";

/** What the switch for one widget file can do. The switch itself is #1289. */
export type WidgetSwitch =
  /** The state is saved under `name`. */
  | {
      kind: "ready";
      name: string;
      /** Names the widget says it had before, which {@link savedUnder} reads
       *  state from when `name` has none. */
      previousNames: readonly string[];
    }
  /** The file did not run, so it has no name. */
  | { kind: "none"; reason: "error"; error: string }
  /** Another file a game loads has the same name, so both share one entry. */
  | {
      kind: "none";
      reason: "duplicate";
      name: string;
      /** The other files with that name, as `path`. */
      others: readonly string[];
    }
  /** A game saves it under a name with text added, which depends on the
   *  game's build and is not known from the file. */
  | { kind: "none"; reason: "experimental"; name: string };

/** An installed game and the handler it runs. */
interface Game {
  game: string;
  handler: WidgetHandler | null;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The switch for each of `files`. `loadedBy[i]` is the games that load
 * `files[i]`. Two files share an entry only in a game that loads both, so
 * files nobody loads together are not paired. Names are compared exactly, as
 * the config file's keys are.
 */
export function widgetNames(
  files: readonly PlayerWidgetFile[],
  loadedBy: readonly (readonly string[])[],
  games: readonly Game[],
): WidgetSwitch[] {
  const names = files.map((f) =>
    f.info ? (f.info.name ?? fileName(f.path)) : null,
  );
  const familyOf = new Map(games.map((g) => [g.game, g.handler?.family]));
  return files.map((file, i): WidgetSwitch => {
    const name = names[i];
    if (!file.info || name === null) {
      return {
        kind: "none",
        reason: "error",
        error: file.error ?? "",
      };
    }
    const others = files
      .filter(
        (other, j) =>
          j !== i &&
          names[j] === name &&
          loadedBy[j].some((g) => loadedBy[i].includes(g)),
      )
      .map((other) => other.path);
    if (others.length > 0)
      return { kind: "none", reason: "duplicate", name, others };
    if (
      file.info.experimental &&
      loadedBy[i].some((g) => familyOf.get(g) === "ca")
    ) {
      return { kind: "none", reason: "experimental", name };
    }
    return {
      kind: "ready",
      name,
      previousNames: file.info.previousNames ?? [],
    };
  });
}

/**
 * The name whose saved state a widget has, as its game's handler works it
 * out: its own name when that has state, otherwise the first of its previous
 * names that does. `null` when none has, which is a widget new to the config,
 * so a renamed widget that declares nothing starts afresh. `has` says whether
 * the config file holds state under a name.
 */
export function savedUnder(
  sw: Extract<WidgetSwitch, { kind: "ready" }>,
  has: (name: string) => boolean,
): string | null {
  if (has(sw.name)) return sw.name;
  return sw.previousNames.find(has) ?? null;
}
