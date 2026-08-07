/**
 * The scratch game a built unit is tested in.
 *
 * The engine loads units from a game, so seeing one on a map means putting it
 * in a game. Writing into the user's install to do that would be rude and hard
 * to undo, so coilbox keeps one `.sdd` of its own that depends on whichever
 * game the unit is tested against. The base game supplies the sides, the rules
 * and everything else. The scratch archive adds only what the builder exported.
 *
 * It is a plain folder under the content root's `games/`, so deleting that
 * folder undoes everything this flow ever wrote. Its name, and the fact that a
 * game list should not offer it, live in `src/lib/generatedGames.ts` alongside
 * the scenario editor's equivalent.
 *
 * Three files make the unit reachable without cheats. The `modinfo.lua` names
 * the base game to build on. The `gamedata/sidedata.lua` declares one side
 * whose start unit is the built unit, which is how a Spring game says what a
 * player begins with. The gadget spawns it, because the engine does not: a
 * game's own Lua does, and a game whose spawn gadget names its commander
 * outright (Balanced Annihilation does) never reads the side's start unit at
 * all.
 */

import { luaString } from "./unitDef";

/** What the archive calls itself. The engine appends the version to this. */
const SCRATCH_NAME = "Coilbox unit test";

/** Rewritten on every test launch, so it carries no state worth versioning. */
const SCRATCH_VERSION = "scratch";

/**
 * The one side the scratch game declares. A game's sides live in a single file,
 * so the scratch archive's copy replaces the base game's rather than adding to
 * it: after this there is one side, and its start unit is the built unit.
 */
export const SCRATCH_SIDE = "Coilbox";

/**
 * A second in. Late enough that a game which spawns its own start unit has
 * already done so, so the count in the gadget below sees it and does not add a
 * second copy.
 */
const SPAWN_FRAME = 30;

/**
 * The scratch archive's `modinfo.lua`.
 *
 * `modtype = 1` is what makes it a game the engine can be launched with.
 * Anything lower and it would never be offered as a start-script `GameType`.
 * The single `depend` entry is the name unitsync reports for the base game,
 * which is the same string a start script names, so the two cannot drift apart.
 */
export function buildModInfo(baseGame: string): string {
  const lines = [
    "-- The scratch game coilbox's unit builder tests units in.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "return {",
    `  name = ${luaString(SCRATCH_NAME)},`,
    '  shortname = "coilbox_lego_test",',
    `  game = ${luaString(SCRATCH_NAME)},`,
    `  version = ${luaString(SCRATCH_VERSION)},`,
    `  description = ${luaString(`Units built with coilbox, on top of ${baseGame}.`)},`,
    "  modtype = 1,",
    "  depend = {",
    `    ${luaString(baseGame)},`,
    "  },",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The scratch archive's `gamedata/sidedata.lua`.
 *
 * A game's sides are a list of `{ name, startunit }`, and `startunit` is the
 * unit a player begins the match with. Balanced Annihilation's own file names
 * `armcom` and `corcom` that way, and unitsync reads the scratch game's copy in
 * its place, so the built unit is what the one side starts with.
 */
export function buildSideData(unitName: string): string {
  const lines = [
    "-- The side the scratch game gives you, replacing the base game's own.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "return {",
    "  {",
    `    name = ${luaString(SCRATCH_SIDE)},`,
    `    startunit = ${luaString(unitName)},`,
    "  },",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The scratch archive's spawn gadget.
 *
 * Declaring the start unit is not enough on its own. The engine leaves spawning
 * to the game's Lua, and a game is free to name its own commander rather than
 * read the side, which is exactly what Balanced Annihilation does. So the
 * scratch archive brings a gadget of its own, which the base game's gadget
 * handler picks up along with its own.
 *
 * It gives each team one of the built unit and then stops. The count is what
 * keeps it from adding a second copy on a game that did honour the side.
 */
export function buildStartUnitGadget(unitName: string): string {
  const lines = [
    "-- Gives every team the unit coilbox's builder exported.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "function gadget:GetInfo()",
    "  return {",
    '    name = "Coilbox start unit",',
    '    desc = "Gives every team the unit coilbox\'s builder exported.",',
    '    author = "coilbox",',
    "    layer = 1000,",
    "    enabled = true,",
    "  }",
    "end",
    "",
    "if not gadgetHandler:IsSyncedCode() then",
    "  return false",
    "end",
    "",
    `local UNIT_NAME = ${luaString(unitName)}`,
    `local SPAWN_FRAME = ${SPAWN_FRAME}`,
    "",
    "local spawned = false",
    "",
    "function gadget:GameFrame(frame)",
    "  if spawned or frame < SPAWN_FRAME then",
    "    return",
    "  end",
    "  spawned = true",
    "",
    "  local def = UnitDefNames[UNIT_NAME]",
    "  if not def then",
    '    Spring.Echo("[coilbox] no unit definition called " .. UNIT_NAME)',
    "    return",
    "  end",
    "",
    "  local gaia = Spring.GetGaiaTeamID()",
    "  for _, teamID in ipairs(Spring.GetTeamList()) do",
    "    if teamID ~= gaia and Spring.GetTeamUnitDefCount(teamID, def.id) == 0 then",
    "      local x, y, z = Spring.GetTeamStartPosition(teamID)",
    "      if x then",
    "        Spring.CreateUnit(def.id, x, y, z, 0, teamID)",
    "      end",
    "    end",
    "  end",
    "end",
  ];
  return `${lines.join("\n")}\n`;
}
