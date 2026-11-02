/**
 * Holding one team to a list of units, for a warpath (issue #5005).
 *
 * The start script's `[RESTRICT]` section applies to every team, and a game's
 * own faction picker can move the player off the side that list was made for.
 * So the player's team also gets a gadget, which needs no knowledge of any
 * picker: it allows only the units named, whichever builder the player ends up
 * with. No other team is touched.
 *
 * A game whose picker coilbox knows also starts the team on the run's side, by
 * setting the team rules param that picker writes (issue #5017). The picker can
 * still change it, so the gadget draws a line on screen when it has. A game not
 * in `PICKERS` gets the limit alone.
 *
 * The list travels in the start script rather than in the gadget. A replay
 * carries its script, so it keeps the list it was played with after later
 * unlocks, and an unlock does not rewrite the mutator or rescan the content.
 */

import { t } from "@lingui/core/macro";
import type { BattleConfig } from "../play/bindings";

const TEAM_OPTION = "coilbox_player_team";
const UNITS_OPTION = "coilbox_player_units";
const PICKER_OPTION = "coilbox_player_picker";
const SIDE_OPTION = "coilbox_player_side";
const SIDE_NOTE_OPTION = "coilbox_player_side_note";

/**
 * The team rules param each known picker writes, read from the games' own Lua:
 * `game_commands.lua` and `game_start.lua` in Metal Factions, `game_spawn.lua`
 * in SplinterFaction, which holds a start unit's def id rather than a side name.
 */
const PICKERS: readonly { game: RegExp; param: string }[] = [
  { game: /^metal factions\b/i, param: "faction_selected" },
  { game: /^splinterfaction\b/i, param: "startUnit" },
];

/** The gadget, which the plugin writes to `LuaRules/Gadgets/`. */
export function buildPlayerLimitGadget(): string {
  const lines = [
    "-- Holds one team to the units a warpath run has unlocked. The team and the",
    "-- units come from the start script's mod options, so a replay keeps its own.",
    "-- A game's faction picker cannot get around it, and other teams are untouched.",
    "-- Where the script names a picker, the team starts on the run's side.",
    "-- Written by coilbox. Delete this folder to undo it.",
    "",
    "function gadget:GetInfo()",
    "  return {",
    '    name = "Coilbox player limit",',
    '    desc = "Holds one team to the units a warpath run has unlocked.",',
    '    author = "coilbox",',
    "    layer = 1000,",
    "    enabled = true,",
    "  }",
    "end",
    "",
    "local options = Spring.GetModOptions() or {}",
    `local team = tonumber(options.${TEAM_OPTION})`,
    `local units = options.${UNITS_OPTION}`,
    "if not team or not units then",
    "  return false",
    "end",
    "",
    `local picker = options.${PICKER_OPTION}`,
    `local side = options.${SIDE_OPTION}`,
    "",
    "-- What the game's picker holds for the run's side, or nil when it has no such side.",
    "local function pickerValue()",
    "  if not picker or not side then",
    "    return nil",
    "  end",
    "  if picker ~= 'startUnit' then",
    "    return side:lower()",
    "  end",
    "  local def = UnitDefNames[(Spring.GetSideData(side) or ''):lower()]",
    "  return def and def.id",
    "end",
    "local wanted = pickerValue()",
    "",
    "if not gadgetHandler:IsSyncedCode() then",
    `  local note = options.${SIDE_NOTE_OPTION}`,
    "  if not wanted or not note then",
    "    return false",
    "  end",
    "",
    "  -- A picker's Random can still land on the run's side, which the game records",
    "  -- in `faction` once the unit has spawned.",
    "  local function onAnotherSide()",
    "    local held = Spring.GetTeamRulesParam(team, picker)",
    "    if held == nil or held == wanted then",
    "      return false",
    "    end",
    "    local landed = Spring.GetTeamRulesParam(team, 'faction')",
    "    return not (landed and landed:lower():find(side:lower(), 1, true))",
    "  end",
    "",
    "  local line = '\\255\\255\\210\\90' .. note",
    "  function gadget:DrawScreen(vsx, vsy)",
    "    if not Spring.GetSpectatingState() and onAnotherSide() then",
    "      gl.Text(line, vsx / 2, vsy * 0.85, 22, 'co')",
    "    end",
    "  end",
    "  return",
    "end",
    "",
    "local allowed = {}",
    "for name in units:gmatch('%S+') do",
    "  allowed[name] = true",
    "end",
    "",
    "local locked = {}",
    "for unitDefID, def in pairs(UnitDefs) do",
    "  if not allowed[def.name] then",
    "    locked[unitDefID] = true",
    "  end",
    "end",
    "",
    "-- A game can switch a menu entry back on. SplinterFaction's tech gadget does",
    "-- it every 19 frames, so a locked entry stays off however a game edits it.",
    "local editCmdDesc = Spring.EditUnitCmdDesc",
    "function Spring.EditUnitCmdDesc(unitID, index, desc)",
    "  if desc.disabled == false and Spring.GetUnitTeam(unitID) == team then",
    "    local current = Spring.GetUnitCmdDescs(unitID, index, index)[1]",
    "    if current and current.id < 0 and locked[-current.id] then",
    "      desc.disabled = true",
    "    end",
    "  end",
    "  return editCmdDesc(unitID, index, desc)",
    "end",
    "",
    "-- The menu entry is only what the player sees. The two Allow call-ins below",
    "-- are what refuse the unit, so a game's own menu cannot get past them. A unit",
    "-- leaving the team goes back to what the start script's list says.",
    "local function holdBuildOptions(unitID, unitDefID, held)",
    "  for _, optionID in ipairs(UnitDefs[unitDefID].buildOptions) do",
    "    if locked[optionID] then",
    "      local index = Spring.FindUnitCmdDesc(unitID, -optionID)",
    "      if index then",
    "        editCmdDesc(unitID, index, {",
    "          disabled = held or UnitDefs[optionID].maxThisUnit <= 0,",
    "        })",
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "-- Written before any game spawns a start unit, which none does before GameStart.",
    "function gadget:Initialize()",
    "  if wanted then",
    "    Spring.SetTeamRulesParam(team, picker, wanted, { private = true })",
    "  end",
    "  for _, unitID in ipairs(Spring.GetTeamUnits(team)) do",
    "    holdBuildOptions(unitID, Spring.GetUnitDefID(unitID), true)",
    "  end",
    "end",
    "",
    "function gadget:UnitCreated(unitID, unitDefID, unitTeam)",
    "  if unitTeam == team then",
    "    holdBuildOptions(unitID, unitDefID, true)",
    "  end",
    "end",
    "",
    "function gadget:UnitGiven(unitID, unitDefID, newTeam, oldTeam)",
    "  if newTeam == team then",
    "    holdBuildOptions(unitID, unitDefID, true)",
    "  elseif oldTeam == team then",
    "    holdBuildOptions(unitID, unitDefID, false)",
    "  end",
    "end",
    "",
    "function gadget:AllowCommand(unitID, unitDefID, unitTeam, cmdID, cmdParams)",
    "  if unitTeam ~= team then",
    "    return true",
    "  end",
    "  -- An inserted order carries the real command as its second parameter.",
    "  if cmdID == CMD.INSERT then",
    "    cmdID = cmdParams[2]",
    "  end",
    "  return not (cmdID and cmdID < 0 and locked[-cmdID])",
    "end",
    "",
    "function gadget:AllowUnitCreation(unitDefID, builderID, builderTeam)",
    "  return builderTeam ~= team or not locked[unitDefID]",
    "end",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The launch config with the player's team held to `units`, for the gadget
 * above to read. A config whose first player has no team is a spectator's, with
 * nothing to limit. When `gameName` has a known picker and the run has a real
 * side, the team also starts on `side`. A Random side has no one side to hold,
 * and its limit already covers every faction.
 */
export function withPlayerUnits(
  config: BattleConfig,
  units: readonly string[],
  gameName: string,
  side: string | undefined,
): BattleConfig {
  const team = config.players[0]?.team;
  if (team === undefined || team === null) return config;
  const picker = PICKERS.find(({ game }) => game.test(gameName));
  return {
    ...config,
    modOptions: {
      ...config.modOptions,
      [TEAM_OPTION]: String(team),
      [UNITS_OPTION]: [...units].sort().join(" "),
      ...(picker && side && !/^random$/i.test(side)
        ? {
            [PICKER_OPTION]: picker.param,
            [SIDE_OPTION]: side,
            // The script ends a value at a semicolon, and a translation may use one.
            [SIDE_NOTE_OPTION]:
              t`This warpath's units belong to ${side}, so you can build little or nothing on another faction.`.replaceAll(
                ";",
                ",",
              ),
          }
        : {}),
    },
  };
}
