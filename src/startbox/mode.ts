/**
 * The start-position mode, the engine's `StartPosType`. Shared by every surface
 * that launches a game so a skirmish, a scenario and a battle all offer the same
 * modes under the same names.
 */

/** Start-position modes we offer to pick (a subset of the engine's `StartPosType`). */
export const START_POS_OPTIONS = [
  { value: "0", label: "Fixed (map)" },
  { value: "2", label: "Choose in-game (start boxes)" },
  { value: "1", label: "Random" },
];

/**
 * Every mode the engine has, for reading one back. Wider than what we offer:
 * a battle hosted elsewhere can be in "choose before game", and showing that as
 * "Fixed" would misreport the room.
 */
const LABELS: Record<number, string> = {
  0: "Fixed (map)",
  1: "Random",
  2: "Choose in-game (start boxes)",
  3: "Choose before game",
};

/** The mode's label, falling back to fixed for a value the engine does not have. */
export const startPosLabel = (v: number): string => LABELS[v] ?? "Fixed";

/** Whether this mode is the one that spawns teams from drawn start boxes. */
export const isBoxMode = (v: number): boolean => v === 2;

/**
 * The caveat to show under the mode picker, or undefined when the mode speaks
 * for itself. Shared so a skirmish and a battle room say the same thing about
 * the same state, and so the box-mode warning stays true to the engine: an ally
 * team with no `StartRect` keeps the whole-map default (`AllyTeam.h`), which
 * looks like a restriction that silently is not one.
 */
export function startPosNote(opts: {
  startPosType: number;
  hasBoxes: boolean;
  /** Whether the viewer may draw the boxes, or is waiting on whoever can. */
  canEditBoxes: boolean;
}): string | undefined {
  if (opts.startPosType === 0)
    return "Each team spawns at its numbered map position. Pick a team in the player list to choose yours.";
  if (!isBoxMode(opts.startPosType) || opts.hasBoxes) return undefined;
  return opts.canEditBoxes
    ? "No start boxes yet, so every team may start anywhere on the map."
    : "The host hasn't set start boxes yet.";
}
