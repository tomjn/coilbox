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
