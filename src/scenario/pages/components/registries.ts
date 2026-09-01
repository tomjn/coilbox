/**
 * The four parts of a scenario the map cannot draw and a trigger only points at:
 * objectives, dialogue lines, restrictions and variables.
 *
 * Arithmetic on plain values, so it can be tested without a browser. The panels
 * that show it are `ObjectivePanel.tsx`, `DialoguePanel.tsx`,
 * `RestrictionPanel.tsx` and `VarPanel.tsx`.
 *
 * An objective and a dialogue line each have an id that is minted once here and
 * then only read. It is what `complete_objective`, `fail_objective` and
 * `dialogue` point at, what the compiled mission is addressed by, and what a
 * mission problem names one by, so nothing in this file changes it (issue
 * #2248). What the author edits is the objective's text and the line's speaker
 * and words, which is what the lists and the trigger picker show anyway. Two
 * ids are never the same, because `parseScenario` refuses a document where they
 * are and the author would find their scenario gone off the list.
 *
 * A variable is the exception, and it is not one of these. A variable has no id
 * beside its name: the name is the key in `vars`, so renaming one has to rewrite
 * the triggers that read it, through {@link rewriteRefs} and the reference kind.
 * That rename takes what the scenario's game declares in its
 * `missions/extensions.lua`, so a reference held by a parameter of the game's
 * own is carried over with coilbox's (issue #913). Left out, only coilbox's own
 * parameters are rewritten, which is what a caller with no game to read has.
 */

import type { ExtensionTypes } from "../../extensions";
import { NO_EXTENSIONS } from "../../extensions";
import type {
  Scenario,
  ScenarioDialogue,
  ScenarioObjective,
} from "../../model";
import { markIdsUsed, nextMintedId } from "./ids";
import { rewriteRefs } from "./triggers";

/** Replace one entry of a registry by id. The list's own identity back when the
 *  id names nothing, so a caller can compare identities. */
function edit<T extends { id: string }>(
  list: T[],
  id: string,
  update: (entry: T) => T,
): T[] {
  const at = list.findIndex((entry) => entry.id === id);
  if (at < 0) return list;
  const out = list.slice();
  out[at] = update(list[at]);
  return out;
}

/**
 * Whether a new name can be written, or what is wrong with it in the words the
 * panel shows. Trimmed first, because a name of spaces reads as a name and loads
 * as one that is not empty but cannot be typed again.
 */
export function nameIssue(
  taken: Iterable<string>,
  wanted: string,
  self?: string,
): string | null {
  const name = wanted.trim();
  if (!name) return "Needs a name";
  if (name !== self && new Set(taken).has(name)) return "Already taken";
  return null;
}

/* -------------------------------------------------------------------------- *
 * Objectives.
 *
 * State reaches the player's panel as 0 active, 1 complete, -1 failed, and
 * `complete_objective` settles one once: the first outcome wins. A hidden
 * objective is one the panel leaves undrawn while its state is 0, so completing
 * or failing it is also what reveals it. None of that is stored, so the panel
 * says it instead.
 * -------------------------------------------------------------------------- */

/** One past the highest number the document has used, deleted objectives
 *  included, so a `complete_objective` left naming a deleted one never settles
 *  a different objective instead (issue #2250). */
export function nextObjectiveId(scenario: Scenario): string {
  return nextMintedId(scenario, "objective");
}

/** The document with one more objective on the end: primary, shown, and waiting
 *  for the text the panel types next. */
export function addObjective(scenario: Scenario, id: string): Scenario {
  const objective: ScenarioObjective = {
    id,
    kind: "primary",
    text: "",
    hidden: false,
  };
  return { ...scenario, objectives: [...scenario.objectives, objective] };
}

export function editObjective(
  scenario: Scenario,
  id: string,
  patch: Partial<Omit<ScenarioObjective, "id">>,
): Scenario {
  const objectives = edit(scenario.objectives, id, (o) => ({ ...o, ...patch }));
  return objectives === scenario.objectives
    ? scenario
    : { ...scenario, objectives };
}

/** The document without an objective. Triggers naming it are left alone, the
 *  way deleting a zone leaves them alone: the validator says so rather than the
 *  editor rewriting triggers nobody asked it to touch. The id goes with it and
 *  is not handed out again (issue #2250). */
export function removeObjective(scenario: Scenario, id: string): Scenario {
  const marked = markIdsUsed(scenario, "objective");
  const objectives = marked.objectives.filter((o) => o.id !== id);
  return objectives.length === marked.objectives.length
    ? scenario
    : { ...marked, objectives };
}

/* -------------------------------------------------------------------------- *
 * Dialogue.
 *
 * `portrait` and `audio` are bare file names in the scenario's own media folder,
 * minted by the import command, so nothing here invents one: it stores what came
 * back and clears what was dropped.
 * -------------------------------------------------------------------------- */

/** As {@link nextObjectiveId}, for the same reason: a `dialogue` action left
 *  naming a deleted line must not find a different line under that id. */
export function nextDialogueId(scenario: Scenario): string {
  return nextMintedId(scenario, "line");
}

export function addDialogue(scenario: Scenario, id: string): Scenario {
  const line: ScenarioDialogue = { id, speaker: "", text: "" };
  return { ...scenario, dialogue: [...scenario.dialogue, line] };
}

/**
 * One line's fields changed. A media field set to undefined is taken out
 * rather than stored empty, because `parseScenario` reads an empty file name as
 * no file at all and the two should not both exist in the document.
 */
export function editDialogue(
  scenario: Scenario,
  id: string,
  patch: Partial<Omit<ScenarioDialogue, "id">>,
): Scenario {
  const dialogue = edit(scenario.dialogue, id, (line) => {
    const next: ScenarioDialogue = { ...line, ...patch };
    if (!next.portrait) delete next.portrait;
    if (!next.audio) delete next.audio;
    return next;
  });
  return dialogue === scenario.dialogue ? scenario : { ...scenario, dialogue };
}

/** The document without a line, its id kept out of reach the way
 *  {@link removeObjective} keeps an objective's. */
export function removeDialogue(scenario: Scenario, id: string): Scenario {
  const marked = markIdsUsed(scenario, "line");
  const dialogue = marked.dialogue.filter((d) => d.id !== id);
  return dialogue.length === marked.dialogue.length
    ? scenario
    : { ...marked, dialogue };
}

/** The clips one line holds, for deleting them off disk when the line goes. */
export function dialogueMedia(line: ScenarioDialogue): string[] {
  return [line.portrait, line.audio].filter((f): f is string => !!f);
}

/**
 * Whether the editor can draw a portrait, which is a different question from
 * whether the engine can load one.
 *
 * DDS is the format a game's own art is usually shipped in, because it reaches
 * the GPU still compressed, and the engine reads it. No webview decodes one, so
 * an `img` pointed at a DDS fails and the panel reported that as a file it could
 * not read back, which is a lie about a perfectly good portrait (issue #942).
 * The file is stored and handed to the mission either way. Only the preview
 * stands down, and it says why.
 */
export function portraitDrawable(file: string): boolean {
  return !file.toLowerCase().endsWith(".dds");
}

/* -------------------------------------------------------------------------- *
 * Variables.
 *
 * Numbers only, deliberately, so `add_var` always has something to add to. A
 * variable a trigger reads but nothing declares is 0 and is reported once, so
 * declaring one is about saying what it starts at rather than about making it
 * exist.
 * -------------------------------------------------------------------------- */

/** A name no variable has taken. Plain rather than hyphenated, because a
 *  variable reads as a name in a condition rather than as an id in a list. */
export function nextVarName(vars: Record<string, number>): string {
  for (let n = 1; ; n++) {
    const name = `var${n}`;
    if (!(name in vars)) return name;
  }
}

/** The document with one more variable. Unchanged when the name is empty or
 *  already declared, because the second would quietly overwrite the first. */
export function addVar(scenario: Scenario, name: string, value = 0): Scenario {
  const wanted = name.trim();
  if (!wanted || wanted in scenario.vars) return scenario;
  return { ...scenario, vars: { ...scenario.vars, [wanted]: value } };
}

/** One variable's starting value. A value that is not a finite number is not
 *  written: `parseVars` drops one silently, which would take the declaration
 *  with it and leave every trigger reading the variable at 0. */
export function setVar(
  scenario: Scenario,
  name: string,
  value: number,
): Scenario {
  if (!(name in scenario.vars) || !Number.isFinite(value)) return scenario;
  if (scenario.vars[name] === value) return scenario;
  return { ...scenario, vars: { ...scenario.vars, [name]: value } };
}

/**
 * A variable under a different name, with every trigger that read or set it
 * carried over. The key keeps its place in the record, so renaming one does not
 * shuffle the list the panel is showing.
 */
export function renameVar(
  scenario: Scenario,
  from: string,
  to: string,
  extensions: ExtensionTypes = NO_EXTENSIONS,
): Scenario {
  const wanted = to.trim();
  if (!wanted || wanted === from) return scenario;
  if (!(from in scenario.vars) || wanted in scenario.vars) return scenario;
  const vars: Record<string, number> = {};
  for (const [name, value] of Object.entries(scenario.vars)) {
    vars[name === from ? wanted : name] = value;
  }
  return {
    ...rewriteRefs(scenario, "varName", from, wanted, extensions),
    vars,
  };
}

/** The document without a variable. Triggers naming it are left alone, and read
 *  it as 0 the way an undeclared variable always has. */
export function removeVar(scenario: Scenario, name: string): Scenario {
  if (!(name in scenario.vars)) return scenario;
  const vars = { ...scenario.vars };
  delete vars[name];
  return { ...scenario, vars };
}

/* -------------------------------------------------------------------------- *
 * Restrictions.
 *
 * These are the runtime's, not the engine's `[RESTRICT]` block, so `unlock_unit`
 * can lift one mid-mission. They bind every team the scenario declares, because
 * the data names no team: an author who wants a rule for the player alone writes
 * the restriction and unlocks the def for everyone else.
 * -------------------------------------------------------------------------- */

/** What the buildable list means, plus the "no rule at all" the panel offers as
 *  a third choice so clearing it is one pick rather than emptying a list. */
export type BuildableMode = "none" | "allow" | "deny";

export function buildableMode(scenario: Scenario): BuildableMode {
  return scenario.restrictions.buildable?.mode ?? "none";
}

/** The buildable rule's mode, keeping the units already listed so an author can
 *  flip an allow list into a deny list without picking them all again. */
export function setBuildableMode(
  scenario: Scenario,
  mode: BuildableMode,
): Scenario {
  const restrictions = { ...scenario.restrictions };
  if (mode === "none") delete restrictions.buildable;
  else {
    restrictions.buildable = {
      mode,
      units: scenario.restrictions.buildable?.units ?? [],
    };
  }
  return { ...scenario, restrictions };
}

/** One more unit def in the buildable list. A def already listed changes
 *  nothing, and an empty one is not a def. Adding to a scenario with no rule
 *  yet starts a deny list, which is the one that reads as "not this". */
export function addBuildableUnit(scenario: Scenario, def: string): Scenario {
  const wanted = def.trim();
  if (!wanted) return scenario;
  const buildable = scenario.restrictions.buildable ?? {
    mode: "deny" as const,
    units: [],
  };
  if (buildable.units.includes(wanted)) return scenario;
  return {
    ...scenario,
    restrictions: {
      ...scenario.restrictions,
      buildable: { ...buildable, units: [...buildable.units, wanted] },
    },
  };
}

export function removeBuildableUnit(scenario: Scenario, def: string): Scenario {
  const buildable = scenario.restrictions.buildable;
  if (!buildable?.units.includes(def)) return scenario;
  return {
    ...scenario,
    restrictions: {
      ...scenario.restrictions,
      buildable: {
        ...buildable,
        units: buildable.units.filter((u) => u !== def),
      },
    },
  };
}

/**
 * A withheld engine command. Lower cased, because the runtime resolves one
 * through `CMD[name:upper()]` and two spellings of `selfd` in the list would
 * withhold the same command twice.
 */
export function addCommand(scenario: Scenario, name: string): Scenario {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return scenario;
  const commands = scenario.restrictions.commands ?? [];
  if (commands.includes(wanted)) return scenario;
  return {
    ...scenario,
    restrictions: { ...scenario.restrictions, commands: [...commands, wanted] },
  };
}

/** A command withheld no longer. The last one takes the empty list with it, so
 *  a scenario that restricts nothing carries nothing. */
export function removeCommand(scenario: Scenario, name: string): Scenario {
  const commands = scenario.restrictions.commands;
  if (!commands?.includes(name)) return scenario;
  const rest = commands.filter((c) => c !== name);
  const restrictions = { ...scenario.restrictions };
  if (rest.length) restrictions.commands = rest;
  else delete restrictions.commands;
  return { ...scenario, restrictions };
}

/** What is wrong with the buildable rule as it stands, or null. An allow list
 *  with nothing on it forbids every unit in the game, which is a mission nobody
 *  meant to write. */
export function buildableWarning(scenario: Scenario): string | null {
  const buildable = scenario.restrictions.buildable;
  if (!buildable || buildable.units.length > 0) return null;
  return buildable.mode === "allow"
    ? "Nothing is on the list, so no team the scenario declares can build anything."
    : "Nothing is on the list, so this rule does nothing.";
}
