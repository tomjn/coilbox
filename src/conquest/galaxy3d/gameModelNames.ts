/**
 * Turning the name an author wrote in a `game` model reference into a model
 * (issue #3557).
 *
 * The model reader already takes a whole path inside the game archive and a
 * model file name with or without its extension. A unit or a feature whose
 * model file is named something else is the gap this closes: the name is
 * looked up in the game's unit definitions and then its feature definitions,
 * and the model that definition names is read instead.
 *
 * Pure apart from {@link loadFeatureObjects}, which runs Lua through unitsync.
 */

import { unitsyncLuaExec } from "@/content/bindings";

/**
 * The Lua that lists every feature the game defines with the model it names,
 * run with the game's archives mounted.
 *
 * It runs the base content's own `gamedata/featuredefs.lua`, which reads the
 * TDF and Lua files under `features/` the way the engine does. The game's
 * `gamedata/featuredefs_post.lua` is hidden from it, because every game
 * measured indexes `DEFS`, which only exists when the whole of
 * `gamedata/defs.lua` runs and which the parser does not have. The post step
 * adds wrecks to unit definitions and touches up values. It does not add the
 * scenery features in `features/`. Measured on 5 October 2026 against 8 local
 * games: with the post step run, 6 of them fail on `DEFS`. With it hidden, all
 * 8 list their features.
 *
 * One line out, `name=object;name=object`, because a string is all the parser
 * hands back. A name or object holding a separator, a quote, a backslash or a
 * control character is left out, so the parser's `%q` quoting never has to be
 * undone.
 */
export const FEATURE_OBJECTS_LUA = `
local exists = VFS.FileExists
VFS.FileExists = function(path, ...)
  if type(path) == 'string' and string.lower(path) == 'gamedata/featuredefs_post.lua' then return false end
  return exists(path, ...)
end
local ok, fds = pcall(VFS.Include, 'gamedata/featuredefs.lua')
VFS.FileExists = exists
if not ok then error(fds) end
if type(fds) ~= 'table' then return '' end
local out = {}
for name, def in pairs(fds) do
  if type(name) == 'string' and type(def) == 'table' then
    local object
    for k, v in pairs(def) do
      if type(k) == 'string' and string.lower(k) == 'object' and type(v) == 'string' then object = v end
    end
    if object and not string.find(name .. object, '[;=\\"\\\\%c]') then
      out[#out + 1] = string.lower(name) .. '=' .. object
    end
  end
end
table.sort(out)
return table.concat(out, ';')
`;

/**
 * Read {@link FEATURE_OBJECTS_LUA}'s line back into feature name to model
 * name, keyed by lowercased feature name. An entry that does not read as
 * `name=object` is skipped.
 */
export function parseFeatureObjects(
  result: string | undefined,
): Map<string, string> {
  const line = (result ?? "").trim().replace(/^"|"$/g, "");
  const out = new Map<string, string>();
  if (line === "") return out;
  for (const entry of line.split(";")) {
    const at = entry.indexOf("=");
    if (at <= 0) continue;
    const name = entry.slice(0, at).trim().toLowerCase();
    const object = entry.slice(at + 1).trim();
    if (name !== "" && object !== "") out.set(name, object);
  }
  return out;
}

/** Every feature the game defines and the model it names. Rejects when the
 *  game's feature definitions would not load. */
export async function loadFeatureObjects(
  target: { enginePath: string; dataDir: string },
  archive: string,
): Promise<Map<string, string>> {
  const res = await unitsyncLuaExec({
    ...target,
    archive,
    source: FEATURE_OBJECTS_LUA,
  });
  if (res.error) throw new Error(res.error);
  return parseFeatureObjects(res.result);
}

/** What {@link resolveGameModels} reads with. Swapped for fakes under test. */
export interface GameModelLookups<T> {
  /**
   * Read models by the names the model reader takes. A name with no model
   * maps to `null` or is left out.
   */
  read(objects: string[]): Promise<Map<string, T | null>>;
  /** Unit name to the model its `objectname` names, keyed lowercased. */
  unitObjects(): Promise<Map<string, string>>;
  /** Feature name to the model its `object` names, keyed lowercased. */
  featureObjects(): Promise<Map<string, string>>;
}

const reasonOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Read the model for every name, trying each name in this order:
 *
 * 1. As the model reader takes it: a whole path inside the game archive, then
 *    a model file name with or without its extension. A name that resolves
 *    here is never looked up as a unit or a feature, so a name that matches a
 *    unit and a model file draws what it drew before this lookup existed.
 * 2. As a unit name, reading the model the unit's `objectname` names.
 * 3. As a feature name, reading the model the feature's `object` names.
 *
 * The first that reads wins. Unit and feature names are matched without
 * regard to case. The unit and feature lists are fetched once per call, and
 * only when some name is left after step 1. Every model the lists point at is
 * read in one more call. A list that fails to load counts as empty and is
 * reported through `warn`, so the names it would have answered are reported
 * as missing and the rest still draw.
 */
export async function resolveGameModels<T>(
  names: string[],
  lookups: GameModelLookups<T>,
  warn: (message: string) => void = console.warn,
): Promise<Map<string, T | null>> {
  const direct = await lookups.read(names);
  const out = new Map<string, T | null>();
  const left: string[] = [];
  for (const name of names) {
    const model = direct.get(name) ?? null;
    out.set(name, model);
    if (!model) left.push(name);
  }
  if (left.length === 0) return out;

  const listed = (
    what: string,
    load: () => Promise<Map<string, string>>,
  ): Promise<Map<string, string>> =>
    load().catch((err: unknown) => {
      warn(`Could not read the game's ${what} definitions: ${reasonOf(err)}`);
      return new Map<string, string>();
    });
  const [units, features] = await Promise.all([
    listed("unit", lookups.unitObjects),
    listed("feature", lookups.featureObjects),
  ]);

  const candidates = new Map<string, string[]>();
  for (const name of left) {
    const key = name.toLowerCase();
    // A definition naming the model the author already wrote has been tried.
    const tries = [units.get(key), features.get(key)].filter(
      (object): object is string => !!object && object.toLowerCase() !== key,
    );
    if (tries.length > 0) candidates.set(name, tries);
  }
  const objects = [...new Set([...candidates.values()].flat())];
  if (objects.length === 0) return out;

  let read: Map<string, T | null>;
  try {
    read = await lookups.read(objects);
  } catch (err) {
    warn(
      `Could not read the models placed by unit or feature name: ${reasonOf(err)}`,
    );
    return out;
  }
  for (const [name, tries] of candidates) {
    for (const object of tries) {
      const model = read.get(object);
      if (model) {
        out.set(name, model);
        break;
      }
    }
  }
  return out;
}
