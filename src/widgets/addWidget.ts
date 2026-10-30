/**
 * Where a widget a player adds goes, and which games will not load it (issue
 * #1286).
 *
 * A game's handler reads fixed folders (`handlers.ts`), so adding a widget
 * means copying it into the folder of each game it is for. When games read
 * different folders the widget goes into each, once. Which games it is for is
 * every installed game with a recognised handler, or just the one the player is
 * looking at on the widgets page.
 */

import type { PlannedWidget, WidgetPlan } from "@/content/bindings";
import type { GameHandler } from "./widgetList";

/** A folder to copy into and the games that read it. */
export interface Destination {
  /** Relative to the write folder, spelled as the handler spells it. */
  folder: string;
  games: string[];
}

/** A game the widget is not copied for. */
export interface SkippedGame {
  game: string;
  /** `unknown-handler`: coilbox does not know where the game reads widgets.
   *  `no-rml-folder`: the widget is built on RmlUi and the game has no folder
   *  for those. */
  reason: "unknown-handler" | "no-rml-folder";
}

export interface Destinations {
  destinations: Destination[];
  skipped: SkippedGame[];
}

/** The folder Beyond All Reason reads RmlUi widgets from. */
function isRmlFolder(folder: string): boolean {
  return folder.toLowerCase().endsWith("/rmlwidgets");
}

/**
 * The folders to copy a widget into. A widget built on RmlUi goes where a game
 * reads those, and any other widget goes to the first folder a game reads that
 * is not for them. With `only` set, just that game's.
 *
 * On a filesystem that folds case `LuaUI/Widgets` and `LuaUI/widgets` are one
 * folder, so they are listed once. On one that does not, a game reads only the
 * spelling its handler asks for, so each spelling is its own destination.
 */
export function destinationsFor(
  games: readonly GameHandler[],
  options: { rml: boolean; caseSensitive: boolean; only?: string },
): Destinations {
  const destinations: Destination[] = [];
  const skipped: SkippedGame[] = [];
  const fold = (folder: string) =>
    options.caseSensitive ? folder : folder.toLowerCase();
  for (const game of games) {
    if (options.only !== undefined && game.game !== options.only) continue;
    if (!game.handler) {
      skipped.push({ game: game.game, reason: "unknown-handler" });
      continue;
    }
    const folder = game.handler.folders.find(
      (f) => isRmlFolder(f) === options.rml,
    );
    if (folder === undefined) {
      skipped.push({ game: game.game, reason: "no-rml-folder" });
      continue;
    }
    const same = destinations.find((d) => fold(d.folder) === fold(folder));
    if (same) same.games.push(game.game);
    else destinations.push({ folder, games: [game.game] });
  }
  return { destinations, skipped };
}

/** The widgets that sit in a subfolder of what was picked, and the games
 *  that get a copy but do not read subfolders, so will not load them. */
export interface NestedWarning {
  widgets: PlannedWidget[];
  games: string[];
}

/** `null` when every widget sits at the top, or every game loads subfolders. */
export function nestedWarning(
  plan: WidgetPlan,
  games: readonly GameHandler[],
  destinations: readonly Destination[],
): NestedWarning | null {
  const widgets = plan.widgets.filter((w) => w.nested);
  if (widgets.length === 0) return null;
  const readsSubfolders = new Set(
    games.filter((g) => g.handler?.subfolders).map((g) => g.game),
  );
  const blind = destinations
    .flatMap((d) => d.games)
    .filter((g) => !readsSubfolders.has(g));
  return blind.length > 0 ? { widgets, games: blind } : null;
}

/** The names a game saves the added widgets under, for the sets to switch.
 *  Leaves out a file that did not run, which has no name, and any widget that
 *  replaced one of the same name, which keeps the setting it had. */
export function namesToSwitch(
  widgets: readonly PlannedWidget[],
  replaced: readonly string[],
): string[] {
  return [
    ...new Set(
      widgets
        .map((w) => w.name)
        .filter((n): n is string => n !== null && !replaced.includes(n)),
    ),
  ];
}
