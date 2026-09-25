/**
 * What a game's post files changed in a definition, carried on a copy so the
 * copy is post-processed once (issue #3054).
 *
 * The page reads every definition after the game's `unitdefs_post.lua` and
 * `weapondefs_post.lua` have run, and a copied unit or library weapon starts
 * from that read. The copy goes back into the game as a definition of its own,
 * and the post files run over it again. Balanced Annihilation V15.9.8 scales
 * every weapon's `cratermult` by 0.3 there, so a copy holding the scaled value
 * would be scaled a second time.
 *
 * The unitsync worker says what the post files changed, by definition
 * (`beforepost.rs`), and a copy keeps its part of that. The page goes on
 * showing and editing the values the game ends up with. The compiler writes
 * the game's own values back first (`before_post.rs`), so what the game's
 * post-processing then does to the copy is what it did to the source.
 *
 * Two rules decide which entries a copy keeps, and the compiler applies the
 * same two to later edits:
 *
 * - A path the project changed is the project's. Putting the game's value back
 *   under an edit would undo it.
 * - A weapon slot's `def` and `name` are one field. A post file turns the first
 *   into the second, so a slot pointed elsewhere by `name` must not get the
 *   file's `def` back and fire that instead.
 */
import type { PostChange, UnitDefsResult } from "@/content/bindings";
import type { UnitClones } from "./clones";
import { readPath, sameValue } from "./overrides";
import type { WeaponLibrary } from "./weaponLibrary";

export type { PostChange };

/** A path's steps, compared the way {@link overlaps} compares them. */
function steps(path: string): string[] {
  const out = path.split(".").map((step) => step.toLowerCase());
  if (out.length === 3 && out[0] === "weapons" && out[2] === "def")
    out[2] = "name";
  return out;
}

/** Whether two paths name one field, or one lies inside the other. */
export function overlaps(a: string, b: string): boolean {
  const x = steps(a);
  const y = steps(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

/** A change with only the entries `keep` answers yes to. */
function filtered(
  change: PostChange,
  keep: (path: string) => boolean,
): PostChange {
  const values = Object.fromEntries(
    Object.entries(change.values ?? {}).filter(([path]) => keep(path)),
  );
  const added = (change.added ?? []).filter(keep);
  return {
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(added.length > 0 ? { added } : {}),
  };
}

/** Drop every entry covering a path the project edited. */
export function withoutEdited(
  change: PostChange,
  edited: Iterable<string>,
): PostChange {
  const paths = [...edited];
  return filtered(change, (path) => !paths.some((e) => overlaps(path, e)));
}

/**
 * Drop a unit's own name. A copy gets a name of its own (`clones.ts`), and
 * putting the source's back would undo it.
 */
export function withoutNames(change: PostChange): PostChange {
  return filtered(change, (path) => {
    const lower = path.toLowerCase();
    return lower !== "name" && lower !== "humanname";
  });
}

/**
 * The entries inside one table of a definition, as paths into that table:
 * `weapondefs.armcomlaser` out of a unit's change is its weapon's change.
 */
export function under(change: PostChange, prefix: string): PostChange {
  const start = `${prefix.toLowerCase()}.`;
  const inside = (path: string) => path.toLowerCase().startsWith(start);
  const cut = (path: string) => path.slice(start.length);
  const values = Object.fromEntries(
    Object.entries(change.values ?? {})
      .filter(([path]) => inside(path))
      .map(([path, value]) => [cut(path), value]),
  );
  const added = (change.added ?? []).filter(inside).map(cut);
  return {
    ...(Object.keys(values).length > 0 ? { values } : {}),
    ...(added.length > 0 ? { added } : {}),
  };
}

/**
 * The change for one table inside a definition that the project may have
 * edited, such as a weapon a unit carries being copied into the library:
 * {@link under}, less whatever `edited` covers. An edit that replaces the
 * table itself, or anything around it, leaves nothing of the game's to put
 * back.
 */
export function copiedFrom(
  change: PostChange,
  prefix: string,
  edited: Iterable<string>,
): PostChange {
  const depth = prefix.split(".").length;
  const start = `${prefix.toLowerCase()}.`;
  const inner: string[] = [];
  for (const path of edited) {
    if (!overlaps(path, prefix)) continue;
    if (path.split(".").length <= depth) return {};
    inner.push(path.slice(start.length));
  }
  return withoutEdited(under(change, prefix), inner);
}

/**
 * The part of the source's change that still applies to a copy made before
 * coilbox could tell (issue #3054).
 *
 * A copy saved before this holds the values the page read, and nothing says
 * which of them the game's post files made. Its source still does: an entry is
 * kept wherever the copy holds exactly what the source holds now, which is a
 * post-processed value the copy never changed. Anywhere else, the project
 * edited the copy or the game has changed since, and the copy is left as it is.
 */
export function adoptedChange(
  copy: Record<string, unknown>,
  source: Record<string, unknown>,
  change: PostChange,
): PostChange {
  return filtered(change, (path) =>
    sameValue(readPath(copy, path), readPath(source, path)),
  );
}

/**
 * Give every copy saved before issue #3054 what it can be given, or `null`
 * when there is nothing to give, which is every load after the first.
 *
 * Copied units and library weapons with no record of what the game's post
 * files changed take the part of their source's that {@link adoptedChange}
 * says still applies. Only a copy whose source is still in the game: a copy of
 * a copy, or of a unit the game has since dropped, has nothing to compare
 * against and is left as it was. So is everything when the game's read could
 * not say (`read` absent).
 *
 * `units` and `weaponDefs` are the game's own, not the project's copies.
 */
export function adoptBeforePost(
  clones: UnitClones,
  weapons: WeaponLibrary | undefined,
  read: UnitDefsResult["beforePost"],
  units: Record<string, Record<string, unknown>>,
  weaponDefs: Record<string, Record<string, unknown>>,
): { clones: UnitClones; weapons: WeaponLibrary | undefined } | null {
  if (!read) return null;
  let nextClones = clones;
  for (const clone of Object.values(clones)) {
    if (clone.beforePost || clone.source === undefined) continue;
    const source = units[clone.source];
    if (!source) continue;
    const beforePost = withoutNames(
      adoptedChange(clone.def, source, read.units[clone.source] ?? {}),
    );
    nextClones = { ...nextClones, [clone.key]: { ...clone, beforePost } };
  }
  let nextWeapons = weapons;
  for (const weapon of Object.values(weapons ?? {})) {
    if (weapon.beforePost || !weapon.source) continue;
    const source = weaponDefs[weapon.source];
    if (!source) continue;
    const beforePost = adoptedChange(
      weapon.def,
      source,
      read.weaponDefs[weapon.source] ?? {},
    );
    nextWeapons = { ...nextWeapons, [weapon.key]: { ...weapon, beforePost } };
  }
  return nextClones === clones && nextWeapons === weapons
    ? null
    : { clones: nextClones, weapons: nextWeapons };
}

/** Read a change out of untrusted JSON. `undefined` when it is not one. */
export function parsePostChange(value: unknown): PostChange | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const raw = value as Record<string, unknown>;
  const values =
    typeof raw.values === "object" &&
    raw.values !== null &&
    !Array.isArray(raw.values)
      ? (raw.values as Record<string, unknown>)
      : undefined;
  const added = Array.isArray(raw.added)
    ? raw.added.filter((path): path is string => typeof path === "string")
    : undefined;
  return {
    ...(values && Object.keys(values).length > 0 ? { values } : {}),
    ...(added && added.length > 0 ? { added } : {}),
  };
}
