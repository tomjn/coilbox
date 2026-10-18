#!/usr/bin/env bun
/**
 * Generate the list of mapinfo.lua keys the engine warns about, for the map
 * page's compatibility report (issue #4565).
 *
 * The engine reads mapinfo.lua in rts/Map/MapInfo.cpp, and a key it no longer
 * wants is one it checks for with `KeyExists` and then logs a warning or a
 * deprecation about. This reads that file from the RecoilEngine checkout at the
 * tag in scripts/recoil-compat-version.txt and writes every such key to
 * src/data/engineMapInfoKeys.json.
 *
 * Every `LuaTable` variable the file declares is resolved to the mapinfo
 * section it reads, so `atmoTable.KeyExists("skyDir")` becomes
 * `atmosphere.skyDir`. A warning this script cannot tie to a key, or a key read
 * through a table it cannot resolve, throws: either means the parser moved and
 * a key could be missing from the list.
 *
 * Only `git show` reads the checkout. It is never checked out or fetched.
 *
 * Run: bun run mapinfo:keys
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "rts/Map/MapInfo.cpp";

const here = dirname(fileURLToPath(import.meta.url));
const TAG = readFileSync(
  join(here, "recoil-compat-version.txt"),
  "utf8",
).trim();
const ENGINE =
  process.env.RECOIL_ENGINE_DIR ?? join(homedir(), "dev", "RecoilEngine");

function show(path) {
  const res = spawnSync("git", ["-C", ENGINE, "show", `${TAG}:${path}`], {
    maxBuffer: 1 << 26,
  });
  if (res.status !== 0)
    throw new Error(`git show ${TAG}:${path}: ${res.stderr.toString()}`);
  return res.stdout.toString();
}

/** Replace comments with spaces, keeping string literals intact. */
function blankComments(src) {
  return src.replace(
    /("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, literal) => literal ?? match.replace(/[^\n]/g, " "),
  );
}

/**
 * The mapinfo section each `LuaTable` variable reads, from its declaration.
 * `null` marks a table that is not mapinfo.lua at all, such as the game's
 * gamedata/resources.lua.
 */
function tableSections(code) {
  const sections = new Map();
  for (const m of code.matchAll(/\bLuaTable&?\s+(\w+)\s*=\s*([^;]+);/g)) {
    const [, name, rhs] = m;
    const base = /^\(?\s*(\w+)/.exec(rhs)?.[1];
    let section;
    if (base === "mapInfoParser") section = "";
    else if (base === "resTableRoot" || base === "resParser") section = null;
    else if (sections.has(base)) section = sections.get(base);
    else throw new Error(`${SOURCE}: table ${name} reads from unknown ${base}`);
    for (const step of rhs.matchAll(/SubTable\(\s*(?:"([^"]*)"|[^)]*)\s*\)/g)) {
      if (section === null) break;
      const key = step[1] ?? "*";
      section = section === "" ? key : `${section}.${key}`;
    }
    sections.set(name, section);
  }
  return sections;
}

const code = blankComments(show(SOURCE));
const sections = tableSections(code);
if (sections.get("atmoTable") !== "atmosphere")
  throw new Error(`${SOURCE}: atmoTable no longer reads atmosphere`);

const warned = [];
const tied = new Set();
const guarded =
  /if\s*\(\s*(\w+)\s*(?:\.|->)\s*KeyExists\s*\(\s*"([^"]+)"\s*\)\s*\)\s*\{([^}]*)\}/g;
for (const m of code.matchAll(guarded)) {
  const [, table, key, body] = m;
  const log =
    /LOG_L\s*\(\s*L_(DEPRECATED|WARNING)\s*,\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  if (!log) continue;
  if (!sections.has(table))
    throw new Error(`${SOURCE}: warning on ${key} reads unknown ${table}`);
  const section = sections.get(table);
  if (section === null) continue;
  tied.add(m.index + m[0].indexOf(log[0]));
  warned.push({
    key: section === "" ? key : `${section}.${key}`,
    level: log[1].toLowerCase(),
    message: log[2].replace(/^\[[^\]]*\]\s*/, ""),
  });
}

for (const m of code.matchAll(/LOG_L\s*\(\s*L_(DEPRECATED|WARNING)\b/g)) {
  if (!tied.has(m.index))
    throw new Error(
      `${SOURCE}: a ${m[1]} log at offset ${m.index} is not tied to a key`,
    );
}
if (warned.length === 0)
  throw new Error(`${SOURCE}: no warned keys found, the parse is wrong`);

warned.sort((a, b) => a.key.localeCompare(b.key));
const out = {
  generatedBy: "scripts/build-engine-mapinfo-keys.mjs",
  engine: TAG,
  source: SOURCE,
  warned,
};
writeFileSync(
  join(here, "..", "src", "data", "engineMapInfoKeys.json"),
  `${JSON.stringify(out, null, 2)}\n`,
);
console.log(`wrote ${warned.length} warned mapinfo keys from ${TAG}`);
