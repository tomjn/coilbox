#!/usr/bin/env bun
/**
 * Generate the catalogue of Lua APIs the engine has removed or changed, for
 * compatibility mode.
 *
 * Written from memory, a list like this is wrong. So this reads the
 * RecoilEngine checkout at every release tag from OLD_TAG to the tag in
 * scripts/recoil-compat-version.txt, and records each Lua function some
 * release registered that the newest one does not, or keeps only as a stub.
 * It then reads the newest changelog for the `!` lines that touch a function,
 * call-in, def tag or file, and folds in the hand-curated signature changes
 * from scripts/data/lua-compat-overrides.json.
 *
 * Only `git show`-style reads touch the checkout. It is never checked out,
 * fetched or reset, because it may be in use.
 *
 * Run: bun run luacompat:catalogue
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyOverrides,
  changelogEntries,
  diffRegistries,
  filterChangelog,
  finalise,
  mergeEntries,
  parseChangelog,
  REMOVAL_WORDING,
  RENAME_WORDING,
  registryOf,
} from "./lua-compat/catalogue.mjs";

/**
 * The oldest release the catalogue reaches back to. 0.81.2.1 is the last
 * release that still has Spring.MakeFont, which 0.82.0 removed, and both
 * Complete Annihilation stable-8405 and XTA 9.65 still call it although they
 * were built in the 0.82 era (September 2010 and January 2011).
 */
const OLD_TAG = "0.81.2.1";

const here = dirname(fileURLToPath(import.meta.url));
const NEW_TAG = readFileSync(
  join(here, "recoil-compat-version.txt"),
  "utf8",
).trim();
const ENGINE =
  process.env.RECOIL_ENGINE_DIR ?? join(homedir(), "dev", "RecoilEngine");

function git(args, input) {
  const res = spawnSync("git", ["-C", ENGINE, ...args], {
    input,
    maxBuffer: 1 << 30,
  });
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  }
  return res.stdout;
}

/** Release tags in version order, from OLD_TAG to NEW_TAG inclusive. */
function releaseTags() {
  const release =
    /^(?:0\.\d+\.\d+(?:\.\d+)?|(?:8[3-9]|9\d|10\d)\.\d+(?:\.\d+)?|\d{4}\.\d{2}\.\d{1,2})$/;
  const key = (tag) => tag.split(".").map(Number);
  const cmp = (a, b) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? -1) - (y[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  };
  const tags = git(["tag"])
    .toString()
    .split("\n")
    .filter((t) => release.test(t))
    .sort(cmp);
  const from = tags.indexOf(OLD_TAG);
  const to = tags.indexOf(NEW_TAG);
  if (from < 0 || to < 0 || from >= to) {
    throw new Error(
      `tags ${OLD_TAG} and ${NEW_TAG} must both exist, oldest first`,
    );
  }
  return tags.slice(from, to + 1);
}

/** The contents of many files at one tag, through one `git cat-file --batch`. */
function readAt(tag, paths) {
  const out = git(
    ["cat-file", "--batch"],
    paths.map((p) => `${tag}:${p}\n`).join(""),
  );
  const files = [];
  let at = 0;
  for (const path of paths) {
    const nl = out.indexOf(10, at);
    const header = out.subarray(at, nl).toString();
    const size = Number(header.split(" ")[2]);
    if (header.endsWith("missing") || Number.isNaN(size)) {
      throw new Error(`${tag}:${path} is missing`);
    }
    files.push({
      path,
      text: out.subarray(nl + 1, nl + 1 + size).toString("utf8"),
    });
    at = nl + 1 + size + 1;
  }
  return files;
}

const REGISTRATION =
  "REGISTER_LUA_CFUNC|REGISTER_NAMED_LUA_CFUNC|HSTR_PUSH_CFUNC|LuaPushNamedCFunc|LuaPushRawNamedCFunc|lua_pushcfunction|AddEntriesToTable|PushEntries|PushFunction";

/** Every source file at a tag that registers a Lua function or calls one that does. */
function sourcesAt(tag) {
  const paths = git([
    "grep",
    "-l",
    "-E",
    REGISTRATION,
    tag,
    "--",
    "rts/*.cpp",
    "rts/*.h",
  ])
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(tag.length + 1))
    .sort();
  return readAt(tag, paths);
}

/** Call-in names: the engine's event list plus every name its handlers look up. */
function callinsAt(tags) {
  const names = new Set();
  for (const tag of tags) {
    const out = git([
      "grep",
      "-h",
      "-o",
      "-E",
      'SETUP_(UNMANAGED_)?EVENT\\([[:space:]]*[A-Za-z_]+|LuaHashString[[:space:]]+[A-Za-z_]+\\("[A-Za-z_]+"\\)',
      tag,
      "--",
      "rts/System/Events.def",
      "rts/Lua/*.cpp",
      "rts/Game/UI/LuaUI.cpp",
    ]).toString();
    for (const m of out.matchAll(/EVENT\(\s*(\w+)|\("(\w+)"\)/g)) {
      const name = m[1] ?? m[2];
      if (/^[A-Z][a-z]/.test(name)) names.add(name);
    }
  }
  return names;
}

const tags = releaseTags();
const registries = tags.map((tag) => registryOf(sourcesAt(tag)));
const newest = registries.at(-1);
const universe = new Set(registries.flatMap((r) => [...r.keys()]));

for (const [tag, registry] of [
  [OLD_TAG, registries[0]],
  [NEW_TAG, newest],
]) {
  if (registry.size < 500) {
    throw new Error(
      `only ${registry.size} functions read from ${tag}, the scan is wrong`,
    );
  }
}

const removed = diffRegistries(tags, registries);
const changelogText = git(["show", `${NEW_TAG}:doc/changelog.txt`]).toString();
const bangLines = parseChangelog(changelogText);
const kept = filterChangelog(bangLines);
const callins = callinsAt([OLD_TAG, NEW_TAG]);
const fromChangelog = changelogEntries(kept, {
  registry: newest,
  universe,
  callins,
});
const overrides = JSON.parse(
  readFileSync(join(here, "data", "lua-compat-overrides.json"), "utf8"),
);
const entries = finalise(
  applyOverrides(
    mergeEntries(removed, fromChangelog),
    overrides,
    changelogText,
    (sha) =>
      spawnSync("git", [
        "-C",
        ENGINE,
        "merge-base",
        "--is-ancestor",
        sha,
        NEW_TAG,
      ]).status === 0,
  ),
);

for (const name of [
  "Spring.SetUnitToFeature",
  "gl.Smoothing",
  "Spring.MakeFont",
  "Spring.GetUnitTravel",
]) {
  if (!entries.some((e) => e.kind === "removed" && e.name === name)) {
    throw new Error(`${name} is not listed as removed, the scan is wrong`);
  }
}

const catalogue = {
  generatedBy: "scripts/build-engine-lua-compat.mjs",
  engine: { old: OLD_TAG, new: NEW_TAG, releasesRead: tags.length },
  entries,
  changelog: kept.map(({ version, line, text }) => ({ version, line, text })),
};
writeFileSync(
  join(here, "..", "src", "data", "engineLuaCompat.json"),
  `${JSON.stringify(catalogue, null, 2)}\n`,
);

const count = (kind) => entries.filter((e) => e.kind === kind).length;
const tables = new Map();
for (const r of removed) {
  const table = r.name.slice(0, r.name.lastIndexOf("."));
  tables.set(table, (tables.get(table) ?? 0) + 1);
}
console.log(`read ${tags.length} releases, ${OLD_TAG} to ${NEW_TAG}`);
console.log(
  `functions registered: ${registries[0].size} in ${OLD_TAG}, ${newest.size} in ${NEW_TAG}, ${universe.size} in any release`,
);
console.log(
  `functions gone or stubbed by ${NEW_TAG}: ${removed.length}` +
    ` (${removed.filter((r) => r.inOldest).length} were in ${OLD_TAG}, ${removed.filter((r) => r.stub).length} are stubs)`,
);
for (const [table, n] of [...tables].sort()) console.log(`  ${table}: ${n}`);
console.log(
  `changelog: ${bangLines.length} lines start with !, ${kept.length} touch a function, call-in, def tag or file, ` +
    `${kept.filter((l) => REMOVAL_WORDING.test(l.text) || RENAME_WORDING.test(l.text)).length} of those use removal or rename wording`,
);
console.log(`overrides: ${overrides.length}`);
console.log(
  `entries: ${entries.length} (removed ${count("removed")}, renamed ${count("renamed")}, signature ${count("signature")}, defTag ${count("defTag")}, file ${count("file")})`,
);
