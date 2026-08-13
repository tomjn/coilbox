/**
 * A game's own equivalence table, read out of its archive (issue #1526).
 *
 * Beyond All Reason keeps one at
 * `luaui/Include/blueprint_substitution/definitions.lua`, as category -> side ->
 * unit, which is the shape `./equivalents.ts` arrived at separately. It is the
 * only game that publishes one, so nothing here is load bearing: a game without
 * the file gets nothing and everything else carries on as it did.
 *
 * What it is worth is measured rather than assumed. Of its 87 categories, 23 are
 * pairs the prefix swap in `./substitution.ts` gets wrong or cannot reach for
 * Armada and Cortex, `armanni` to `cordoom` and `armbeamer` to `corhllt` among
 * them, and it answers for Legion as well. Every category bar the commander is a
 * building, so it reaches none of the queued units, which are still the ones a
 * person has to answer for by hand.
 *
 * ## Why it is run rather than parsed
 *
 * The file `VFS.Include`s `gamedata/sides_enum.lua`, defines its categories
 * through a local function and only fills its tables in when
 * `defineUnitCategories()` runs. So it has to be evaluated, and the archive Lua
 * console from issue #47 already evaluates Lua with the game's archives mounted,
 * which is what makes `VFS.Include` resolve. No Rust, and the same unitsync the
 * rest of the app reads games with.
 *
 * What comes back is a string, because that is all the unitsync Lua parser can
 * return, so {@link SHIPPED_TABLE_LUA} flattens the table into one line and
 * {@link shippedGroups} reads it back. The parser wraps a returned string in
 * quotes on the way out, which is the one piece of quoting worth knowing about.
 *
 * ## The side keys
 *
 * The file keys its sides by BAR's own enum, whose values are `arm`, `cor` and
 * `leg`: the same strings the sides' units are named with. So a key is matched
 * to a side by that side's prefix, and a key no side of the game claims is
 * dropped rather than guessed at. That is the whole of the mapping, and it is
 * why a game with no readable prefixes gets nothing out of this even if it
 * shipped the file.
 *
 * Pure values. Running the Lua is `./useShippedEquivalents.ts`.
 */

import type { Equivalence, EquivalenceTable } from "./equivalents";
import type { SideUnits } from "./substitution";

/**
 * The Lua that reads the game's table and flattens it into one line.
 *
 * One piece per category, `CATEGORY:side=unit|side=unit`, sorted so two runs of
 * it against the same game give the same string. The include populates the
 * module as it loads, so there is nothing to call.
 */
export const SHIPPED_TABLE_LUA = `
local ok, defs = pcall(VFS.Include, "luaui/Include/blueprint_substitution/definitions.lua")
if not ok or type(defs) ~= "table" or type(defs.categoryUnits) ~= "table" then return "" end
local names = {}
for category in pairs(defs.categoryUnits) do names[#names + 1] = category end
table.sort(names)
local out = {}
for _, category in ipairs(names) do
  local sides = {}
  for side in pairs(defs.categoryUnits[category]) do sides[#sides + 1] = side end
  table.sort(sides)
  local held = {}
  for _, side in ipairs(sides) do
    held[#held + 1] = side .. "=" .. tostring(defs.categoryUnits[category][side])
  end
  out[#out + 1] = category .. ":" .. table.concat(held, "|")
end
return table.concat(out, ";")
`;

/** One thing the game says it has a version of per side, by the game's own side
 *  keys rather than its side names. */
export type ShippedGroup = Record<string, string>;

/**
 * The groups a game's own table names, read back off one line of it.
 *
 * Nothing here trusts what it finds: this is a string a game produced, so a
 * category naming fewer than two sides is dropped, because a group is a
 * comparison and one name compares to nothing, and anything that does not read
 * as `key=value` is skipped rather than guessed at. A category the game lists
 * twice is kept once.
 */
export function shippedGroups(result: string | undefined): ShippedGroup[] {
  const line = (result ?? "").trim().replace(/^"|"$/g, "");
  if (line === "") return [];

  const out: ShippedGroup[] = [];
  const seen = new Set<string>();
  for (const category of line.split(";")) {
    const at = category.indexOf(":");
    if (at < 0) continue;

    const group: ShippedGroup = {};
    for (const held of category.slice(at + 1).split("|")) {
      const [key, def] = held.split("=");
      const name = (def ?? "").trim().toLowerCase();
      if (!key || key.trim() === "" || name === "") continue;
      group[key.trim()] = name;
    }
    if (Object.keys(group).length < 2) continue;

    const key = JSON.stringify(Object.entries(group).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(group);
  }
  return out;
}

/**
 * What a game's own table says, in the sides' own names.
 *
 * A key is the side whose units are named with it, and a key no side claims is
 * dropped: a wrong pairing is worse than a missing one, because it silently
 * changes what a base builds. A group left naming fewer than two sides goes with
 * it, and a game whose sides have no prefixes to match on gets nothing at all.
 */
export function shippedEquivalents(
  result: string | undefined,
  sides: readonly SideUnits[],
): EquivalenceTable {
  const named = new Map(
    sides
      .filter((side) => side.prefix !== "")
      .map((side) => [side.prefix.toLowerCase(), side.side] as const),
  );

  const groups: Equivalence[] = [];
  for (const group of shippedGroups(result)) {
    const kept: Equivalence = {};
    for (const [key, def] of Object.entries(group)) {
      const side = named.get(key.toLowerCase());
      if (side) kept[side] = def;
    }
    if (Object.keys(kept).length >= 2) groups.push(kept);
  }
  return { groups };
}
