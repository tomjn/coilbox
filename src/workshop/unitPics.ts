/**
 * Which build picture each unit on the workshop page draws (issue #2692).
 *
 * A game's own unit is easy: unitsync resolves its picture and the read is keyed
 * by the unit's internal name. A unit the project added has no entry in that
 * read at all, because it is not in the archive unitsync mounted, so a page that
 * only looked there would show every copy somebody made as a grey box.
 *
 * A copy carries its source's definition, `buildpic` included, so in the game it
 * draws that unit's picture, and this says so. Only while it still names that
 * file: a copy whose `buildpic` has been edited draws something else, and a copy
 * of a unit that declared no `buildpic` at all falls back in the engine to
 * `unitpics/<its own name>.dds`, which is a file the game does not have. Both of
 * those get no picture here, which is what the game will show.
 *
 * A unit built in the lego builder is not a copy of anything, and its files are
 * in the game folder, so unitsync answers for it like any other unit and nothing
 * here applies.
 */
import type { UnitBuildpicsResult, UnitDisplay } from "@/content/bindings";
import type { UnitClones } from "./clones";
import { readPath, type UnitOverrides } from "./overrides";

/**
 * Ask for a unit's picture by internal name.
 *
 * A lookup rather than a map, because the page hands the same answer to the unit
 * list and to a builder's roster and neither wants to know how it was reached.
 */
export function unitPicLookup({
  buildpics,
  clones,
  units,
  overrides,
}: {
  /** What unitsync resolved for the game's own units, null until it lands. */
  buildpics: UnitBuildpicsResult | null;
  clones: UnitClones;
  /** The game's units with the project's own among them. */
  units: Record<string, Record<string, unknown>>;
  overrides: UnitOverrides;
}): (key: string) => UnitDisplay | undefined {
  const picOf = (key: string): string | undefined => {
    const value = overrides[key]?.buildpic ?? readPath(units[key], "buildpic");
    if (typeof value !== "string") return undefined;
    // Lowercased because a game writes the same file both ways: Balanced
    // Annihilation's defs say `ARMAAP.DDS` where the archive holds `armaap.dds`.
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" ? undefined : trimmed;
  };

  return (key: string) => {
    const source = clones[key]?.source;
    if (source !== undefined) {
      const pic = picOf(key);
      if (pic !== undefined && pic === picOf(source)) {
        const borrowed = buildpics?.units[source];
        if (borrowed) return borrowed;
      }
    }
    return buildpics?.units[key];
  };
}
