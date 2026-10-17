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
 * Four files make the unit reachable without cheats. The `modinfo.lua` names
 * the base game to build on. The `gamedata/sidedata.lua` declares a side
 * whose start unit is the built unit, which is how a Spring game says what a
 * player begins with. The gadget spawns it, because the engine does not: a
 * game's own Lua does, and a game whose spawn gadget names its commander
 * outright (Balanced Annihilation does) never reads the side's start unit at
 * all. A fourth file turns Lua unit scripts on where the base game has not.
 * A base game missing either of the two files that start the engine's gadget
 * handler gets that file too (see `LUARULES_ENTRIES`).
 */

import { luaString } from "./unitDef";

/** What the archive calls itself. The engine appends the version to this. */
const SCRATCH_NAME = "Coilbox unit test";

/** Rewritten on every test launch, so it carries no state worth versioning. */
const SCRATCH_VERSION = "scratch";

/**
 * The side the scratch game declares first, whose start unit is the built unit.
 * A game's sides live in a single file, so the scratch archive's copy replaces
 * the base game's. It lists a base game's sides after this one only when they
 * are in `sidedata.tdf`, which it can read (see `buildSideData`).
 */
export const SCRATCH_SIDE = "Coilbox";

/**
 * A second in. Late enough that a game which spawns its own start unit has
 * already done so, so the count in the gadget below sees it and does not add a
 * second copy.
 */
export const SPAWN_FRAME = 30;

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
 * its place, so the built unit is what the Coilbox side starts with.
 *
 * Replacing the file also drops the sides the base game declared. Metal
 * Factions declares its in `gamedata/sidedata.tdf`, which the engine reads
 * through its own `sidedata.lua` and which this file shadows, and its start
 * gadget looks one of them up by name (issue #4139). So the file reads the
 * base game's tdf the way the engine's does and lists those sides after its
 * own, untouched.
 */
export function buildSideData(unitName: string): string {
  const lines = [
    "-- The side the scratch game gives you, then the sides the base game",
    "-- declares in sidedata.tdf, if it does.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "local sides = {",
    "  {",
    `    name = ${luaString(SCRATCH_SIDE)},`,
    `    startunit = ${luaString(unitName)},`,
    "  },",
    "}",
    "",
    "local tdf = 'gamedata/sidedata.tdf'",
    "if VFS.FileExists(tdf) then",
    "  local parsed = VFS.Include('gamedata/parse_tdf.lua').Parse(tdf)",
    "  local index = 0",
    "  while parsed and type(parsed['side' .. index]) == 'table' do",
    "    local side = parsed['side' .. index]",
    "    sides[#sides + 1] = { name = side.name, startunit = side.commander }",
    "    index = index + 1",
    "  end",
    "end",
    "",
    "return sides",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The two files the engine starts LuaRules from: the synced half, then the
 * unsynced half. When either is missing the engine drops LuaRules whole and
 * logs nothing (`CSplitLuaHandle::InitUnsynced` in Recoil's
 * `LuaHandleSynced.cpp`), so no gadget runs, the spawn gadget included. Empty
 * Mod has `main.lua` and no `draw.lua`, and base content supplies neither
 * (issue #4475).
 */
export const LUARULES_ENTRIES = [
  "LuaRules/main.lua",
  "LuaRules/draw.lua",
] as const;
export type LuaRulesEntry = (typeof LUARULES_ENTRIES)[number];

/**
 * Lua for unitsync's parser, run with the base game and its dependencies
 * mounted, that answers which of `LUARULES_ENTRIES` the game has, joined by
 * `;`.
 */
export const LUARULES_ENTRIES_LUA = `
local found = {}
for _, path in ipairs({ ${LUARULES_ENTRIES.map((p) => luaString(p)).join(", ")} }) do
  if VFS.FileExists(path) then found[#found + 1] = path end
end
return table.concat(found, ';')
`;

/**
 * Which of `LUARULES_ENTRIES` the base game lacks, from what
 * `LUARULES_ENTRIES_LUA` answered. The parser hands the string back quoted.
 */
export function missingLuaRulesEntries(
  result: string | undefined,
): LuaRulesEntry[] {
  const found = new Set(
    (result ?? "")
      .trim()
      .replace(/^"|"$/g, "")
      .split(";")
      .map((path) => path.toLowerCase()),
  );
  return LUARULES_ENTRIES.filter((path) => !found.has(path.toLowerCase()));
}

/**
 * What the scratch archive writes in place of a missing LuaRules entry file.
 * It is the engine's own gadget handler from base content, which is what a
 * game's own `main.lua` and `draw.lua` usually hold, and it runs both halves.
 */
export function buildLuaRulesEntry(): string {
  const lines = [
    "-- Starts the engine's gadget handler, for a base game that lacks this file.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    'VFS.Include("LuaGadgets/gadgets.lua", nil, VFS.BASE)',
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The scratch archive's gadget that turns the engine's Lua unit script
 * framework on, for a base game that has not.
 *
 * The builder writes a unit's animation as a Lua script, and nothing runs one
 * unless a gadget includes the framework. Balanced Annihilation and Splinter
 * Faction each have one that does. Metal Factions has none, because all its
 * units are COB, so a built unit sat there with no script and the load check
 * could not ask the framework about it (issue #4139).
 *
 * A game that already includes it is left alone, because two copies would each
 * wrap every Lua unit. It finds that by looking for the include in the game's
 * other gadgets, which works whatever the file is called and in whatever order
 * the gadgets load.
 */
export function buildUnitScriptGadget(): string {
  const lines = [
    "-- Turns the engine's Lua unit scripts on in a game that has not.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "local FRAMEWORK = 'LuaGadgets/Gadgets/unit_script.lua'",
    "local OWN_PREFIX = 'luarules/gadgets/coilbox_'",
    "",
    "for _, path in ipairs(VFS.DirList('LuaRules/Gadgets/', '*.lua')) do",
    "  local text = path:lower():find(OWN_PREFIX, 1, true) ~= 1 and VFS.LoadFile(path)",
    "  if text and text:find(FRAMEWORK, 1, true) then",
    "    return false",
    "  end",
    "end",
    "",
    "return VFS.Include(FRAMEWORK, nil, VFS.ZIP_ONLY)",
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
 * keeps it from adding a second copy on a game that did honour the side. The
 * unit goes on the nearest clear ground to the start position, because a game
 * that spawns a commander puts it on that same spot (issue #4476).
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
    "-- Already done when `/luarules reload` loads this into a game past its",
    "-- frame, or a team that lost the unit since would get another.",
    "local spawned = Spring.GetGameFrame() > SPAWN_FRAME",
    "",
    "-- Whether a unit of radius `radius` at (x, z) would touch any of `units`.",
    "local function touchesAny(radius, x, z, units)",
    "  for _, unitID in ipairs(units) do",
    "    local ux, _, uz = Spring.GetUnitPosition(unitID)",
    "    local reach = radius + Spring.GetUnitRadius(unitID)",
    "    if ux and (ux - x) ^ 2 + (uz - z) ^ 2 < reach * reach then",
    "      return true",
    "    end",
    "  end",
    "  return false",
    "end",
    "",
    "-- The nearest ground around (x, z) the unit stands on clear of every unit",
    "-- already there, such as the commander a game puts on the same start",
    "-- position. TestBuildOrder checks the ground and the unit's footprint, and",
    "-- answers 2 with no feature for open ground. A commander's model reaches",
    "-- past its footprint, so the two units' radii must not meet either. It",
    "-- searches in square rings one footprint apart, out to the map's edge, and",
    "-- keeps the start position when nowhere is clear.",
    "local function clearSpot(def, x, z)",
    "  local units = Spring.GetAllUnits()",
    "  local step = math.max(def.xsize, def.zsize) * Game.squareSize",
    "  local rings = math.ceil(math.max(Game.mapSizeX, Game.mapSizeZ) / step)",
    "  for ring = 0, rings do",
    "    for dx = -ring, ring do",
    "      for dz = -ring, ring do",
    "        if math.max(math.abs(dx), math.abs(dz)) == ring then",
    "          local px, pz = x + dx * step, z + dz * step",
    "          if px >= 0 and pz >= 0 and px < Game.mapSizeX and pz < Game.mapSizeZ then",
    "            local py = Spring.GetGroundHeight(px, pz)",
    "            local status, feature = Spring.TestBuildOrder(def.id, px, py, pz, 0)",
    "            if status == 2 and not feature and not touchesAny(def.radius, px, pz, units) then",
    "              return px, py, pz",
    "            end",
    "          end",
    "        end",
    "      end",
    "    end",
    "  end",
    "  return x, Spring.GetGroundHeight(x, z), z",
    "end",
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
    "      local sx, _, sz = Spring.GetTeamStartPosition(teamID)",
    "      if sx then",
    "        local x, y, z = clearSpot(def, sx, sz)",
    "        Spring.CreateUnit(def.id, x, y, z, 0, teamID)",
    "      end",
    "    end",
    "  end",
    "end",
  ];
  return `${lines.join("\n")}\n`;
}
