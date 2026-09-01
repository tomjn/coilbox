import type { SkirmishDraft } from "../play/drafts";
import { initialParticipants } from "../play/participants";
import {
  SCENARIO_RUNTIME_VERSION,
  SCENARIO_SCHEMA_VERSION,
  type Scenario,
} from "./model";

/**
 * Minting a new scenario document. Kept out of the page so the shape a fresh
 * scenario starts life in is testable, and so the editor and any later caller
 * (a campaign mission attaching one, issue #768) agree on it.
 */

/**
 * A fresh scenario id. A UUID is hex and hyphens, which is exactly the
 * `[A-Za-z0-9-]+` the storage plugin enforces on the file name it writes, so the
 * name the author types never has to become a path.
 */
export function newScenarioId(): string {
  return crypto.randomUUID();
}

/**
 * A new, empty scenario. The setup starts as the skirmish launcher's own
 * default, you plus one AI with no game or map yet, because `setup` is a
 * {@link SkirmishDraft} and the author picks a preset next. It is built here
 * rather than copied from `defaultSkirmishDraft` so each scenario owns its
 * participants, and so this module stays free of the frame's settings hooks.
 * Timestamps are left empty for `saveScenario` to stamp.
 */
export function newScenario(name: string, description = ""): Scenario {
  const setup: SkirmishDraft = {
    participants: initialParticipants(),
    gameName: "",
    mapName: "",
    startPosType: 0,
    modOptionValues: {},
  };
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: newScenarioId(),
    name,
    description,
    runtimeVersion: SCENARIO_RUNTIME_VERSION,
    setup,
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    blueprints: [],
    bases: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * How long the starter's mission runs before it is won, in seconds. A round
 * number the author is meant to change, not a measurement of anything.
 */
const STARTER_SECONDS = 300;

/**
 * A scenario with a mission already in it, for an author who has never written
 * one (issue #2183).
 *
 * What it holds is settled by the two functions that judge a scenario. `isSetUp`
 * in `listing.ts` says a scenario needs a game and a map to be launchable, and
 * neither can be guessed here: the games are whatever this machine has installed
 * and the map is the author's first real decision. So the starter is a Draft
 * exactly as `newScenario` is, and everything else it holds is coherent by
 * `validate.ts`, which `create.test.ts` proves against the compiled document.
 *
 * That rules out most content. Every actor, group and base names a unit type,
 * which is checked against the game's own unit list, so a template that placed
 * one would be an error on every game but the one it was written for. Every
 * placement also carries a position, which is checked against the map, and a
 * zone drawn before a map is picked is a box over nothing. Both are the author's
 * to make once the setup is filled in.
 *
 * What is left is the loop that makes a scenario a mission rather than a
 * skirmish: an objective the player is given, a radio message that tells them
 * about it, and the triggers that play the one and complete the other. Those
 * reference each other by id and nothing outside the document, so the starter is
 * a mission that plays and can be won the moment a game and a map are named.
 */
export function starterScenario(name: string, description = ""): Scenario {
  const scenario = newScenario(name, description);
  return {
    ...scenario,
    objectives: [
      {
        id: "hold-out",
        kind: "primary",
        text: "Hold out for five minutes.",
        hidden: false,
      },
    ],
    dialogue: [
      {
        id: "briefing",
        speaker: "Command",
        text: "Hold this position. We will come for you in five minutes.",
      },
    ],
    triggers: [
      {
        id: "briefing",
        enabled: true,
        repeat: false,
        conditions: {
          op: "all",
          conditions: [{ type: "time_elapsed", params: { seconds: 1 } }],
        },
        actions: [{ type: "dialogue", params: { line: "briefing" } }],
      },
      {
        id: "held-out",
        enabled: true,
        repeat: false,
        conditions: {
          op: "all",
          conditions: [
            { type: "time_elapsed", params: { seconds: STARTER_SECONDS } },
          ],
        },
        actions: [
          { type: "complete_objective", params: { objective: "hold-out" } },
          { type: "victory", params: {} },
        ],
      },
    ],
  };
}
