/**
 * A tweak project: the five stores under a name, saved, listed and shared
 * (issue #1282).
 *
 * Until now the edits lived in `UnitPage.tsx` and died with the page. Five
 * `useState` maps, each keyed by game, each with its own fifteen line reducer
 * that dropped a game when its entry emptied. The five reducers said the same
 * thing five times and there was nowhere to put a sixth store without saying it
 * again.
 *
 * {@link GameEdits} holds the five side by side, so the per game keying and the
 * dropping happen once, in {@link ModProject}. What it deliberately is not is a
 * merged store. Each of the five keeps its own module, its own type and its own
 * functions, and {@link editSlot} is the only way in: it takes the slot's name
 * and an updater typed to that slot alone, so a build menu operation cannot be
 * written into the override set even by accident. The compiler enforces the
 * separation the five stores used to get from being five variables.
 *
 * A project is scoped to one game, which is what every one of the five stores
 * was already scoped to (issue #2664). An override is a patch against one
 * game's own unit table and says nothing about another game's unit of the same
 * name, a build menu operation names units out of one game's table, and a copy
 * is a definition taken out of one. So "which game" is a property of the
 * project rather than a key inside it, and the page holds one project per game
 * rather than one project holding several games.
 *
 * It records {@link ModProject.authoredChecksum}, unitsync's checksum for the
 * game's archives when the project was started. That is a fact about what the
 * edits were written against, not a lock: a project whose game has moved on
 * still opens and still edits. Working out which edits a game update actually
 * broke is issue #1281, and it needs this field to exist. Nothing here tries to
 * do its job.
 *
 * Persisted through the frame settings store, and exported through the same
 * canonical container every other shareable coilbox artefact uses
 * (`src/container/container.ts`, issue #479). `src/play/presets.ts` is the
 * named-collection pattern this follows, down to writing `gameName` beside the
 * shared `game` identity.
 */
import { useSetting } from "@picoframe/frame";
import {
  asContainer,
  CONTAINER_VERSION,
  decodeContainerText,
  encodeContainerCode,
  encodeContainerJson,
} from "../container/container";
import {
  type GameIdentity,
  gameIdentityForName,
  type InstalledGameInfo,
  parseGameIdentity,
} from "../container/gameIdentity";
import { MAX_CODE_LENGTH } from "../deeplink/parse";
import { readStoredSetting, updateStoredSetting } from "../lib/storedSetting";
import type { BuildMenuOp, BuildMenus } from "./buildMenus";
import { buildMenuOpCount } from "./buildMenus";
import type { UnitClone, UnitClones } from "./clones";
import type { DisabledUnits } from "./disabled";
import type { UnitOverrides } from "./overrides";
import { overrideCount } from "./overrides";
import type { ReadOnlyLuaBlock } from "./readOnlyLua";
import type { TextField, UnitTextEdits } from "./unitText";
import { BASE_LANGUAGE, textEditCount } from "./unitText";

/** Payload schema version for a tweak project container. */
export const MOD_PROJECT_KIND_VERSION = 1;

/** Where the project list is kept in the frame settings store. */
export const PROJECTS_KEY = "workshop.projects";

/**
 * Everything one project changes about one game.
 *
 * Five stores, not one table. Each is defined and reasoned about in its own
 * module and none of them can express what another one holds:
 *
 *  - `overrides` is the sparse patch set against the game's unit table.
 *  - `clones` is whole definitions the project adds.
 *  - `menus` is ordered operations replayed over a builder's own list.
 *  - `text` is name and description for a game that keeps them in a
 *    localisation file rather than in its unitdefs.
 *  - `disabled` is a mark against a unit, and never an edit to anything.
 */
export interface GameEdits {
  overrides: UnitOverrides;
  clones: UnitClones;
  menus: BuildMenus;
  text: UnitTextEdits;
  disabled: DisabledUnits;
}

/**
 * A project that changes nothing.
 *
 * One shared value rather than a fresh object per call, so a page holding no
 * project does not re-derive everything it reads on every render. Nothing here
 * mutates, every store returns a new value, so sharing it is safe.
 */
export const EMPTY_EDITS: GameEdits = {
  overrides: {},
  clones: {},
  menus: {},
  text: {},
  disabled: [],
};

/** Whether a slot holds anything at all, whichever of the five it is. */
function slotIsEmpty(value: GameEdits[keyof GameEdits]): boolean {
  return Array.isArray(value)
    ? value.length === 0
    : Object.keys(value).length === 0;
}

/** Whether the project records nothing about the game. */
export function isEmptyEdits(edits: GameEdits): boolean {
  return (
    slotIsEmpty(edits.overrides) &&
    slotIsEmpty(edits.clones) &&
    slotIsEmpty(edits.menus) &&
    slotIsEmpty(edits.text) &&
    slotIsEmpty(edits.disabled)
  );
}

/**
 * Change exactly one of the five stores.
 *
 * The one write path, and the reason the five stores can share a container
 * without becoming one. `K` binds the slot name to the slot's own type, so
 * `editSlot(edits, "disabled", update)` will only take an updater over a
 * `DisabledUnits`, and the sorted key list a disabled set holds can never end
 * up where an override table is read.
 *
 * Returns the object it was given when the store handed back what it already
 * had, which every one of the five does for an edit that says nothing. That is
 * what lets the caller tell a real change from a no-op without comparing
 * anything, and it is how the undo stack avoids recording a step that did not
 * happen.
 */
export function editSlot<K extends keyof GameEdits>(
  edits: GameEdits,
  slot: K,
  update: (current: GameEdits[K]) => GameEdits[K],
): GameEdits {
  const next = update(edits[slot]);
  if (next === edits[slot]) return edits;
  return { ...edits, [slot]: next };
}

/** How much a project changes, in the four numbers the page counts. */
export interface EditCounts {
  /** Fields the user set, wherever the edit landed. */
  fields: number;
  /** Units the project adds. */
  added: number;
  /** Build menu operations, across every builder. */
  menuOps: number;
  /** Units switched off. */
  off: number;
}

export function editCounts(edits: GameEdits): EditCounts {
  return {
    fields: overrideCount(edits.overrides) + textEditCount(edits.text),
    added: Object.keys(edits.clones).length,
    menuOps: buildMenuOpCount(edits.menus),
    off: edits.disabled.length,
  };
}

/** The counts as a sentence, for a header that says what is in the project. */
export function describeEdits(edits: GameEdits): string {
  const { fields, added, menuOps, off } = editCounts(edits);
  const parts = [
    fields > 0 && `${fields} change${fields === 1 ? "" : "s"}`,
    added > 0 && `${added} unit${added === 1 ? "" : "s"} added`,
    menuOps > 0 && `${menuOps} build menu edit${menuOps === 1 ? "" : "s"}`,
    off > 0 && `${off} unit${off === 1 ? "" : "s"} disabled`,
  ].filter((part): part is string => typeof part === "string");
  return parts.length === 0 ? "Nothing changed yet" : parts.join(", ");
}

/** A named set of edits against one game, as it is stored and as it is shared. */
export interface ModProject {
  /** Stable identity, because two projects may share a name. */
  id: string;
  name: string;
  /**
   * What the project is for, in the author's own words (issue #2707).
   *
   * Asked for when the project is started and shown on its card, so a list of
   * five projects against one game says which is which. Optional, and absent
   * rather than empty when nobody wrote one, because a project is worth
   * starting before you can say what it is.
   */
  description?: string;
  /** The game's exact archive name, which is what the page keys on. */
  gameName: string;
  /** The same game in the shape every container kind names one (issue #1335). */
  game?: GameIdentity;
  /**
   * unitsync's checksum for the game when the project was started.
   *
   * Absent when the read that opened the game could not be checksummed, which
   * is the same condition `useUnitDefs` refuses to cache on. A project with no
   * checksum simply cannot say whether its game has moved.
   */
  authoredChecksum?: string;
  /**
   * The version last written into a packaged `.sdz`'s `modinfo.lua` (issue
   * #1283). Bumped by the packaging drawer after every successful export and
   * never typed in by hand: two players on different builds of the same
   * archive name is a sync error, not an error message, so what matters is
   * only that the number keeps moving, not what it says. Absent for a
   * project that has never been packaged, in which case the drawer offers 1.
   *
   * Left out of the container payload (`modProjectPayload` below) and of
   * what an imported file can set: it is packaging history for this
   * machine, not something to carry across a share, and a project imported
   * fresh starts unpackaged even when the sender had already published a
   * build of it.
   */
  distributionVersion?: number;
  edits: GameEdits;
  /**
   * Lua the project carries but cannot edit (issue #1280). See
   * `readOnlyLua.ts` for why this sits beside `edits` rather than inside it.
   * Absent for every project started the ordinary way. Only a decoded tweak
   * import writes it, and nothing here offers a way to change one afterwards.
   */
  readOnlyLua?: ReadOnlyLuaBlock[];
  createdAt: string;
  updatedAt: string;
}

/** What a caller supplies. Identity and timestamps belong to the hook. */
export interface NewProject {
  name: string;
  description?: string;
  gameName: string;
  game?: GameIdentity;
  authoredChecksum?: string;
  edits?: GameEdits;
  readOnlyLua?: ReadOnlyLuaBlock[];
}

/** A name for a project nobody has named: the game, and which one it is. */
export function defaultProjectName(
  gameName: string,
  existing: readonly { name: string }[],
): string {
  const base = `${gameName} tweaks`;
  const taken = new Set(existing.map((p) => p.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * The saved projects, and everything that changes them.
 *
 * Every write folds over what is stored rather than over the list this render
 * holds, for the reason `updateStoredSetting` gives: the frame's setter takes a
 * value, so two writes before the next render would otherwise keep only the
 * last. Importing a file and opening what it produced is exactly that pair.
 */
export function useModProjects() {
  const [projects, setProjects] = useSetting<ModProject[]>(PROJECTS_KEY, []);

  const write = (change: (prev: ModProject[]) => ModProject[]) =>
    updateStoredSetting<ModProject[]>(PROJECTS_KEY, [], setProjects, change);

  /** Start a project and return it, so the caller can open what it made. */
  function createProject(input: NewProject): ModProject {
    const now = new Date().toISOString();
    const project: ModProject = {
      id: crypto.randomUUID(),
      name: input.name,
      ...(input.description?.trim()
        ? { description: input.description.trim() }
        : {}),
      gameName: input.gameName,
      ...(input.game ? { game: input.game } : {}),
      ...(input.authoredChecksum
        ? { authoredChecksum: input.authoredChecksum }
        : {}),
      edits: input.edits ?? EMPTY_EDITS,
      ...(input.readOnlyLua?.length ? { readOnlyLua: input.readOnlyLua } : {}),
      createdAt: now,
      updatedAt: now,
    };
    write((prev) => [project, ...prev]);
    return project;
  }

  /**
   * Change one project's edits, and hand back what the change was folded over.
   *
   * An updater rather than a value, because the value this render holds is a
   * render behind a write made earlier in the same pass. Making a copy of a unit
   * writes the copy and then selects it, and a page that folded over its own
   * render would lose one of a pair like that (issues #1371, #1374 and #1375
   * are three times this has cost something).
   *
   * `before` is what was actually folded over, so the undo stack records the
   * state the change was made from rather than the one on screen. `null` when
   * the updater changed nothing, which is how a no-op edit costs no undo step.
   *
   * The list keeps its order rather than moving the project to the front, which
   * every other named collection here does on save. Those are saved once and
   * reopened later. This is written to on every edit, and a list that reorders
   * itself under the cursor is a list nobody can click in.
   */
  function applyEdits(
    id: string,
    update: (current: GameEdits) => GameEdits,
  ): { before: GameEdits; after: GameEdits } | null {
    const now = new Date().toISOString();
    const changed: { before: GameEdits; after: GameEdits }[] = [];
    write((prev) => {
      const target = prev.find((p) => p.id === id);
      if (!target) return prev;
      const after = update(target.edits);
      if (after === target.edits) return prev;
      changed.push({ before: target.edits, after });
      return prev.map((p) =>
        p.id === id ? { ...p, edits: after, updatedAt: now } : p,
      );
    });
    return changed[0] ?? null;
  }

  /** Put a project's edits back to a state undo or redo produced. */
  function setEdits(id: string, edits: GameEdits) {
    applyEdits(id, () => edits);
  }

  /**
   * Record the version a packaged `.sdz` was just written with (issue
   * #1283). Always overwritten, unlike `recordAuthoredChecksum`: a project
   * can be packaged more than once, and each one has to move the number on
   * so the drawer never offers the version that was just shipped a second
   * time. `updatedAt` is left alone, the same way renaming does not touch
   * it: packaging is not an edit to the project.
   */
  function recordPackagedVersion(id: string, version: number) {
    write((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, distributionVersion: version } : p,
      ),
    );
  }

  /**
   * Record what the game checksummed to, for a project started before anything
   * had read the game (issue #2696).
   *
   * A project started from the list names a game nobody has opened, and reading
   * one takes long enough that the list must not wait for it. So the editor
   * fills the field in the first time it opens a project against a game it can
   * read, which is the first moment there is an answer and still before any edit
   * has been made.
   *
   * Only ever when the project has none. Overwriting one would erase the fact
   * {@link ModProject.authoredChecksum} exists to record, and hide from #1281
   * exactly the game update it is there to catch. `updatedAt` is left alone for
   * the same reason: this is not an edit to the project.
   */
  function recordAuthoredChecksum(id: string, checksum: string) {
    write((prev) =>
      prev.some((p) => p.id === id && p.authoredChecksum === undefined)
        ? prev.map((p) =>
            p.id === id ? { ...p, authoredChecksum: checksum } : p,
          )
        : prev,
    );
  }

  /**
   * Change what a project is called and what it says it is for (issue #2707).
   *
   * One call rather than a rename and a separate description setter, because
   * both come off the same form and a project half saved is a project the list
   * would draw twice.
   *
   * A blank name is no name, so it is left alone rather than saved. A blank
   * description is a description somebody deleted, so the field goes rather
   * than being kept as an empty string.
   *
   * `updatedAt` is untouched: what a project is called is not one of its edits,
   * and moving it to the front of the list for a rename would take it away from
   * wherever the eye last left it.
   */
  function updateProjectDetails(
    id: string,
    details: { name: string; description?: string },
  ) {
    const name = details.name.trim();
    const description = details.description?.trim() ?? "";
    if (!name) return;
    write((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const { description: _dropped, ...rest } = p;
        return { ...rest, name, ...(description ? { description } : {}) };
      }),
    );
  }

  /**
   * Copy a project under a new name, keeping the checksum it was authored
   * against: the copy was written against the same game as the original, and
   * saying otherwise would hide a game update from both of them.
   *
   * `updatedAt` is kept too, because it says when these edits last changed and
   * copying them changed none of them. It also keeps the copy from jumping in
   * front of the project you were working in, which is picked by that field.
   */
  function duplicateProject(id: string): ModProject | null {
    // Read from storage rather than from this render's list, so duplicating a
    // project that was imported a moment ago copies what was imported.
    const source = readStoredSetting<ModProject[]>(PROJECTS_KEY, []).find(
      (p) => p.id === id,
    );
    if (!source) return null;
    const copy: ModProject = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} copy`,
      createdAt: new Date().toISOString(),
    };
    write((prev) => [copy, ...prev]);
    return copy;
  }

  function removeProject(id: string) {
    write((prev) => prev.filter((p) => p.id !== id));
  }

  return {
    projects,
    createProject,
    applyEdits,
    setEdits,
    recordAuthoredChecksum,
    recordPackagedVersion,
    updateProjectDetails,
    duplicateProject,
    removeProject,
  };
}

/**
 * A saved project's name, straight from the settings store.
 *
 * For the breadcrumb, which has the route's id and no hook to read with. The
 * route param is an opaque uuid, so without this the crumb over the editor says
 * "Project" for every project. Anything that goes wrong reading the store, which
 * in practice means a test that never installed one, answers nothing and the
 * crumb falls back.
 */
export function cachedProjectName(id: string): string | undefined {
  try {
    return readStoredSetting<ModProject[]>(PROJECTS_KEY, []).find(
      (p) => p.id === id,
    )?.name;
  } catch {
    return undefined;
  }
}

/**
 * What a shared project's container payload holds.
 *
 * The identity and the timestamps go with it: a project is a document somebody
 * worked on, and when it was made is worth keeping across a share the way a
 * preset's timestamps are not. The importer mints a fresh id anyway, so nothing
 * downstream depends on the one carried here.
 *
 * What it deliberately does not hold is anything derived. Not the Lua the
 * project compiles to, which is produced from these edits and would go stale
 * the moment either the edits or the compiler changed. Not the game's own unit
 * table, which is the game's to ship and is exactly what the sparse override
 * set exists to avoid copying. Not the resolved build menus, which are the
 * game's list with the operations replayed over it. Not the undo history, which
 * belongs to a session.
 */
export interface ModProjectPayload {
  name: string;
  /** Optional, so a project saved before #2707 reads back unchanged and the
   *  kind version stays where it is. */
  description?: string;
  gameName: string;
  game?: GameIdentity;
  authoredChecksum?: string;
  edits: GameEdits;
  readOnlyLua?: ReadOnlyLuaBlock[];
  createdAt?: string;
  updatedAt?: string;
}

/** Wrap a project for sharing, naming its game the shared way (issue #1335). */
export function modProjectPayload(
  project: ModProject,
  installed: readonly InstalledGameInfo[] = [],
): ModProjectPayload {
  const game = project.game ?? gameIdentityForName(project.gameName, installed);
  return {
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    gameName: project.gameName,
    ...(game ? { game } : {}),
    ...(project.authoredChecksum
      ? { authoredChecksum: project.authoredChecksum }
      : {}),
    edits: project.edits,
    ...(project.readOnlyLua?.length
      ? { readOnlyLua: project.readOnlyLua }
      : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** A project as a `.json` file somebody can post in a thread. */
export function modProjectJson(
  project: ModProject,
  installed: readonly InstalledGameInfo[] = [],
): string {
  return encodeContainerJson(
    "mod-project",
    MOD_PROJECT_KIND_VERSION,
    modProjectPayload(project, installed),
  );
}

/** A file name for an exported project, from its name. */
export function modProjectFileName(project: ModProject): string {
  const slug =
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tweak-project";
  return `${slug}.json`;
}

/** A share code, or the measurement showing why the project is too big for one. */
export type ModProjectCode =
  | { ok: true; code: string }
  | { ok: false; length: number; limit: number };

/**
 * A project as a pasteable code, when one would survive the trip.
 *
 * Checked against {@link MAX_CODE_LENGTH}, the ceiling the deep-link parser
 * refuses above, rather than against the container's own inflate guard: a code
 * that inflates fine but is rejected on arrival is no use to whoever copied it.
 * A project holds whole unit definitions once it has copies in it, so this is a
 * payload that really can grow past the limit, and the only place the author
 * can still do something about it is here.
 */
export function modProjectCode(
  project: ModProject,
  installed: readonly InstalledGameInfo[] = [],
): ModProjectCode {
  const code = encodeContainerCode(
    "mod-project",
    MOD_PROJECT_KIND_VERSION,
    modProjectPayload(project, installed),
  );
  if (code.length > MAX_CODE_LENGTH)
    return { ok: false, length: code.length, limit: MAX_CODE_LENGTH };
  return { ok: true, code };
}

/** A plain object, or undefined for anything else. Untrusted input everywhere. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read an override set out of untrusted JSON.
 *
 * A unit whose patch has nothing left in it is dropped rather than kept as an
 * empty table, so a file written by hand, or by a build that let an empty entry
 * through, still loads as a sparse set. The values themselves are whatever the
 * game's fields are, so they are carried as they came.
 */
function parseOverrides(value: unknown): UnitOverrides {
  const source = asRecord(value);
  if (!source) return {};
  const out: UnitOverrides = {};
  for (const [unit, patch] of Object.entries(source)) {
    const fields = asRecord(patch);
    if (!fields || Object.keys(fields).length === 0) continue;
    out[unit] = { ...fields };
  }
  return out;
}

/**
 * Read the added units out of untrusted JSON.
 *
 * A `source` is required, which is what keeps a unit built in the lego builder
 * out of a project (issue #2651). That unit is a real `units/<name>.lua` file
 * in the game folder, read off the folder each time rather than held anywhere,
 * so it has an `origin` and no `source`. The page never writes one into the
 * project's own store, and requiring a `source` here means a file that somehow
 * carries one loads without it rather than pinning a stale copy of a definition
 * the game already owns.
 */
function parseClones(value: unknown): UnitClones {
  const source = asRecord(value);
  if (!source) return {};
  const out: UnitClones = {};
  for (const [key, raw] of Object.entries(source)) {
    const clone = asRecord(raw);
    const def = asRecord(clone?.def);
    if (!clone || !def) continue;
    if (typeof clone.source !== "string") continue;
    const parsed: UnitClone = {
      key,
      source: clone.source,
      replacesGameUnit: clone.replacesGameUnit === true,
      def,
    };
    out[key] = parsed;
  }
  return out;
}

/** One build menu operation, or undefined when it is not one of the three. */
function parseMenuOp(value: unknown): BuildMenuOp | undefined {
  const op = asRecord(value);
  if (!op || typeof op.unit !== "string") return undefined;
  if (op.op === "add") return { op: "add", unit: op.unit };
  if (op.op === "remove") return { op: "remove", unit: op.unit };
  if (op.op === "move" && (op.before === null || typeof op.before === "string"))
    return { op: "move", unit: op.unit, before: op.before };
  return undefined;
}

function parseMenus(value: unknown): BuildMenus {
  const source = asRecord(value);
  if (!source) return {};
  const out: BuildMenus = {};
  for (const [builder, raw] of Object.entries(source)) {
    if (!Array.isArray(raw)) continue;
    const ops = raw
      .map(parseMenuOp)
      .filter((op): op is BuildMenuOp => op !== undefined);
    if (ops.length > 0) out[builder] = ops;
  }
  return out;
}

/** The two fields out of one language's object, dropping anything else. */
function parseTextFields(value: unknown): Partial<Record<TextField, string>> {
  const fields = asRecord(value);
  if (!fields) return {};
  const entry: Partial<Record<TextField, string>> = {};
  if (typeof fields.name === "string") entry.name = fields.name;
  if (typeof fields.description === "string")
    entry.description = fields.description;
  return entry;
}

/**
 * The text store, by unit, then by language, then by field.
 *
 * A project saved before #2672 put the fields straight under the unit, and the
 * only file the worker read then was `language/en/units.json`, so those edits
 * are English edits and are lifted into the English bucket here. A string where
 * a language object belongs is what says which of the two shapes this is, so a
 * language whose code happened to be `name` would still be read correctly.
 */
function parseText(value: unknown): UnitTextEdits {
  const source = asRecord(value);
  if (!source) return {};
  const out: UnitTextEdits = {};
  for (const [unit, raw] of Object.entries(source)) {
    const languages = asRecord(raw);
    if (!languages) continue;
    const entry: Record<string, Partial<Record<TextField, string>>> = {};
    const legacy = parseTextFields(languages);
    for (const [code, fields] of Object.entries(languages)) {
      if (typeof fields === "string") continue;
      const parsed = parseTextFields(fields);
      if (Object.keys(parsed).length > 0) entry[code] = parsed;
    }
    if (Object.keys(legacy).length > 0)
      entry[BASE_LANGUAGE] = { ...legacy, ...entry[BASE_LANGUAGE] };
    if (Object.keys(entry).length > 0) out[unit] = entry;
  }
  return out;
}

/** Lowercased, de-duplicated and sorted, which is the shape `disabled.ts` keeps. */
function parseDisabled(value: unknown): DisabledUnits {
  if (!Array.isArray(value)) return [];
  const keys = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const key = entry.trim().toLowerCase();
    if (key) keys.add(key);
  }
  return [...keys].sort();
}

/**
 * Read the read-only Lua blocks out of untrusted JSON.
 *
 * Every field is required as a string, and an entry missing one is dropped
 * rather than patched with an empty string: a block with no `lua` is not a
 * block, and one with no `note` would show as read-only for a reason nobody
 * wrote down.
 */
function parseReadOnlyLua(value: unknown): ReadOnlyLuaBlock[] {
  if (!Array.isArray(value)) return [];
  const out: ReadOnlyLuaBlock[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (
      !record ||
      typeof record.title !== "string" ||
      typeof record.lua !== "string" ||
      typeof record.note !== "string"
    )
      continue;
    out.push({ title: record.title, lua: record.lua, note: record.note });
  }
  return out;
}

/** Read the five stores out of untrusted JSON, each validated on its own. */
export function parseGameEdits(value: unknown): GameEdits {
  const source = asRecord(value) ?? {};
  return {
    overrides: parseOverrides(source.overrides),
    clones: parseClones(source.clones),
    menus: parseMenus(source.menus),
    text: parseText(source.text),
    disabled: parseDisabled(source.disabled),
  };
}

/** What an imported file turned out to hold, ready for `createProject`. */
export interface ImportedProject extends NewProject {
  name: string;
  gameName: string;
  edits: GameEdits;
}

/**
 * Read a shared project out of a file's text or a pasted code, or `null` when
 * it is not one.
 *
 * Identity and timestamps are dropped on the way in, the same way
 * `parsePresetJson` drops them: the importer mints fresh ones, so importing the
 * same file twice makes two projects rather than one project and a collision.
 * The name is kept, because it is what the author called it.
 */
export function parseModProjectJson(text: string): ImportedProject | null {
  const parsed = decodeContainerText(text);
  const container = asContainer(parsed);
  if (!container) return null;
  if (container.kind !== "mod-project") return null;
  if (container.container > CONTAINER_VERSION) return null;
  if (container.kindVersion > MOD_PROJECT_KIND_VERSION) return null;

  const payload = asRecord(container.payload);
  if (!payload) return null;
  const game = parseGameIdentity(payload.game);
  const gameName =
    typeof payload.gameName === "string" ? payload.gameName : game?.name;
  if (!gameName) return null;
  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : `${gameName} tweaks`;
  const description =
    typeof payload.description === "string" ? payload.description.trim() : "";
  const readOnlyLua = parseReadOnlyLua(payload.readOnlyLua);
  return {
    name,
    ...(description ? { description } : {}),
    gameName,
    ...(game ? { game } : {}),
    ...(typeof payload.authoredChecksum === "string"
      ? { authoredChecksum: payload.authoredChecksum }
      : {}),
    edits: parseGameEdits(payload.edits),
    ...(readOnlyLua.length ? { readOnlyLua } : {}),
  };
}
