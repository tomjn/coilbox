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
import { isMutatorOnly } from "@/workshop/mutatorOnly";
import type { ModProject } from "@/workshop/project";
import type { LegoExport } from "./model";
import { writtenDigest } from "./reexport";
import { DERIVED_FIELDS } from "./unitDef";
import { fileValue, sameValue } from "./unitStats";

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
