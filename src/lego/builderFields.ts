/**
 * Which fields of a built unit the unit builder keeps up to date, and which
 * workshop changes to them are not in the unit's file yet (issues #4242 and
 * #4243).
 *
 * The one list of fields is `DERIVED_FIELDS` in `unitDef.ts`. A re-export uses
 * it to decide what to rewrite, the workshop's unit page uses it to mark the
 * fields, and the builder uses it to know which numbers a workshop project can
 * disagree with. Nothing here keeps a list of its own.
 */
import { t } from "@lingui/core/macro";
import { formatNumber } from "@/lib/format";
import {
  DPS_FIELDS,
  RANGE_FIELDS,
  type WeaponInput,
  weaponStats,
} from "@/workshop/derivedStats";
import { isMutatorOnly } from "@/workshop/mutatorOnly";
import type { ModProject } from "@/workshop/project";
import { slotWeaponInput } from "@/workshop/unitWeapons";
import { type WeaponSlot, weaponSlots } from "@/workshop/weaponSlots";
import type { LegoExport } from "./model";
import { writtenDigest } from "./reexport";
import { DERIVED_FIELDS } from "./unitDef";
import { fileValue, sameValue, unitStats } from "./unitStats";

/** Whether the builder will update the field, or leaves it to somebody. */
export type BuilderFieldMark = "set" | "kept";

/** The derived field a workshop field path is, in any key case. */
export function derivedFieldFor(path: string): string | undefined {
  const wanted = path.toLowerCase();
  return DERIVED_FIELDS.find((field) => field.toLowerCase() === wanted);
}

/**
 * What the builder does with the field at `path` in a built unit's file.
 *
 * "set" while the file holds what the last export wrote, so the next export
 * updates it. "kept" once it holds anything else: somebody changed it, in a
 * text editor or through the workshop, and the builder leaves it alone from
 * then on (`reexport.rs`). Null for a field the builder never writes, and for a
 * unit where nothing records the builder writing the file, since a re-export
 * leaves such a file whole.
 */
export function builderFieldMark(
  path: string,
  file: Record<string, unknown> | undefined,
  receipt: LegoExport | undefined,
): BuilderFieldMark | null {
  const field = derivedFieldFor(path);
  if (!field || !file || !receipt) return null;
  if (!writtenDigest(receipt, receipt.dir, `units/${receipt.unitName}.lua`))
    return null;
  return sameValue(fileValue(file, field), fileValue(receipt.def, field))
    ? "set"
    : "kept";
}

/** One workshop project's change to a field, not in the unit's file. */
export interface WorkshopChange {
  projectId: string;
  projectName: string;
  /** The field's path as the project holds it, which the unit page opens at. */
  path: string;
  value: unknown;
  /** Sent through the mutator route, so it never reaches the file. */
  mutatorOnly: boolean;
}

/**
 * The changes workshop projects for `gameName` make to `unitKey`, among the
 * fields at `paths` (any key case), that the unit's `file` does not hold yet.
 * Every project that changes a field is listed: nothing says which one the
 * game maker means to ship.
 */
export function workshopChanges(
  projects: readonly ModProject[],
  gameName: string,
  unitKey: string,
  file: Record<string, unknown> | undefined,
  paths: readonly string[],
): WorkshopChange[] {
  if (!file) return [];
  const wanted = new Set(paths.map((path) => path.toLowerCase()));
  return projects
    .filter((project) => project.gameName === gameName)
    .flatMap((project) =>
      Object.entries(project.edits.overrides[unitKey] ?? {})
        .filter(
          ([path, value]) =>
            wanted.has(path.toLowerCase()) &&
            !sameValue(fileValue(file, path), value),
        )
        .map(([path, value]) => ({
          projectId: project.id,
          projectName: project.name,
          path,
          value,
          mutatorOnly: isMutatorOnly(project.mutatorOnly, unitKey, path),
        })),
    );
}

/** The stats the weapons decide. */
export type WeaponStatId = "range" | "dps";

/** The fields of a slot's own table each weapon stat reads: which definition
 *  the slot names, and for damage per second whether it is slaved. */
const SLOT_FIELDS: Record<WeaponStatId, readonly string[]> = {
  range: ["name"],
  dps: ["name", "slaveto"],
};

const DEFINITION_FIELDS: Record<WeaponStatId, readonly string[]> = {
  range: RANGE_FIELDS,
  dps: DPS_FIELDS,
};

/** Whether `path` is `prefix`, or reaches into one of `fields` below it. A path
 *  that ends above a field (`damage` for `damage.default`) reaches it too. */
function reaches(
  path: string,
  prefix: string,
  fields: readonly string[],
): boolean {
  const lower = path.toLowerCase();
  const root = prefix.toLowerCase();
  if (lower === root) return true;
  if (!lower.startsWith(`${root}.`)) return false;
  const leaf = lower.slice(root.length + 1);
  return fields.some((field) => field === leaf || field.startsWith(`${leaf}.`));
}

/** The path of `file` that reads as `step`, in whatever case the file spells it. */
function spelledKey(table: Record<string, unknown>, step: string): string {
  return (
    Object.keys(table).find(
      (key) => key.toLowerCase() === step.toLowerCase(),
    ) ?? step
  );
}

/** A copy of `file` with `patch` written in, each key in the case the file
 *  already spells it. */
function withEdits(
  file: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = structuredClone(file);
  for (const [path, value] of Object.entries(patch)) {
    const steps = path.split(".");
    let at = out;
    for (const [i, step] of steps.slice(0, -1).entries()) {
      const key = spelledKey(at, step);
      const next = at[key];
      if (next !== null && typeof next === "object") {
        at = next as Record<string, unknown>;
        continue;
      }
      const made = /^\d+$/.test(steps[i + 1]) ? [] : {};
      at[key] = made;
      at = made as unknown as Record<string, unknown>;
    }
    at[spelledKey(at, steps[steps.length - 1])] = structuredClone(value);
  }
  return out;
}

/** What each slot of `def` fires, by the slot's step. */
function firing(
  def: Record<string, unknown>,
  project: ModProject | undefined,
  weaponDefs: Record<string, Record<string, unknown>>,
  unitKey: string,
): { slots: WeaponSlot[]; inputs: Map<string, WeaponInput> } {
  const slots = weaponSlots(def, weaponDefs, [unitKey]);
  const equipped = project?.edits.equipped?.[unitKey];
  const inputs = new Map<string, WeaponInput>();
  for (const slot of slots) {
    const input = slotWeaponInput(
      slot,
      project?.edits.weapons ?? {},
      equipped?.[slot.step],
    );
    if (input) inputs.set(slot.step, input);
  }
  return { slots, inputs };
}

function slotFigure(input: WeaponInput | undefined, stat: WeaponStatId) {
  if (!input) return 0;
  const stats = weaponStats(input);
  if (stat === "range") return stats.weaponType === "Shield" ? 0 : stats.range;
  return stats.dps ?? 0;
}

/**
 * The changes workshop projects for `gameName` make to a built unit's longest
 * weapon range or damage per second, that the unit's `file` does not hold yet.
 *
 * Both numbers are worked out from the unit's weapons, so a change is a project
 * whose edits give the unit a different figure than the file does. The fields
 * that can do that are the ones `weaponStats` reads (`RANGE_FIELDS` and
 * `DPS_FIELDS` in `derivedStats.ts`), written in a weapon definition the unit
 * carries or in a slot, and a library weapon equipped into a slot.
 *
 * A project gives one change per stat, whatever number of weapons it edits. Its
 * value is the figure the unit would have and its path is the field of the
 * weapon whose own figure moves furthest, so the link opens the edit that
 * matters most. Another project that edits a different weapon is its own change.
 */
export function workshopWeaponChanges(
  projects: readonly ModProject[],
  gameName: string,
  unitKey: string,
  file: Record<string, unknown> | undefined,
  weaponDefs: Record<string, Record<string, unknown>> | undefined,
  stat: WeaponStatId,
): WorkshopChange[] {
  if (!file || !weaponDefs) return [];
  const before = firing(file, undefined, weaponDefs, unitKey);
  const had = unitStats(file, [...before.inputs.values()])[stat];
  return projects
    .filter((project) => project.gameName === gameName)
    .flatMap((project): WorkshopChange[] => {
      const edits = project.edits.overrides[unitKey] ?? {};
      const equipped = project.edits.equipped?.[unitKey] ?? {};
      const def = withEdits(file, edits);
      const after = firing(def, project, weaponDefs, unitKey);
      const now = unitStats(def, [...after.inputs.values()])[stat];
      if (now === had) return [];

      // The edit to each slot that can move the figure, as the path to open.
      let best: { path: string; moved: number } | undefined;
      for (const slot of after.slots) {
        const paths = Object.keys(edits).filter(
          (path) =>
            reaches(path, slot.path, SLOT_FIELDS[stat]) ||
            (slot.definition.kind === "own" &&
              reaches(path, slot.definition.path, DEFINITION_FIELDS[stat])),
        );
        const path =
          paths[0] ??
          (equipped[slot.step] !== undefined ? `${slot.path}.name` : undefined);
        if (path === undefined) continue;
        const moved = Math.abs(
          slotFigure(after.inputs.get(slot.step), stat) -
            slotFigure(before.inputs.get(slot.step), stat),
        );
        if (!best || moved > best.moved) best = { path, moved };
      }
      if (!best) return [];
      return [
        {
          projectId: project.id,
          projectName: project.name,
          path: best.path,
          value:
            now === null
              ? t`None`
              : formatNumber(now, { maximumFractionDigits: 1 }),
          mutatorOnly: isMutatorOnly(project.mutatorOnly, unitKey, best.path),
        },
      ];
    });
}
