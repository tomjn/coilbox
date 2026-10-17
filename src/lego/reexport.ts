/**
 * What a re-export sends about the fields the build decides, and what it
 * records afterwards (issue #3245).
 *
 * The Rust half (`reexport.rs` in the lego plugin) compares each field in the
 * game's `units/<unit>.lua` with the value the last export wrote, and only
 * rewrites the ones that still hold it. The last export's values come from the
 * receipt, `LegoProject.exported.def`, so the receipt has to keep saying what
 * the file got from coilbox. A field kept because somebody changed it keeps the
 * value the builder last wrote there, never the build's newer one: otherwise
 * the next export would read the hand edit as untouched and replace it.
 */
import { comparablePath, samePath } from "./exportRecord";
import type { LegoExport } from "./model";
import { DERIVED_FIELDS, defValue } from "./unitDef";

/** One derived field as `lego_export` takes it. Null means absent. */
export interface DerivedField {
  path: string;
  now: unknown;
  last: unknown;
}

/** What a re-export did to one field, as `lego_export` answers it. */
export interface FieldChange {
  path: string;
  change: "updated" | "added" | "removed" | "kept" | "refused";
  /** What the file held before, or null when it did not have the field. */
  was: unknown;
  message: string | null;
}

/** Why `lego_export` left the whole unit definition as it was. */
export type KeptWhole =
  | { reason: "workshopBackup" }
  | { reason: "notOurs" }
  | { reason: "unreadable"; message: string };

/** The receipt, when it is for this folder and this unit name. */
function sameTarget(
  exported: LegoExport | undefined,
  dir: string,
  unitName: string,
): LegoExport | null {
  if (!exported) return null;
  return samePath(exported.dir, dir) && exported.unitName === unitName
    ? exported
    : null;
}

/**
 * The digest the receipt holds for a file the builder last wrote at `relative`
 * under `dir`, or null if it never has.
 */
export function writtenDigest(
  exported: LegoExport | undefined,
  dir: string,
  relative: string,
): string | null {
  if (!exported) return null;
  const wanted = `${comparablePath(dir)}/${relative.toLowerCase()}`;
  const file = exported.files.find((f) => comparablePath(f.path) === wanted);
  return file?.sha256 ?? null;
}

/**
 * The derived fields to send with an export of `def`, or null when nothing
 * records coilbox writing `units/<unit>.lua` in `dir`.
 *
 * Null keeps an existing file whole. Without that record the file may be the
 * game's own unit of the same name, and a field that happens to match would
 * otherwise be taken for one of ours.
 */
export function derivedFields(
  def: Record<string, unknown>,
  exported: LegoExport | undefined,
  dir: string,
  unitName: string,
): DerivedField[] | null {
  const previous = sameTarget(exported, dir, unitName);
  if (!previous) return null;
  if (!writtenDigest(previous, dir, `units/${unitName}.lua`)) return null;
  return DERIVED_FIELDS.map((path) => ({
    path,
    now: defValue(def, path) ?? null,
    last: defValue(previous.def, path) ?? null,
  }));
}

/** `def` with the value at a dotted `path` set, or taken out for undefined. */
function withValue(
  def: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [key, ...rest] = path.split(".");
  if (rest.length === 0) {
    const { [key]: _, ...others } = def;
    return value === undefined ? others : { ...others, [key]: value };
  }
  const inner = def[key];
  const table =
    typeof inner === "object" && inner !== null && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : {};
  return { ...def, [key]: withValue(table, rest.join("."), value) };
}

/**
 * The definition the receipt records after an export.
 *
 * `def` is the one this build gives. A derived field the export did not write,
 * because the field was kept or refused or the whole file was left alone,
 * keeps the value the last receipt had for it instead.
 */
export function receiptDef(
  def: Record<string, unknown>,
  exported: LegoExport | undefined,
  dir: string,
  unitName: string,
  result: { unitDefKept: KeptWhole | null; unitDefFields: FieldChange[] },
): Record<string, unknown> {
  const previous = sameTarget(exported, dir, unitName);
  if (!previous) return def;
  const unwritten = result.unitDefKept
    ? DERIVED_FIELDS
    : result.unitDefFields
        .filter(
          (field) => field.change === "kept" || field.change === "refused",
        )
        .map((field) => field.path);
  return unwritten.reduce(
    (out, path) => withValue(out, path, defValue(previous.def, path)),
    def,
  );
}
