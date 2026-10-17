/**
 * Browsing the units of a unit's own game as a source of parts (issue #3264).
 *
 * The browser only ever reads the game the open unit is for, and another
 * version or a mutator of that game counts as the same game, as everywhere else
 * (`unitGame.ts`). Another installed game is never offered.
 *
 * Pure, so the rules are testable without unitsync or a webview.
 */

import type { GameItem } from "@/content/bindings";
import type { GameModelRow } from "./gameModels";
import type { LegoProject } from "./model";
import { installedGameFor, liftRefusal, unitGame } from "./unitGame";

/** Which game's units the browser may list for a unit. */
export type BrowseSource =
  | { state: "no-game"; message: string }
  | { state: "not-installed"; message: string }
  | { state: "ready"; game: GameItem };

/**
 * The installed game to browse for `project`. A unit for no game gets the same
 * "choose a game first" message the lift check gives.
 */
export function browseSource(
  project: LegoProject,
  installed: readonly GameItem[],
): BrowseSource {
  const own = unitGame(project);
  const refusal = liftRefusal(project, own, installed);
  if (!own || refusal) {
    return {
      state: "no-game",
      message: refusal ?? "This unit is for no game. Choose a game first.",
    };
  }
  const game = installedGameFor(own, installed);
  if (!game) {
    return { state: "not-installed", message: `${own.name} is not installed.` };
  }
  return { state: "ready", game };
}

/**
 * The rows a unit names. A model no unit names is a wreck or a feature, and the
 * browser lists units.
 */
export function gameUnitRows(rows: readonly GameModelRow[]): GameModelRow[] {
  return rows.filter((row) => row.unit);
}

/** Rows matching a search on the unit's name, its internal name or its model. */
export function searchUnitRows(
  rows: readonly GameModelRow[],
  query: string,
): GameModelRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) =>
      row.label.toLowerCase().includes(needle) ||
      row.member.toLowerCase().includes(needle) ||
      (row.unit?.toLowerCase().includes(needle) ?? false),
  );
}

export interface PieceLine {
  name: string;
  depth: number;
  /** Where the piece sits in the tree, such as "0.1". Unique even when a
   *  model reuses a piece name. */
  path: string;
}

/** A piece and the ones under it, as either model reader gives them. */
interface PieceNode {
  name: string;
  children: readonly PieceNode[];
}

/**
 * A model's pieces in tree order, each with how far down it hangs. The read
 * and the import walk a model the same way, so a path names the same piece in
 * either tree.
 */
export function pieceLines(root: PieceNode, path = "0"): PieceLine[] {
  return [
    { name: root.name, depth: path.split(".").length - 1, path },
    ...root.children.flatMap((child, index) =>
      pieceLines(child, `${path}.${index}`),
    ),
  ];
}
