/**
 * Writing a value the game's post-processing turns into the one the modder
 * typed, on the mutator route (issue #3059), edit in place (issue #3093) and
 * the tweak slot route (issue #3092).
 *
 * A game's own Lua can change a typed number as it loads it. Balanced
 * Annihilation V15.9.8 turns a crater multiplier of 0.5 on a copied unit into
 * 0.045. What it does depends on the route as well as the game, so the Rust
 * side loads the game with this project's own compiled mutator on top, works
 * out a value that loads as the typed one, and loads that to prove it
 * (`loads_as.rs`). The answer goes to `workshopTestMutator` and
 * `workshopPackageMutator` as `written`. The tweak slots carry no files, so
 * their settle loads the game with the slots set as mod options instead, and its
 * answer goes to `workshopCompile` for a local launch and
 * `workshopPackTweakSlots` for a lobby.
 *
 * It loads the game at least once for a project with any typed number, so
 * it is asked for just before a test, a package or a pack, not on every
 * keystroke.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import type { ModProject } from "./project";

/** A value to write in place of a typed one. */
export interface WrittenValue {
  typed: unknown;
  written: number;
}

/** What to hand the mutator route's compile. Opaque to the page. */
export interface Written {
  units?: Record<string, Record<string, WrittenValue>>;
  weapons?: Record<string, Record<string, WrittenValue>>;
  /** A copy's own numbers, keyed by copy then dotted path into its `def`
   * (issue #3095). */
  clones?: Record<string, Record<string, WrittenValue>>;
}

/** One typed number, and what became of it. */
export interface TypedValueReport {
  field:
    | { kind: "unit"; unit: string; path: string }
    | { kind: "weapon"; weapon: string; path: string }
    /** A copy's own number, differing from its source, on edit in place
     * (issue #3095). */
    | { kind: "clone"; unit: string; path: string };
  typed: number;
  /** What the game loads when the typed value is written. */
  loadsAsTyped: number | null;
  outcome: "asTyped" | "written" | "unproven" | "unread";
  written?: number;
  reason?: string;
}

/** What `workshop_settle_typed_values` answers with. */
export interface SettledTypedValues {
  written: Written;
  fields: TypedValueReport[];
  /** How many times the game was loaded. */
  loads: number;
  elapsedMs: number;
}

export const workshopSettleTypedValues = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    /** The game's primary archive, as unitsync names it. */
    archive: string;
    project: ModProject;
  },
  SettledTypedValues
>("coilbox-workshop", "workshop_settle_typed_values");

/**
 * [`workshopSettleTypedValues`], for edit in place rather than the mutator
 * route (issue #3093): loads `archive` at `gameDir` with the game's own files
 * patched the way `workshopWriteInPlace` would leave them, for exactly the
 * fields that route carries. `sources` is the same read of game units the
 * write itself takes.
 */
export const workshopSettleTypedValuesInPlace = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    /** The game's primary archive, as unitsync names it. */
    archive: string;
    gameDir: string;
    project: ModProject;
    sources: Record<string, Record<string, unknown>>;
  },
  SettledTypedValues
>("coilbox-workshop", "workshop_settle_typed_values_in_place");

/**
 * Which tweak slot route a project takes to a game that declares the slots:
 * the one bare `tweakdefs` slot a local launch writes (`localTweakSlot.ts`),
 * or the numbered slots a lobby gets (`tweakPack.ts`).
 */
export type TweakRoute = "bare" | "numbered";

/**
 * [`workshopSettleTypedValues`], for the tweak slot route (issue
 * #3092): loads `archive` with the project handed over as mod options on
 * `route`, and lets the game's own Lua decide where and when they run.
 */
export const workshopSettleTypedValuesTweaks = defineCommand<
  {
    enginePath: string;
    dataDir: string;
    /** The game's primary archive, as unitsync names it. */
    archive: string;
    project: ModProject;
    route: TweakRoute;
  },
  SettledTypedValues
>("coilbox-workshop", "workshop_settle_typed_values_tweaks");

/** Where a typed number is, for a person. */
export function fieldLabel(report: TypedValueReport): string {
  switch (report.field.kind) {
    case "unit":
      return `${report.field.unit} ${report.field.path}`;
    case "clone":
      return `${report.field.unit} ${report.field.path} (copy)`;
    case "weapon":
      return `library weapon ${report.field.weapon} ${report.field.path}`;
  }
}

/**
 * One line saying what was done, or `null` when there was nothing to say:
 * every typed number already loads as typed.
 */
export function settledSummary(settled: SettledTypedValues): string | null {
  const written = settled.fields.filter((f) => f.outcome === "written");
  const unproven = settled.fields.filter(
    (f) => f.outcome === "unproven" || f.outcome === "unread",
  );
  if (written.length === 0 && unproven.length === 0) return null;
  const parts: string[] = [];
  if (written.length > 0)
    parts.push(
      `${written.length} typed value${written.length === 1 ? " is" : "s are"} written so the game's own Lua turns ${written.length === 1 ? "it" : "them"} into the typed number, checked by loading the game.`,
    );
  if (unproven.length > 0)
    parts.push(
      `${unproven.length} ${unproven.length === 1 ? "is" : "are"} written as typed, and the game may load ${unproven.length === 1 ? "it" : "them"} as something else.`,
    );
  return parts.join(" ");
}

/**
 * Ask for `written`, or say why not. A failure is not a stop: the typed
 * values are what every route wrote before this, so the caller carries on
 * with them and shows the reason.
 */
export async function settleTypedValues(
  args: Parameters<typeof workshopSettleTypedValues>[0],
): Promise<
  { ok: true; settled: SettledTypedValues } | { ok: false; message: string }
> {
  try {
    return { ok: true, settled: await workshopSettleTypedValues(args) };
  } catch (e) {
    return {
      ok: false,
      message: `Coilbox could not load the game to check typed values, so they are written as typed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** [`settleTypedValues`], for edit in place (issue #3093). */
export async function settleTypedValuesInPlace(
  args: Parameters<typeof workshopSettleTypedValuesInPlace>[0],
): Promise<
  { ok: true; settled: SettledTypedValues } | { ok: false; message: string }
> {
  try {
    return { ok: true, settled: await workshopSettleTypedValuesInPlace(args) };
  } catch (e) {
    return {
      ok: false,
      message: `Coilbox could not load the game to check typed values, so they are written as typed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** [`settleTypedValues`], for the tweak slot route (issue #3092). */
export async function settleTypedValuesTweaks(
  args: Parameters<typeof workshopSettleTypedValuesTweaks>[0],
): Promise<
  { ok: true; settled: SettledTypedValues } | { ok: false; message: string }
> {
  try {
    return { ok: true, settled: await workshopSettleTypedValuesTweaks(args) };
  } catch (e) {
    return {
      ok: false,
      message: `Coilbox could not load the game to check typed values, so they are written as typed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
