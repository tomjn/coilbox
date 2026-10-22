/**
 * Which of the base game's units build a unit made in the builder (issue
 * #4515), and how a mutator puts it on their build lists.
 *
 * The mutator writes `download/coilbox_build_list.tdf`. The engine's base
 * content `gamedata/unitdefs.lua` reads every `download/*.tdf` through its
 * `download_builds.lua`, after every unit file has loaded and before the
 * game's `unitdefs_post.lua` runs, and adds each entry to the named builder's
 * `buildoptions`. So no file of the base game is covered, its post file still
 * runs, and the sandbox already puts its unit on a menu the same way.
 *
 * A game that loads its units with its own `unitdefs.lua` and never calls
 * `download_builds.lua`, or ships a `download_builds.lua` that reads something
 * else, never reads the file. Beyond All Reason, Zero-K and Spring 1944 are
 * three. `BUILD_LIST_PROBE_LUA` asks the base game which kind it is, and the
 * mutator then leaves the file out and says why.
 */

import { t } from "@lingui/core/macro";
import type { UnitDatasetEntry } from "@/content/bindings";
import { isValidUnitKey } from "@/workshop/clones";

/** One unit and the base game units that build it. */
export interface BuiltBy {
  unitName: string;
  builtBy: readonly string[];
}

/**
 * Whether the base game reads `download/*.tdf`, as a Lua snippet for
 * `unitsyncLuaExec`. `"M"` is the game's own archives without base content,
 * which is where a game's replacement for either file would be. unitsync's
 * parser has no `VFS.MOD` constant, so the letter is written out.
 */
export const BUILD_LIST_PROBE_LUA = `
local function own(path)
  if not VFS.FileExists(path, "M") then return nil end
  return VFS.LoadFile(path, "M") or ""
end
local reader = own("gamedata/download_builds.lua")
if reader and not reader:find("download/", 1, true) then return "no" end
local loader = own("gamedata/unitdefs.lua")
if loader and not loader:find("download_builds", 1, true) then return "no" end
return "yes"
`;

/** What `BUILD_LIST_PROBE_LUA` answered. The parser hands the string back quoted. */
export function readsBuildList(result: string | undefined): boolean {
  return (result ?? "").trim().replace(/^"|"$/g, "") === "yes";
}

/**
 * The units and builders that go in the file, with what is left out and why.
 * A builder `known` does not hold is left out, because the engine would drop
 * the entry anyway. `known` is null when the game's units are not read yet.
 */
export function buildListEntries(
  units: readonly BuiltBy[],
  gameName: string,
  known: Record<string, unknown> | null,
): { entries: BuiltBy[]; leftOut: string[] } {
  const entries: BuiltBy[] = [];
  const leftOut: string[] = [];
  for (const { unitName, builtBy } of units) {
    if (builtBy.length === 0) continue;
    if (!isValidUnitKey(unitName)) {
      leftOut.push(t`${unitName} cannot go on a build list.`);
      continue;
    }
    const kept: string[] = [];
    for (const builder of builtBy) {
      if (!isValidUnitKey(builder)) {
        leftOut.push(t`${builder} cannot build ${unitName}.`);
      } else if (known && !Object.hasOwn(known, builder)) {
        leftOut.push(
          t`${builder} is not in ${gameName}, so it does not build ${unitName}.`,
        );
      } else if (!kept.includes(builder)) {
        kept.push(builder);
      }
    }
    if (kept.length > 0) entries.push({ unitName, builtBy: kept });
  }
  return { entries, leftOut };
}

/**
 * The mutator's `download/coilbox_build_list.tdf`, one menu entry per builder
 * and unit. Each entry goes on the end of the builder's list. TDF has no
 * quoting, so every name has passed `buildListEntries` first.
 */
export function buildListTdf(entries: readonly BuiltBy[]): string {
  const lines = [
    "// Puts the units coilbox's builder made on the base game's build lists.",
    "// Rewritten on every launch. Delete this folder to undo it.",
  ];
  let n = 0;
  for (const { unitName, builtBy } of entries) {
    for (const builder of builtBy) {
      n += 1;
      lines.push(
        "",
        `[MENUENTRY${n}]`,
        "{",
        `\tunitmenu=${builder};`,
        `\tunitname=${unitName};`,
        "}",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A base game's unit dataset as the mutator's build list changes it: each unit
 * added, and on the end of each of its builders' `buildOptions`. So
 * `buildEdgeMap` and warpath's `disabledUnitsFor` see a built unit the way
 * they see any other, without reading the mutator back through unitsync.
 */
export function withBuiltUnits(
  units: readonly UnitDatasetEntry[],
  built: readonly (BuiltBy & { fullName?: string })[],
): UnitDatasetEntry[] {
  const builds = new Map<string, string[]>();
  for (const { unitName, builtBy } of built) {
    for (const builder of builtBy) {
      const key = builder.toLowerCase();
      builds.set(key, [...(builds.get(key) ?? []), unitName.toLowerCase()]);
    }
  }
  const names = new Set(built.map((b) => b.unitName.toLowerCase()));
  const out: UnitDatasetEntry[] = units
    .filter((u) => !names.has(u.name.toLowerCase()))
    .map((u) => {
      const added = builds.get(u.name.toLowerCase());
      if (!added) return u;
      const own = u.buildOptions ?? [];
      return {
        ...u,
        buildOptions: [...own, ...added.filter((name) => !own.includes(name))],
      };
    });
  for (const { unitName, fullName } of built) {
    out.push({
      name: unitName.toLowerCase(),
      ...(fullName ? { fullName } : {}),
      buildOptions: [],
    });
  }
  return out;
}
