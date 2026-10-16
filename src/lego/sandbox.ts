/**
 * "Play with this unit" on the Test drawer (issue #3341).
 *
 * A skirmish where the built unit is already on the map, a few targets stand a
 * short way off and do not fight back, and a builder has the unit on its build
 * menu. It goes through coilbox's mission runtime, the way the workshop's
 * "Start with this unit on the map" does (`src/workshop/testMission.ts`): a
 * scenario generated in memory says who starts with what and where, and the
 * runtime and the compiled mission go into the scratch game beside the unit.
 *
 * Three things a scenario cannot say live in the scratch game instead:
 *
 * - The builder is the base game's own start unit, the first side's. The unit
 *   goes onto its build menu through `download/coilbox_sandbox.tdf`, which the
 *   engine's own `gamedata/unitdefs.lua` reads (`download_builds.lua` in its
 *   base content) after every unit file has loaded and before the game's
 *   post-processing runs. So no file of the game's is covered or copied, and the
 *   builder keeps its name, script and localised text.
 * - The targets hold fire and hold position. A scenario has no fire state, so
 *   the sandbox gadget sets it on every unit a team nobody plays gets. It holds
 *   the builder's fire too, or its own weapons would take the targets out
 *   before the unit being tested got the chance.
 * - A target that dies is replaced where it stood. A game ends a match when an
 *   ally team has nothing left, and the targets' team is otherwise empty the
 *   moment the last one dies.
 *
 * Nothing is written outside the scratch folder, so deleting it still undoes
 * everything (`docs/lego-builder.md`, "Test in game").
 */

import type { GameItem, StartPos } from "@/content/bindings";
import {
  loadUnitsyncMinimap,
  primeGameInfo,
  THUMB_MINIMAP_MIP,
} from "@/content/config";
import { isSdd } from "@/content/format";
import { initialParticipants, type Participant } from "@/play/participants";
import { compileScenario } from "@/scenario/compile";
import { newScenario } from "@/scenario/create";
import {
  installedRuntime,
  MISSION_MODOPTION,
  missionIssueMessage,
} from "@/scenario/launch";
import type { Point, Scenario } from "@/scenario/model";
import { isBlocking, validateCompiledMissionText } from "@/scenario/validate";
import { isValidUnitKey } from "@/workshop/clones";
import type { ScratchSandbox } from "./bindings";
import { SCRATCH_SIDE } from "./scratchGame";
import { luaString } from "./unitDef";

/**
 * The generated mission's folder in the scratch game. Fixed, so every launch
 * rewrites the one mission, and `[A-Za-z0-9-]+` as the writer requires.
 */
export const SANDBOX_MISSION_ID = "coilbox-lego-sandbox";

/**
 * The Lua message the sandbox gadget sends when `/luarules reload` has loaded it
 * again into a running game. Coilbox hears it through the engine's autohost
 * interface, and it is the only sign the reload finished (issue #3346).
 */
export const SANDBOX_LOADED_MESSAGE = "coilbox_sandbox:loaded";

/** The player's participant id in the scenario. */
export const SANDBOX_PLAYER = "player";

/** The targets' participant id: a team with no player and no AI on it. */
export const SANDBOX_TARGETS = "targets";

/** How many targets stand there. A chosen number, not a measured one. */
export const TARGET_COUNT = 3;

/**
 * How far from the player's start position the targets stand, in elmos. A
 * chosen value: far enough that the runtime's 64 elmo start grid for the unit
 * and the builder does not run into the targets' own, and close enough to be
 * on screen with them.
 */
export const TARGET_DISTANCE = 320;

/**
 * What the player's bank starts with, so the builder can build the unit. The
 * runtime empties a mission team's bank at game frame 1 unless the scenario
 * sets one. The engine clamps a bank to the team's storage, so a larger number
 * only means "full". The workshop's test uses the same value.
 */
const SANDBOX_BANK = 10000;

/** Fixed start positions, so the player is on the map's first start spot. */
const START_POS_FIXED = 0;

/** The sandbox's two participants: you, and an empty slot for the targets. */
export function sandboxParticipants(): Participant[] {
  const [you, other] = initialParticipants();
  return [
    { ...you, id: SANDBOX_PLAYER, side: SCRATCH_SIDE },
    // No `ai`, so the slot is empty: nothing plays this team.
    {
      ...other,
      id: SANDBOX_TARGETS,
      name: "Targets",
      ai: undefined,
      side: SCRATCH_SIDE,
    },
  ];
}

/** The mod options that turn the scratch game into the sandbox. */
export function sandboxModOptions(): Record<string, string> {
  return { [MISSION_MODOPTION]: SANDBOX_MISSION_ID };
}

/**
 * Where the targets stand: `TARGET_DISTANCE` from the map's first start spot,
 * towards its second, which is the way a map's players face each other. A map
 * with one spot points towards its middle instead, and one with none answers
 * null, because there is then nowhere the player is known to start.
 */
export function targetSpot(
  starts: StartPos[],
  size?: { width: number; height: number },
): { player: Point; targets: Point } | null {
  const [player, other] = starts;
  if (!player) return null;
  const towards =
    other ?? (size ? { x: size.width / 2, z: size.height / 2 } : null);
  const dx = towards ? towards.x - player.x : 1;
  const dz = towards ? towards.z - player.z : 0;
  const length = Math.hypot(dx, dz);
  const [ux, uz] = length > 0 ? [dx / length, dz / length] : [1, 0];
  return {
    player: { x: player.x, z: player.z },
    targets: {
      x: Math.round(player.x + ux * TARGET_DISTANCE),
      z: Math.round(player.z + uz * TARGET_DISTANCE),
    },
  };
}

/**
 * The sandbox scenario. The player starts with the unit and the builder and a
 * full bank, and the game's own start is suppressed for both teams, so a game
 * that honours that gives nobody a second unit. The targets are a group of the
 * unit itself, which is the one unit every scratch game is known to load, so
 * the sandbox needs nothing more from the game than its builder.
 */
export function buildSandboxScenario(opts: {
  unitName: string;
  /** The base game's builder, or null when it has none to offer. */
  builder: string | null;
  gameName: string;
  mapName: string;
  targets: Point;
}): Scenario {
  const { unitName, builder, gameName, mapName, targets } = opts;
  const scenario = newScenario(`Play with ${unitName}`);
  return {
    ...scenario,
    id: SANDBOX_MISSION_ID,
    setup: {
      participants: sandboxParticipants(),
      gameName,
      mapName,
      startPosType: START_POS_FIXED,
      modOptionValues: {},
    },
    teams: {
      [SANDBOX_PLAYER]: {
        startUnits: builder ? [unitName, builder] : [unitName],
        resources: { metal: SANDBOX_BANK, energy: SANDBOX_BANK },
        noCommander: true,
      },
      [SANDBOX_TARGETS]: { noCommander: true },
    },
    groups: [
      {
        id: SANDBOX_TARGETS,
        team: SANDBOX_TARGETS,
        units: [{ def: unitName, count: TARGET_COUNT }],
        pos: targets,
        orders: [],
        dormant: false,
      },
    ],
  };
}

/**
 * The scratch game's `download/coilbox_sandbox.tdf`, which puts the unit on the
 * builder's build menu. Written with no entry when there is no builder, so the
 * scratch game holds the same files whichever game it is built on.
 *
 * TDF has no quoting, so a name that is not a plain unit key is refused rather
 * than written into a file it could break.
 */
export function buildDownloadMenu(
  builder: string | null,
  unitName: string,
): string {
  const header = [
    "// Puts the unit coilbox's builder exported on a builder's build menu.",
    "// Rewritten on every sandbox launch. Delete this folder to undo it.",
  ];
  if (!builder) return `${header.join("\n")}\n`;
  for (const name of [builder, unitName]) {
    if (!isValidUnitKey(name.toLowerCase())) {
      throw new Error(`${name} cannot go on a build menu.`);
    }
  }
  const lines = [
    ...header,
    "",
    "[MENUENTRY1]",
    "{",
    `\tunitmenu=${builder};`,
    `\tunitname=${unitName};`,
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The scratch game's sandbox gadget. It does nothing unless the start script
 * names the sandbox mission, so a plain Test in game or load check on the same
 * scratch game is unaffected.
 *
 * Which team the targets are on is not passed in: it is every team other than
 * Gaia that no player is playing, which is how the runtime itself tells a
 * player's team from the rest.
 */
export function buildSandboxGadget(builder: string | null): string {
  const lines = [
    "-- Holds the sandbox's targets still and replaces any that die.",
    "-- Rewritten on every sandbox launch. Delete this folder to undo it.",
    "",
    "function gadget:GetInfo()",
    "  return {",
    '    name = "Coilbox sandbox",',
    '    desc = "Holds the sandbox\'s targets still and replaces any that die.",',
    '    author = "coilbox",',
    "    layer = 1001,",
    "    enabled = true,",
    "  }",
    "end",
    "",
    `if (Spring.GetModOptions() or {})[${luaString(MISSION_MODOPTION)}] ~= ${luaString(SANDBOX_MISSION_ID)} then`,
    "  return false",
    "end",
    "",
    "if not gadgetHandler:IsSyncedCode() then",
    "  -- Loaded past frame 0 only by `/luarules reload`, which coilbox waits on.",
    "  function gadget:Initialize()",
    "    if Spring.GetGameFrame() > 0 then",
    `      Spring.SendLuaRulesMsg(${luaString(SANDBOX_LOADED_MESSAGE)})`,
    "    end",
    "  end",
    "  return",
    "end",
    "",
    `local BUILDER = ${builder ? luaString(builder) : "nil"}`,
    "local HOLD = 0",
    "",
    "local builderDefID = BUILDER and UnitDefNames[BUILDER] and UnitDefNames[BUILDER].id",
    "local played",
    "",
    "-- The teams a player is on. Read on first use, once the players are known.",
    "local function playedTeams()",
    "  if not played then",
    "    played = {}",
    "    for _, playerID in ipairs(Spring.GetPlayerList() or {}) do",
    "      local _, _, spectator, teamID = Spring.GetPlayerInfo(playerID, false)",
    "      if not spectator and teamID then",
    "        played[teamID] = true",
    "      end",
    "    end",
    "  end",
    "  return played",
    "end",
    "",
    "local function isTargets(teamID)",
    "  return teamID ~= Spring.GetGaiaTeamID() and not playedTeams()[teamID]",
    "end",
    "",
    "function gadget:UnitCreated(unitID, unitDefID, teamID, builderID)",
    "  if isTargets(teamID) then",
    "    Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { HOLD }, 0)",
    "    Spring.GiveOrderToUnit(unitID, CMD.MOVE_STATE, { HOLD }, 0)",
    "  elseif unitDefID == builderDefID and not builderID then",
    "    Spring.GiveOrderToUnit(unitID, CMD.FIRE_STATE, { HOLD }, 0)",
    "  end",
    "end",
    "",
    "function gadget:UnitDestroyed(unitID, unitDefID, teamID)",
    "  if not isTargets(teamID) then",
    "    return",
    "  end",
    "  local _, _, isDead = Spring.GetTeamInfo(teamID, false)",
    "  local _, _, _, _, buildProgress = Spring.GetUnitHealth(unitID)",
    "  if isDead or (buildProgress and buildProgress < 1) then",
    "    return",
    "  end",
    "  local x, y, z = Spring.GetUnitPosition(unitID)",
    "  if x then",
    "    Spring.CreateUnit(unitDefID, x, y, z, Spring.GetUnitBuildFacing(unitID) or 0, teamID)",
    "  end",
    "end",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Read what the sandbox needs from the base game and the map, and generate
 * every file it adds to the scratch game. Throws with a reason a person can act
 * on.
 *
 * The builder is the base game's first side's start unit. The scratch game's
 * own side data replaces the base game's, so this has to be read from the base
 * game rather than from the scratch game.
 */
export async function prepareSandbox(opts: {
  enginePath: string;
  dataDir: string;
  game: GameItem;
  mapName: string;
  unitName: string;
}): Promise<{ sandbox: ScratchSandbox; scenario: Scenario }> {
  const { enginePath, dataDir, game, mapName, unitName } = opts;
  const [info, minimap] = await Promise.all([
    primeGameInfo(enginePath, dataDir, game.primaryArchive.name),
    loadUnitsyncMinimap(enginePath, dataDir, mapName, THUMB_MINIMAP_MIP),
  ]);
  const builder = info.sides.find((side) => side.startUnit)?.startUnit ?? null;
  const spot = targetSpot(
    minimap.startPositions,
    minimap.widthElmos && minimap.heightElmos
      ? { width: minimap.widthElmos, height: minimap.heightElmos }
      : undefined,
  );
  if (!spot) {
    throw new Error(
      `${mapName} has no start positions, so there is nowhere to put the targets. Pick another map.`,
    );
  }

  const scenario = buildSandboxScenario({
    unitName,
    builder,
    gameName: game.name,
    mapName,
    targets: spot.targets,
  });
  const mission = compileScenario(scenario);
  // The unit list is left out on purpose: the built unit is not in the base
  // game's own list.
  const blocking = (await validateCompiledMissionText(mission)).filter(
    isBlocking,
  );
  if (blocking.length > 0) {
    throw new Error(missionIssueMessage("author", blocking));
  }
  const root = game.primaryArchive.path;
  const installed = root
    ? await installedRuntime(root, isSdd(game.primaryArchive))
    : null;
  return {
    scenario,
    sandbox: {
      download: buildDownloadMenu(builder, unitName),
      gadget: buildSandboxGadget(builder),
      missionId: SANDBOX_MISSION_ID,
      mission,
      shipRuntime: installed === null || installed < scenario.runtimeVersion,
    },
  };
}
