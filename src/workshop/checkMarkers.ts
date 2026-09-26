/**
 * Where a check names a unit or a field of it, for the marker the unit list
 * and the field rows show beside the checks page's own summary (issue
 * #3116).
 *
 * Only two of the checks the Checks page pulls into "Needs attention"
 * (`ProjectChecks.tsx`) carry a name structured enough to place a marker
 * with: a compatibility finding's `subject` (`compatibility.ts`) and an
 * armour class problem's `id` (`armorClasses.ts`), both of which already
 * carry a unit key by construction rather than in a sentence a marker would
 * have to parse to find one.
 *
 * Preflight's blockers and review items, and unitsync's own diagnostics, are
 * plain sentences with nothing else on them (`preflight.ts`): the Rust side
 * that produces them has no unit or field reference to carry, only text
 * meant for a human to read. They stay in the checks summary alone. Giving
 * preflight a structured reference of its own is a follow-up, filed as issue
 * #3155, and not attempted here: it touches the Rust check and its wire
 * format, not just the page that reads it.
 *
 * A weapon's damage table naming an unknown armour class and a reference
 * that names no weapon (`armorClasses.ts`'s `unknownDamageClasses`,
 * `weaponRefs.ts`'s `refProblems`) are structured too, but by a definition's
 * key rather than a unit and a field path, so the weapons tab and the death
 * explosions tab match them directly off that key instead of going through
 * this module: see `WeaponSlotsPanel.tsx`.
 */
import type { ArmorProblem } from "./armorClasses";
import type { CompatFinding } from "./compatibility";

/** One or more checks about the same unit or field, folded into the worse of
 *  the severities involved: a blocker would reach the game broken, and a
 *  project with both a blocker and a review item on the same unit is a
 *  project with a blocker on it. */
export interface CheckMarker {
  severity: "blocker" | "review";
  messages: string[];
}

function mergeMarker(
  existing: CheckMarker | undefined,
  severity: "blocker" | "review",
  message: string,
): CheckMarker {
  if (!existing) return { severity, messages: [message] };
  return {
    severity:
      existing.severity === "blocker" || severity === "blocker"
        ? "blocker"
        : "review",
    messages: [...existing.messages, message],
  };
}

/**
 * A compatibility finding's subject, split into the unit it names and, for an
 * overrides finding scoped to one field (`overrideFindings` in
 * `compatibility.ts` writes `${unit}.${path}`), the field path within it.
 * Every other store's subject names a unit alone, since none of the rest of
 * `compatibility.ts` writes a per-field subject.
 */
export function compatSubject(
  finding: Pick<CompatFinding, "store" | "subject">,
): { unit: string; field?: string } {
  if (finding.store !== "overrides") return { unit: finding.subject };
  const at = finding.subject.indexOf(".");
  if (at < 0) return { unit: finding.subject };
  return {
    unit: finding.subject.slice(0, at),
    field: finding.subject.slice(at + 1),
  };
}

const severityOf = (finding: CompatFinding): "blocker" | "review" =>
  finding.severity === "broken" ? "blocker" : "review";

/**
 * Every unit a compatibility finding or an armour-class problem names, with
 * the worst severity found for it and every message behind that: what the
 * unit list marks a row with. Keyed lowercased, since a unit key is read off
 * the game's own table wherever it appears here and games do not always
 * agree on its case.
 */
export function unitCheckMarkers(
  findings: readonly CompatFinding[],
  armorClassProblems: readonly ArmorProblem[],
): Map<string, CheckMarker> {
  const out = new Map<string, CheckMarker>();
  for (const finding of findings) {
    const { unit } = compatSubject(finding);
    const key = unit.toLowerCase();
    out.set(
      key,
      mergeMarker(out.get(key), severityOf(finding), finding.detail),
    );
  }
  for (const problem of armorClassProblems) {
    // `projectDamageClassProblems` namespaces a per-unit id `${unit}:...` and
    // a library-only one `library:...`, which names no unit to mark.
    const unit = problem.id.split(":")[0];
    if (!unit || unit === "library") continue;
    const key = unit.toLowerCase();
    out.set(key, mergeMarker(out.get(key), "review", problem.message));
  }
  return out;
}

/** A field marker's key, joining the unit and the field path so the same
 *  path on two units is never confused. Both sides lowercased to match how
 *  `unitCheckMarkers` keys a unit and how the field list already keys a
 *  field (`UnitFieldGroups.tsx`'s `warnings`). */
function fieldMarkerKey(unit: string, path: string): string {
  return `${unit.toLowerCase()}\u0000${path.toLowerCase()}`;
}

/**
 * Every field a compatibility finding names, keyed by unit and path
 * together. Only the `overrides` store ever names a field rather than a
 * whole unit, so this is the same findings list `unitCheckMarkers` reads,
 * filtered down to the ones with a field to mark.
 */
export function fieldCheckMarkers(
  findings: readonly CompatFinding[],
): Map<string, CheckMarker> {
  const out = new Map<string, CheckMarker>();
  for (const finding of findings) {
    const { unit, field } = compatSubject(finding);
    if (!field) continue;
    const key = fieldMarkerKey(unit, field);
    out.set(
      key,
      mergeMarker(out.get(key), severityOf(finding), finding.detail),
    );
  }
  return out;
}

/** {@link fieldCheckMarkers}'s markers for one unit, keyed by field path
 *  alone, the shape `UnitFieldGroups.tsx` already reads `warnings` in. */
export function fieldMarkersForUnit(
  markers: ReadonlyMap<string, CheckMarker>,
  unitKey: string,
): Record<string, CheckMarker> {
  const prefix = `${unitKey.toLowerCase()}\u0000`;
  const out: Record<string, CheckMarker> = {};
  for (const [key, marker] of markers)
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = marker;
  return out;
}
