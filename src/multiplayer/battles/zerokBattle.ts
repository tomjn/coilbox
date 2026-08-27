import type { ZerokBattleMode } from "../bindings";

/**
 * What the Zero-K host form collects, and the rules it holds itself to.
 *
 * There is no map here, and no game. The server resolves both against its own
 * content and falls back to a recommended map and to its own game, so the map
 * the form offers is a request rather than a setting and an empty one is
 * allowed. What the form does own is the title, the mode and the size.
 */
export interface NewZerokBattleForm {
  title: string;
  mode: ZerokBattleMode;
  maxPlayers: number;
}

/** Fewest and most players a room may be opened for. The floor is what a match
 * needs to be a match. The ceiling is the engine's, which numbers teams in four
 * bits. The server has a maximum of its own on top of this and applies it
 * itself. */
export const MAX_PLAYERS_RANGE = { min: 2, max: 32 } as const;

/** The modes a room can be opened in, labelled as the game labels them. */
export const ZEROK_BATTLE_MODES: {
  value: ZerokBattleMode;
  label: string;
  blurb: string;
}[] = [
  {
    value: "custom",
    label: "Custom",
    blurb: "Players pick their own sides and the room is yours to set up.",
  },
  {
    value: "teams",
    label: "Teams",
    blurb: "The server balances two sides when the match starts.",
  },
  { value: "1v1", label: "1v1", blurb: "Two players, one each side." },
  { value: "ffa", label: "FFA", blurb: "Everyone for themselves." },
  {
    value: "coop",
    label: "Cooperative",
    blurb: "Players together against the chickens.",
  },
];

/**
 * Why the form cannot be sent yet, in words to show the user, or null when it
 * can. Pure.
 */
export function newZerokBattleProblem(form: NewZerokBattleForm): string | null {
  if (!form.title.trim()) return "Give the battle a title.";
  if (
    !Number.isInteger(form.maxPlayers) ||
    form.maxPlayers < MAX_PLAYERS_RANGE.min ||
    form.maxPlayers > MAX_PLAYERS_RANGE.max
  ) {
    return `A battle seats between ${MAX_PLAYERS_RANGE.min} and ${MAX_PLAYERS_RANGE.max} players.`;
  }
  return null;
}

/**
 * How many the room will actually seat, given the mode and the size asked for.
 * Pure.
 *
 * The server has the last word on this. `ValidateAndFillDetails` upstream fixes
 * a 1v1 at two and raises anything under a mode's own minimum, so a form that
 * showed the number typed would be showing a number the room does not have. The
 * server also applies a maximum of its own, which is its configuration and not
 * something we can know here.
 */
export function seatedBy(mode: ZerokBattleMode, asked: number): number {
  if (mode === "1v1") return 2;
  if (mode === "teams") return asked < 4 ? 16 : asked;
  if (mode === "ffa") return asked < 3 ? 16 : asked;
  if (mode === "coop") return asked < 2 ? 10 : asked;
  return asked;
}
