/**
 * Which of a project's edits the game has stopped agreeing with (issue #1281).
 *
 * Nothing in this ecosystem pins a version. A tweak names BAR units and mod
 * options directly and carries no compatibility range, so the coping strategy
 * everywhere else is that a maintainer patches when the game breaks and
 * everybody regenerates. A blob saved six months ago is a coin flip and nothing
 * tells you which side it landed on.
 *
 * Coilbox can tell, because the game is on this machine and the page has
 * already read every definition in it. So this is a comparison and not a
 * download: every unit key, weapon mount and field path the project names is
 * looked up in the definitions the editor is already holding, and what comes
 * back is the list of names that no longer find anything.
 *
 * Two severities and not one, for the reason `preflight.rs` keeps three. A
 * `broken` finding names something that is simply not there, so the edit lands
 * on nothing and the project does not do what it says. A `review` finding still
 * lands, but on something that has moved underneath it, and only the author can
 * say whether it still means what they meant. Rendering the two together would
 * teach people to skim past both.
 *
 * The harder half is what to do with the answer, and the rule here is that
 * coilbox offers to remove a reference only when it can say exactly what that
 * costs. So {@link CompatFix} carries the cost as a sentence, every offer is
 * against one finding, and there is deliberately no button that fixes
 * everything: a project with forty findings has thirty of them worth keeping
 * until a human has looked. Where the right answer needs a decision coilbox
 * cannot make - a copy whose parent unit has gone, a copy that now collides
 * with a unit the game has added - there is no offer at all and the finding
 * says so.
 *
 * Renames are not guessed. Coilbox has the game as it is now and nothing of the
 * game as it was, so "armcom is gone" and "armcom was renamed" look identical
 * from here, and a suggestion built out of name similarity would be a guess
 * wearing a fix's clothing. The finding says the unit is gone and leaves the
 * matching to the person who knows.
 */
import type { BuildMenuOp, BuildMenus } from "./buildMenus";
import type { UnitClone } from "./clones";
import { readPath } from "./overrides";
import type { GameEdits } from "./project";

/** How much a finding matters, in the two states a reference can be in. */
export type CompatSeverity =
  /** Names nothing in the game, so the edit lands on nothing. */
  | "broken"
  /** Still lands, but on something that has moved. Only the author can say. */
  | "review";

/**
 * What coilbox offers to do about one finding.
 *
 * Always removal of a reference and never a repair, because repairing means
 * knowing what the name became and coilbox has only today's game. `cost` is the
 * work that goes with it, written out in full even when it is none: an offer
 * whose price is not on it is how a check ends up quietly deleting an
 * afternoon's tuning.
 */
export interface CompatFix {
  /** What the button says. */
  label: string;
  /** What pressing it takes away, spelled out. */
  cost: string;
  apply: (edits: GameEdits) => GameEdits;
}

/** One thing the project names that the game no longer has. */
export interface CompatFinding {
  /** Stable within a report, so React can key on it and a test can name one. */
  id: string;
  /** Which of the five stores holds the reference. */
  store: keyof GameEdits;
  severity: CompatSeverity;
  /** The name that no longer holds, as the project spells it. */
  subject: string;
  /** What happened, in the words the page will show. */
  detail: string;
  /** The offer, when there is one whose cost can be stated. */
  fix?: CompatFix;
}

/** Everything that no longer holds, and how much of it is which. */
export interface CompatReport {
  findings: CompatFinding[];
  broken: number;
  review: number;
}

/** A report with nothing in it. Shared, so a clean check settles on one object. */
export const NO_COMPAT_FINDINGS: CompatReport = {
  findings: [],
  broken: 0,
  review: 0,
};

/** What the check is given: the project's edits, and the game as it is today. */
export interface CompatInput {
  edits: GameEdits;
  /** The game's own unit table, without the project's copies merged in. */
  units: Record<string, Record<string, unknown>>;
  /** The game's shared weapondef table, which unit mounts name. */
  weaponDefs: Record<string, Record<string, unknown>>;
  /** For the sentences, so a finding reads as being about a game. */
  gameName: string;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** Drop one key from a record, returning the record itself when it had none. */
function without<T>(table: Record<string, T>, key: string): Record<string, T> {
  if (!Object.hasOwn(table, key)) return table;
  const { [key]: _gone, ...rest } = table;
  return rest;
}

/**
 * The weapondef names one definition mounts, lowercased.
 *
 * `weapons` is a Lua array, so it normally arrives as one, but an empty table
 * has no `1..n` run and comes back as an object. Read the same way
 * {@link buildOptionsOf} reads `buildoptions`, for the same reason.
 */
function mountNames(def: Record<string, unknown>): string[] {
  const found = Object.entries(def).find(
    ([key]) => key.toLowerCase() === "weapons",
  );
  const raw = found?.[1];
  const list = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>)
      : [];
  const out: string[] = [];
  for (const mount of list) {
    if (mount === null || typeof mount !== "object") continue;
    const name = Object.entries(mount as Record<string, unknown>).find(
      ([key]) => key.toLowerCase() === "name",
    )?.[1];
    if (typeof name !== "string") continue;
    const lower = name.trim().toLowerCase();
    if (lower && !out.includes(lower)) out.push(lower);
  }
  return out;
}

/** The weapondefs a definition carries itself, lowercased. */
function ownWeaponDefs(def: Record<string, unknown>): Set<string> {
  const found = Object.entries(def).find(
    ([key]) => key.toLowerCase() === "weapondefs",
  );
  const raw = found?.[1];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return new Set();
  return new Set(
    Object.keys(raw as Record<string, unknown>).map((k) => k.toLowerCase()),
  );
}

/**
 * Whether a mount name still finds a weapondef.
 *
 * Three ways, because the games spell it three ways and a check that fires on a
 * spelling coilbox did not model is worse than no check at all. The shared
 * table is how a game that hoists its weapons out of the unit names them, and
 * how the engine names a unit's own ones once it has prefixed them with the
 * unit. A definition that carries the weapondef itself matches on the bare
 * name, and on the bare name behind any `<something>_` prefix, which is what a
 * copy of a unit ends up holding: the mount still says `armcom_armcomlaser`
 * while the copy's own table says `armcomlaser`.
 *
 * Deliberately permissive. Measured against the real definitions of Balanced
 * Annihilation V15.9.8 (379 units, 347 shared weapondefs, 305 mounts) and
 * Beyond All Reason test-30922-8064a43 (564 units, 858 shared weapondefs, 603
 * mounts) on 8 September 2026, every mount in both games resolves and nothing
 * is reported. So a finding out of this is a name that really has gone rather
 * than a shape this function did not know about.
 */
function mountResolves(
  name: string,
  own: Set<string>,
  shared: Set<string>,
): boolean {
  if (shared.has(name) || own.has(name)) return true;
  for (let at = name.indexOf("_"); at >= 0; at = name.indexOf("_", at + 1))
    if (own.has(name.slice(at + 1))) return true;
  return false;
}

/**
 * The path one step up, or null for a path with only one step.
 *
 * A single-step override sets a key on the unit itself, and the engine reads
 * plenty of keys a game leaves out, so "the game does not declare this" says
 * nothing about it. Everything deeper was reached through a table that the game
 * did declare, since the page builds its rows out of the definition in front of
 * it, so a parent that no longer resolves is the game having taken the table
 * away rather than the user having invented one.
 */
function parentPath(path: string): string | null {
  const at = path.lastIndexOf(".");
  return at < 0 ? null : path.slice(0, at);
}

/** Findings for units the project patches that the game no longer has. */
function overrideFindings(
  input: CompatInput,
  known: (key: string) => boolean,
  defOf: (key: string) => Record<string, unknown> | undefined,
): CompatFinding[] {
  const out: CompatFinding[] = [];
  for (const [unit, paths] of Object.entries(input.edits.overrides)) {
    const fields = Object.keys(paths);
    if (fields.length === 0) continue;
    if (!known(unit)) {
      out.push({
        id: `overrides:${unit}`,
        store: "overrides",
        severity: "broken",
        subject: unit,
        detail: `${input.gameName} has no unit called ${unit} any more, so ${plural(fields.length, "change")} here changes nothing.`,
        fix: {
          label: "Remove these changes",
          cost: `${plural(fields.length, "field")} you set on ${unit}`,
          apply: (edits) => ({
            ...edits,
            overrides: without(edits.overrides, unit),
          }),
        },
      });
      continue;
    }
    const def = defOf(unit);
    for (const path of fields) {
      const parent = parentPath(path);
      if (parent === null) continue;
      if (readPath(def, parent) !== undefined) continue;
      out.push({
        id: `overrides:${unit}:${path}`,
        store: "overrides",
        severity: "review",
        subject: `${unit}.${path}`,
        detail: `${unit} no longer has ${parent}, so the value set for ${path} is written into a table nothing reads.`,
        fix: {
          label: "Remove this change",
          cost: `the value you set for ${path}`,
          apply: (edits) => ({
            ...edits,
            overrides: {
              ...edits.overrides,
              [unit]: without(edits.overrides[unit] ?? {}, path),
            },
          }),
        },
      });
    }
  }
  return out;
}

/**
 * Findings for the units a project adds.
 *
 * None of them offer a fix. A copy owns its whole definition, so nothing here
 * is a dead reference that can be deleted: what has moved is the ground the
 * copy was made on, and the answers are renaming it, re-copying it or leaving
 * it, all of which need somebody who knows what the unit is for.
 */
function cloneFindings(
  input: CompatInput,
  shared: Set<string>,
): CompatFinding[] {
  const out: CompatFinding[] = [];
  for (const clone of Object.values(input.edits.clones) as UnitClone[]) {
    const inGame = Object.hasOwn(input.units, clone.key);
    if (clone.source !== undefined && !Object.hasOwn(input.units, clone.source))
      out.push({
        id: `clones:${clone.key}:source`,
        store: "clones",
        severity: "review",
        subject: clone.key,
        detail: `${clone.key} was copied from ${clone.source}, which ${input.gameName} no longer has. The copy still works, but it is now the only version of a unit the game has dropped.`,
      });
    if (!clone.replacesGameUnit && inGame)
      out.push({
        id: `clones:${clone.key}:collides`,
        store: "clones",
        severity: "broken",
        subject: clone.key,
        detail: `${input.gameName} now has a unit of its own called ${clone.key}, so this copy replaces it rather than adding a unit. Rename the copy if that is not what you want.`,
      });
    if (clone.replacesGameUnit && !inGame)
      out.push({
        id: `clones:${clone.key}:orphaned`,
        store: "clones",
        severity: "review",
        subject: clone.key,
        detail: `${clone.key} was made to stand in for ${input.gameName}'s own unit of that name, which the game no longer has. It now adds a unit instead of replacing one.`,
      });
    const own = ownWeaponDefs(clone.def);
    const lost = mountNames(clone.def).filter(
      (name) => !mountResolves(name, own, shared),
    );
    if (lost.length > 0)
      out.push({
        id: `clones:${clone.key}:weapons`,
        store: "clones",
        severity: "broken",
        subject: clone.key,
        detail: `${clone.key} mounts ${lost.join(", ")}, which ${input.gameName} no longer defines and the copy does not carry itself. Those weapons will not fire.`,
      });
  }
  return out;
}

/** Findings for build menus whose builder or contents have gone. */
function menuFindings(
  input: CompatInput,
  known: (key: string) => boolean,
): CompatFinding[] {
  const out: CompatFinding[] = [];
  for (const [builder, ops] of Object.entries(
    input.edits.menus as BuildMenus,
  )) {
    if (ops.length === 0) continue;
    if (!known(builder)) {
      out.push({
        id: `menus:${builder}`,
        store: "menus",
        severity: "broken",
        subject: builder,
        detail: `${input.gameName} has no unit called ${builder} any more, so ${plural(ops.length, "build menu change")} here changes nothing.`,
        fix: {
          label: "Remove this menu",
          cost: plural(ops.length, "build menu change"),
          apply: (edits) => ({
            ...edits,
            menus: without(edits.menus, builder),
          }),
        },
      });
      continue;
    }
    const dead = ops.filter((op) => !known(op.unit));
    if (dead.length > 0) {
      const names = [...new Set(dead.map((op) => op.unit))];
      out.push({
        id: `menus:${builder}:units`,
        store: "menus",
        severity: "broken",
        subject: builder,
        detail: `${builder}'s build menu names ${names.join(", ")}, which ${input.gameName} no longer has.`,
        fix: {
          label: "Remove these operations",
          cost: plural(dead.length, "build menu change"),
          apply: (edits) => keepOps(edits, builder, (op) => known(op.unit)),
        },
      });
    }
    // A `move` places its unit before another one. When that other one has
    // gone `applyBuildMenu` puts the unit on the end instead, so the operation
    // still does something and it is not what it said. Nothing to remove: the
    // move is still wanted, only its landmark has gone, and where it should go
    // instead is the author's call.
    const stranded = ops.filter(
      (op) =>
        op.op === "move" &&
        op.before !== null &&
        known(op.unit) &&
        !known(op.before),
    );
    if (stranded.length > 0)
      out.push({
        id: `menus:${builder}:landmarks`,
        store: "menus",
        severity: "review",
        subject: builder,
        detail: `${plural(stranded.length, "unit")} in ${builder}'s build menu ${stranded.length === 1 ? "was" : "were"} placed before a unit ${input.gameName} no longer has, so ${stranded.length === 1 ? "it goes" : "they go"} on the end of the menu instead.`,
      });
  }
  return out;
}

/** Keep only the operations a predicate accepts, dropping an emptied builder. */
function keepOps(
  edits: GameEdits,
  builder: string,
  keep: (op: BuildMenuOp) => boolean,
): GameEdits {
  const ops = (edits.menus[builder] ?? []).filter(keep);
  if (ops.length === 0)
    return { ...edits, menus: without(edits.menus, builder) };
  return { ...edits, menus: { ...edits.menus, [builder]: ops } };
}

/** Findings for names and descriptions written for units that have gone. */
function textFindings(
  input: CompatInput,
  known: (key: string) => boolean,
): CompatFinding[] {
  const out: CompatFinding[] = [];
  for (const [unit, languages] of Object.entries(input.edits.text)) {
    if (known(unit)) continue;
    const written = Object.values(languages).reduce(
      (n, fields) => n + Object.keys(fields).length,
      0,
    );
    if (written === 0) continue;
    out.push({
      id: `text:${unit}`,
      store: "text",
      severity: "broken",
      subject: unit,
      detail: `${input.gameName} has no unit called ${unit} any more, so the words written for it are never shown.`,
      fix: {
        label: "Remove this text",
        cost: `${plural(written, "name or description", "names and descriptions")} you wrote for ${unit}`,
        apply: (edits) => ({ ...edits, text: without(edits.text, unit) }),
      },
    });
  }
  return out;
}

/**
 * Findings for units switched off that are not there to switch off.
 *
 * The one place removal is free. A mark is membership of a set and carries
 * nothing the user typed, so taking one off a unit the game has dropped
 * discards no work at all, and the offer says exactly that rather than leaving
 * the reader to wonder what it costs.
 */
function disabledFindings(
  input: CompatInput,
  known: (key: string) => boolean,
): CompatFinding[] {
  return input.edits.disabled
    .filter((unit) => !known(unit))
    .map((unit) => ({
      id: `disabled:${unit}`,
      store: "disabled" as const,
      severity: "broken" as const,
      subject: unit,
      detail: `${input.gameName} has no unit called ${unit} any more, so switching it off does nothing.`,
      fix: {
        label: "Remove this mark",
        cost: "nothing, a mark is not an edit",
        apply: (edits: GameEdits) => ({
          ...edits,
          disabled: edits.disabled.filter((other) => other !== unit),
        }),
      },
    }));
}

/** Broken first, then by store in the order the page shows them, then by name. */
const STORE_ORDER: (keyof GameEdits)[] = [
  "overrides",
  "clones",
  "menus",
  "text",
  "disabled",
];

/**
 * Compare everything the project names against the game as it is now.
 *
 * Pure and synchronous: the caller already holds the definitions, so this costs
 * no read of its own and cannot make opening a project any slower. See
 * `UnitPage.tsx` for when it is called, which is only once the game's checksum
 * has actually moved.
 */
export function checkCompatibility(input: CompatInput): CompatReport {
  const known = (key: string) =>
    Object.hasOwn(input.units, key) || Object.hasOwn(input.edits.clones, key);
  // A copy stands in the unit table where the page puts it, so a field path
  // inside one is read against the copy's own definition rather than against
  // the game's unit of the same name.
  const defOf = (key: string) =>
    input.edits.clones[key]?.def ?? input.units[key];
  const shared = new Set(
    Object.keys(input.weaponDefs).map((k) => k.toLowerCase()),
  );

  const findings = [
    ...overrideFindings(input, known, defOf),
    ...cloneFindings(input, shared),
    ...menuFindings(input, known),
    ...textFindings(input, known),
    ...disabledFindings(input, known),
  ].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "broken" ? -1 : 1;
    const store = STORE_ORDER.indexOf(a.store) - STORE_ORDER.indexOf(b.store);
    return store !== 0 ? store : a.id.localeCompare(b.id);
  });

  if (findings.length === 0) return NO_COMPAT_FINDINGS;
  return {
    findings,
    broken: findings.filter((f) => f.severity === "broken").length,
    review: findings.filter((f) => f.severity === "review").length,
  };
}

/** Whether there is an answer, and what it is. */
export type CompatState =
  /** The game checksums to what it did when the project was written. */
  | { kind: "unmoved" }
  /** One of the two checksums is missing, so nothing can be said either way. */
  | { kind: "unknown" }
  | { kind: "moved"; report: CompatReport };

/**
 * Whether to run the comparison at all, and the answer when it runs.
 *
 * The gate matters more than the comparison. A check that ran on every open
 * would be a tax on opening a project, and one that blocked the editor while it
 * ran would be worse than the problem it solves: a project whose game has moved
 * has to still open and still edit, because editing it is how the damage gets
 * repaired.
 *
 * So the whole check hangs off two strings. `authoredChecksum` is what unitsync
 * made of the game's archives when the project was written, `current` is what
 * it makes of them now, and while they agree there is provably nothing to
 * compare. Equal checksums mean the same archives, which mean the same
 * definitions.
 *
 * When they differ, the comparison itself is arithmetic over tables the editor
 * is already holding, because it cannot render its unit list without them. So
 * the expensive part - reading the game - has already been paid for by the page
 * and this adds no read of its own.
 *
 * `unknown` is a real answer and not a failure. A project started against a
 * game unitsync could not checksum, or opened before the read lands, has
 * nothing to compare, and saying so is better than an empty report that reads
 * as a clean bill of health.
 */
export function compatibilityState(
  authoredChecksum: string | undefined,
  current: string | undefined,
  input: Omit<CompatInput, "edits"> & { edits: GameEdits },
): CompatState {
  if (!authoredChecksum || !current) return { kind: "unknown" };
  if (authoredChecksum === current) return { kind: "unmoved" };
  return { kind: "moved", report: checkCompatibility(input) };
}
