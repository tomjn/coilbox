/**
 * A new unit is a copy of an old one under a new name (issue #1272).
 *
 * The tweaks people actually want are rarely a changed number. They are a tier
 * four version of something, the same tank with a different gun, a joke unit.
 * In Lua all three are the same move: take a definition, give it a new name,
 * change what you came to change.
 *
 * That is not an override, and it must not be stored as one. An override is a
 * sparse patch against a table the game still owns, and its whole value is that
 * everything it does not mention keeps following the game (see
 * `overrides.ts`). A clone owns its table outright: the game has no unit of
 * that name to follow, so there is nothing for a patch to be sparse against.
 * So clones live here, in their own set, and creating one writes nothing at all
 * into the override set. Editing a clone afterwards is an ordinary override
 * against the clone's own definition, which keeps one edit path in the page and
 * keeps "reset this field" meaning something: back to what the clone was made
 * with.
 *
 * The failure mode is the name. A clone called `armcom` in a game that already
 * has an `armcom` replaces it, which is occasionally the point and usually a
 * mistake, so {@link checkCloneName} answers which of the two is about to
 * happen and the page says so before anything is created.
 */
import { resolvedDef } from "./overrides";

/**
 * Where a clone's definition came from, when it was not copied from a unit.
 *
 * A unit built in the lego builder and exported into the game folder is a whole
 * definition the game will read, which is exactly what a clone is, so it enters
 * here rather than in a list of its own (issue #2651). It carries the project it
 * was built in, because that is what a re-export is matched on: the name can
 * change between one export and the next, the project cannot.
 */
export interface CloneOrigin {
  kind: "lego";
  /** The lego project's id. */
  projectId: string;
  /** What the project is called, for saying so on the page. */
  projectName: string;
}

/** One unit the project adds, held as a whole definition rather than a patch. */
export interface UnitClone {
  /** Its internal name, which is its key in the game's unit table. */
  key: string;
  /**
   * The unit it was copied from, for provenance. Absent for a unit that was
   * not copied from one, which is every unit built in the lego builder.
   */
  source?: string;
  /** Where the definition came from, when nothing in the game was copied. */
  origin?: CloneOrigin;
  /**
   * Whether it stood in for a unit the game already had when it was made.
   *
   * Recorded rather than worked out later, because it is what the user was told
   * before they pressed the button, and because a clone is only ever made
   * against one game.
   */
  replacesGameUnit: boolean;
  /** The whole definition, as the game would have to read it. */
  def: Record<string, unknown>;
}

/** Every unit the project adds, keyed by internal name. */
export type UnitClones = Record<string, UnitClone>;

/**
 * What an internal name may contain.
 *
 * Measured rather than guessed: every unit key in Balanced Annihilation V15.9.8
 * (379 of them) and Beyond All Reason test-30922-8064a43 (564) matches this,
 * read out of the worker's `--unit-defs` output on 7 September 2026. A unit's
 * name is also a file name in the game's `units/` folder, which is the reason
 * the games agree.
 */
const KEY_PATTERN = /^[a-z0-9_]+$/;

/** An internal name as it will be stored, whatever case it was typed in. */
export function normaliseCloneKey(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * What creating a clone under this name would do.
 *
 * `adds` and `replaces` are both allowed, and the difference between them is
 * the entire point of asking. The wording belongs to whoever is showing it.
 */
export type CloneVerdict = "empty" | "invalid" | "taken" | "adds" | "replaces";

export interface CloneNameCheck {
  /** The name as it would be stored. */
  key: string;
  verdict: CloneVerdict;
  /** Whether a clone can be made under this name. */
  ok: boolean;
}

export function checkCloneName(
  raw: string,
  gameUnits: Record<string, unknown>,
  clones: UnitClones,
): CloneNameCheck {
  const key = normaliseCloneKey(raw);
  const verdict = ((): CloneVerdict => {
    if (!key) return "empty";
    if (!KEY_PATTERN.test(key)) return "invalid";
    // Your own unit is refused rather than silently overwritten. Replacing the
    // game's unit is a decision about the game. Replacing your own would only
    // throw away work you can edit or delete instead.
    if (Object.hasOwn(clones, key)) return "taken";
    return Object.hasOwn(gameUnits, key) ? "replaces" : "adds";
  })();
  return { key, verdict, ok: verdict === "adds" || verdict === "replaces" };
}

/**
 * A name to offer for a copy of `source`: the source with the lowest number on
 * the end that nothing is using yet.
 */
export function suggestCloneKey(
  source: string,
  taken: (key: string) => boolean,
): string {
  const base = normaliseCloneKey(source);
  let n = 2;
  while (taken(`${base}${n}`)) n += 1;
  return `${base}${n}`;
}

/**
 * Put the display name on a definition, in the keys the engine reads it from.
 *
 * The mirror of the read in `unitName.ts`, which takes `humanName` first and
 * then `name`, and ignores a `name` that only repeats the unit's internal name.
 * So a `name` that repeated the source's key was the internal name and becomes
 * the clone's, and anything else in either key was a name for a person to read
 * and becomes the new one. A definition carrying neither, which is every unit
 * in Beyond All Reason, gets a `humanName` added: without it the clone would
 * have no name anywhere, since the game's own language file cannot name a unit
 * the game has never heard of.
 *
 * Mutates the definition it is given, which is always a fresh copy here.
 */
function applyNames(
  def: Record<string, unknown>,
  source: string,
  key: string,
  displayName: string,
): void {
  let named = false;
  for (const [k, value] of Object.entries(def)) {
    const lower = k.toLowerCase();
    if (lower !== "name" && lower !== "humanname") continue;
    if (
      lower === "name" &&
      typeof value === "string" &&
      value.trim() === source
    )
      def[k] = key;
    else {
      def[k] = displayName;
      named = true;
    }
  }
  if (!named) def.humanName = displayName;
}

/**
 * Copy a unit under a new name.
 *
 * `patch` is the source's own overrides, so the copy is of the unit as the
 * project has it rather than as the game shipped it: somebody who has just
 * doubled a unit's health and then clones it means the one with the health they
 * set. Those edits are written into the clone's definition rather than carried
 * over as overrides, because from here on they are simply what this unit is.
 */
export function deriveClone({
  key,
  source,
  sourceDef,
  patch,
  displayName,
  replacesGameUnit,
}: {
  key: string;
  source: string;
  sourceDef: Record<string, unknown> | undefined;
  patch?: Record<string, unknown>;
  displayName: string;
  replacesGameUnit: boolean;
}): UnitClone {
  const def = resolvedDef(sourceDef, patch);
  applyNames(def, source, key, displayName.trim());
  return { key, source, replacesGameUnit, def };
}

export function addClone(clones: UnitClones, clone: UnitClone): UnitClones {
  return { ...clones, [clone.key]: clone };
}

export function removeClone(clones: UnitClones, key: string): UnitClones {
  if (!Object.hasOwn(clones, key)) return clones;
  const { [key]: _dropped, ...rest } = clones;
  return rest;
}

/**
 * The game's units with the project's own on top, which is the table every
 * other part of the page works from. A clone that replaces a unit takes its
 * place, because that is what it will do in the game.
 */
export function unitsWithClones(
  units: Record<string, Record<string, unknown>>,
  clones: UnitClones,
): Record<string, Record<string, unknown>> {
  const added = Object.values(clones);
  if (added.length === 0) return units;
  const out = { ...units };
  for (const clone of added) out[clone.key] = clone.def;
  return out;
}
