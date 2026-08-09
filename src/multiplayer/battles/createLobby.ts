/**
 * What the create-lobby form collects, and the rules it holds itself to.
 *
 * A Tachyon lobby is shaped as sides, each holding a seat per player, so the
 * form asks for those two numbers rather than for a total. The limits are ours
 * rather than the schema's, which sets no maximum: they are what a Spring match
 * can actually be played with, since the engine numbers ally teams and teams in
 * four bits each.
 */
export interface NewLobbyForm {
  name: string;
  mapName: string;
  allyTeams: number;
  playersPerTeam: number;
}

/** Fewest and most sides a lobby can have. One side has nobody to play. */
export const ALLY_TEAM_RANGE = { min: 2, max: 8 } as const;

/** Fewest and most players on each side. */
export const PLAYERS_PER_TEAM_RANGE = { min: 1, max: 16 } as const;

/**
 * Why the form cannot be sent yet, in words to show the user, or null when it
 * can. Pure.
 */
export function newLobbyProblem(form: NewLobbyForm): string | null {
  if (!form.name.trim()) return "Give the lobby a name.";
  if (!form.mapName) return "Choose a map.";
  if (!inRange(form.allyTeams, ALLY_TEAM_RANGE)) {
    return `A lobby has between ${ALLY_TEAM_RANGE.min} and ${ALLY_TEAM_RANGE.max} sides.`;
  }
  if (!inRange(form.playersPerTeam, PLAYERS_PER_TEAM_RANGE)) {
    return `Each side takes between ${PLAYERS_PER_TEAM_RANGE.min} and ${PLAYERS_PER_TEAM_RANGE.max} players.`;
  }
  return null;
}

/** A whole number inside `range`, both ends counted. */
function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

/** How the shape of a lobby reads, such as "8v8" or "4v4v4". Pure. */
export function shapeLabel(allyTeams: number, playersPerTeam: number): string {
  return Array(Math.max(allyTeams, 0)).fill(playersPerTeam).join("v");
}
