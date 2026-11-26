import type { CampaignVarsLaunch } from "../scenario/launch";
import type { Scenario } from "../scenario/model";
import { campaignMissionVarsRead } from "./bindings";
import type { ProgressFile } from "./model";

/**
 * A campaign's persistent vars, carried from one mission to the next (issue
 * #5294).
 *
 * In: the saved values travel as a modoption, see `CAMPAIGN_VARS_MODOPTION` in
 * `scenario/launch.ts`, because a mission a game ships cannot be rewritten per
 * launch.
 *
 * Out: the replay does not carry game rules params, so the runtime's unsynced
 * half writes the vars to a file in the engine's write directory, which is the
 * folder that holds the `demos/` folder the replay went into. The file names
 * the launch's token, and a file with any other token is one an earlier launch
 * left behind.
 *
 * Only a won mission saves its vars, see `applyVictory`.
 */

/** The saved values a campaign has, narrowed to finite numbers. */
export function savedVars(
  file: ProgressFile,
  campaignId: string,
): Record<string, number> {
  const saved = file.campaigns[campaignId]?.vars;
  const out: Record<string, number> = {};
  if (!saved || typeof saved !== "object") return out;
  for (const [name, value] of Object.entries(saved)) {
    if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
  }
  return out;
}

/**
 * What one launch of a scenario mission hands the runtime, or undefined for a
 * scenario that marks no var persistent: it has nothing to read and nothing to
 * save, so its start script stays the one it always was.
 *
 * Only the scenario's persistent vars are handed over. A saved value for a var
 * this mission declares but did not mark is left out, so it starts from the
 * scenario's own value.
 */
export function launchVars(
  scenario: Scenario,
  file: ProgressFile,
  campaignId: string,
  run: string,
): CampaignVarsLaunch | undefined {
  const names = scenario.persistentVars ?? [];
  if (names.length === 0) return undefined;
  const saved = savedVars(file, campaignId);
  const values: Record<string, number> = {};
  for (const name of names) {
    if (name in saved) values[name] = saved[name];
  }
  return { run, values };
}

/**
 * The persistent vars a mission ended with, from the file the runtime wrote,
 * or null when the file is not this launch's or cannot be read. Only names the
 * scenario marks persistent are kept.
 */
export function returnedVars(
  json: string,
  run: string,
  scenario: Scenario,
): Record<string, number> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { run?: unknown; vars?: unknown };
  if (record.run !== run) return null;
  if (!record.vars || typeof record.vars !== "object") return null;
  const marked = new Set(scenario.persistentVars ?? []);
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(record.vars)) {
    if (
      marked.has(name) &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Read back what a finished launch left its persistent vars at. Null when there
 * is no file beside the replay, or it is another launch's, which a win then
 * reads as nothing to save: the vars keep the values they had.
 */
export async function readReturnedVars(
  launch: CampaignVarsLaunch,
  scenario: Scenario,
  replayPath: string,
): Promise<Record<string, number> | null> {
  try {
    const { json } = await campaignMissionVarsRead({ replayPath });
    return json === null ? null : returnedVars(json, launch.run, scenario);
  } catch {
    return null;
  }
}
