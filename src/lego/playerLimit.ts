/**
 * Holding one team to a list of units, for a warpath (issue #5005).
 *
 * The start script's `[RESTRICT]` section applies to every team, and a game's
 * own faction picker can move the player off the side that list was made for.
 * So the player's team also gets a gadget, which needs no knowledge of any
 * picker: it allows only the units named, whichever builder the player ends up
 * with. No other team is touched.
 *
 * The list travels in the start script rather than in the gadget. A replay
 * carries its script, so it keeps the list it was played with after later
 * unlocks, and an unlock does not rewrite the mutator or rescan the content.
 */

import type { BattleConfig } from "../play/bindings";

const TEAM_OPTION = "coilbox_player_team";
const UNITS_OPTION = "coilbox_player_units";

/** The gadget, which the plugin writes to `LuaRules/Gadgets/`. */
export function buildPlayerLimitGadget(): string {
  const lines = [
    "-- Holds one team to the units a warpath run has unlocked. The team and the",
    "-- units come from the start script's mod options, so a replay keeps its own.",
    "-- A game's faction picker cannot get around it, and other teams are untouched.",
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
    "if not gadgetHandler:IsSyncedCode() then",
    "  return false",
    "end",
    "",
    "local options = Spring.GetModOptions() or {}",
    `local team = tonumber(options.${TEAM_OPTION})`,
    `local units = options.${UNITS_OPTION}`,
    "if not team or not units then",
    "  return false",
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
    "function gadget:Initialize()",
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
 * nothing to limit.
 */
export function withPlayerUnits(
  config: BattleConfig,
  units: readonly string[],
): BattleConfig {
  const team = config.players[0]?.team;
  if (team === undefined || team === null) return config;
  return {
    ...config,
    modOptions: {
      ...config.modOptions,
      [TEAM_OPTION]: String(team),
      [UNITS_OPTION]: [...units].sort().join(" "),
    },
  };
}
