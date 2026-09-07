#!/usr/bin/env bun
/**
 * Generate the unit and weapon definition field registry from RecoilEngine.
 *
 * Every field a unit or weapon definition can carry is decided by the engine's
 * parsers, and nothing exposes that list at runtime. Hand-writing it means the
 * registry is only ever as complete as somebody's memory, so this reads the
 * parsers at the tag in scripts/recoil-unitdefs-version.txt and commits the
 * result.
 *
 * Two call shapes carry the keys:
 *
 *   1. Declared tags in WeaponDef.cpp. `WEAPONTAG(float, range).defaultValue(10)
 *      .description("...")` and its DUMMYTAG sibling. These carry the engine's
 *      own type, default, bounds and help text.
 *   2. LuaTable reads. `udTable.GetFloat("buildTime", 100.0f)`. A read nested in
 *      the default slot is a fallback for the outer key, so
 *      `GetFloat("health", GetFloat("maxDamage", 100.0f))` yields two keys and
 *      records that health falls back to maxDamage.
 *
 * A read whose key is not a string literal cannot become a field. Those are
 * listed in ENGINE_UNPARSED_READS rather than dropped, so the gap is in the diff
 * and in the tests. A read through a table this script has never seen throws:
 * that means a parser moved and whole sections could be missing, which is not
 * something to paper over.
 *
 * Run: bun run unitfields:defaults
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ref = readFileSync(
  join(here, "recoil-unitdefs-version.txt"),
  "utf8",
).trim();
const base = `https://raw.githubusercontent.com/beyond-all-reason/RecoilEngine/${ref}/rts`;

/**
 * The parsers to scan, which side of the registry each one feeds, and the
 * section every LuaTable variable in it reads from. A variable missing from
 * `tables` is a hard error: this script will not guess where a key lives.
 */
const SOURCES = [
  {
    path: "Sim/Units/UnitDef.cpp",
    side: "unit",
    tables: {
      udTable: "",
      weaponsTable: "weapons",
      wTable: "weapons.*",
      weaponTable: "weapons.*",
      buildsTable: "buildOptions",
      paramsTable: "customParams",
      sfxTable: "SFXTypes",
      cegTbls: "SFXTypes.*",
      // The root of the whole defs file, not a unit def.
      rootTable: null,
    },
  },
  {
    path: "Sim/Units/UnitDefHandler.cpp",
    side: "unit",
    tables: {
      udTable: "",
      soundsTable: "sounds",
      sndTable: "sounds.*",
      sndFileTable: "sounds.*.*",
      rootTable: null,
      // defsParser->GetRoot(), the whole defs file rather than one def.
      "GetRoot()": null,
    },
    helpers: [
      { call: "LoadSounds", keyArg: 2, section: "sounds", type: "string" },
    ],
  },
  {
    path: "Sim/Objects/SolidObjectDef.cpp",
    side: "unit",
    tables: {
      odTable: "",
      table: "",
      cvTable: "collisionVolume",
      svTable: "selectionVolume",
    },
  },
  {
    path: "Sim/Weapons/WeaponDef.cpp",
    side: "weapon",
    tables: {
      wdTable: "",
      dmgTable: "damage",
      siTbl: "scarIndices",
    },
    helpers: [{ call: "LoadSound", keyArg: 1, section: "", type: "string" }],
  },
];

/** LuaTable accessors that take a key as their first argument. */
const KEYED = {
  Get: "any",
  GetInt: "integer",
  GetBool: "boolean",
  GetFloat: "number",
  GetFloat3: "float3",
  GetFloat4: "float4",
  GetString: "string",
  GetLength: "table",
  SubTable: "table",
  SubTableExpr: "table",
  KeyExists: "any",
};

/** LuaTable accessors that read the whole table, so any key in it is legal. */
const WHOLE_TABLE = new Set(["GetKeys", "GetPairs", "GetMap", "IsValid"]);

const ACCESSOR = new RegExp(
  `(?:\\.|->)\\s*(${[...Object.keys(KEYED), ...WHOLE_TABLE].join("|")})\\s*\\(`,
  "g",
);

/** Replace comments with spaces, keeping every byte offset and line intact. */
function blankComments(src) {
  let out = "";
  for (let i = 0; i < src.length; ) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === "\n" ? "\n" : " ";
      continue;
    }
    if (src[i] === '"' || src[i] === "'") {
      const end = skipQuoted(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

/** Index just past the string or character literal opening at `start`. */
function skipQuoted(src, start) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i++;
  }
  throw new Error(`unterminated literal at offset ${start}`);
}

/**
 * Split the argument list whose `(` sits at `open`, returning the raw text of
 * each top-level argument and the index of the closing `)`.
 */
function readArgs(code, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'") {
      i = skipQuoted(code, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        const last = code.slice(start, i).trim();
        if (last !== "" || args.length > 0) args.push(last);
        return { args, end: i };
      }
      continue;
    }
    if (c === "," && depth === 1) {
      args.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error(`unbalanced arguments from offset ${open}`);
}

const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/;

/** The text of a C++ string literal argument, or null if it is not one. */
function literal(arg) {
  const m = STRING_LITERAL.exec(arg ?? "");
  return m ? m[1] : null;
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === "\n") line++;
  return line;
}

/**
 * The last segment of the receiver expression left of a `.` or `->` at `dot`.
 * `cegTbls[i]->` gives `cegTbls[i]`, `defsParser->GetRoot().` gives `GetRoot()`
 * and a C cast such as `(std::uint16_t)udTable.` gives `udTable`.
 */
const RECEIVER = /([A-Za-z_]\w*)(\(\))?(\[[^\]]*\])?\s*$/;

function receiverAt(code, dot) {
  const m = RECEIVER.exec(code.slice(0, dot));
  return m ? m[0].trim() : "";
}

const joinSection = (parent, key) => (parent === "" ? key : `${parent}.${key}`);

/** Collected fields, merged by the dotted path they sit at. */
class Registry {
  constructor() {
    this.byId = new Map();
    this.openTables = new Set();
    this.unparsed = [];
  }

  add(field) {
    // The engine spells a nested key two ways: as a read on a sub-table, and
    // flat with a dot in a tag name. Both mean the same field, so the dotted
    // path is the identity and section and key come back off it.
    const id = joinSection(field.section, field.key);
    const cut = id.lastIndexOf(".");
    const { source, ...rest } = field;
    rest.section = cut < 0 ? "" : id.slice(0, cut);
    rest.key = cut < 0 ? id : id.slice(cut + 1);
    const existing = this.byId.get(id);
    if (!existing) {
      this.byId.set(id, {
        ...rest,
        defaults: field.defaults.filter((d) => d !== undefined),
        fallsBackTo: field.fallsBackTo ?? [],
        sources: [source],
      });
      return;
    }
    for (const d of field.defaults) {
      if (d !== undefined && !existing.defaults.includes(d))
        existing.defaults.push(d);
    }
    for (const f of field.fallsBackTo ?? []) {
      if (!existing.fallsBackTo.includes(f)) existing.fallsBackTo.push(f);
    }
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (field.description && !existing.description)
      existing.description = field.description;
    for (const k of ["minimum", "maximum", "scale"]) {
      if (field[k] !== undefined && existing[k] === undefined)
        existing[k] = field[k];
    }
    // KeyExists and Get carry no type of their own, so never let them
    // overwrite a real one.
    if (existing.type === "any" && field.type !== "any")
      existing.type = field.type;
  }

  list() {
    return [...this.byId.values()].sort(
      (a, b) =>
        a.section.localeCompare(b.section) || a.key.localeCompare(b.key),
    );
  }
}

/** A default slot that is nothing but one more table read, and nothing else. */
const BARE_READ = new RegExp(
  `^[A-Za-z_]\\w*\\s*(?:\\.|->)\\s*(${Object.keys(KEYED).join("|")})\\s*\\(`,
);

/**
 * Follow a chain of reads in the default slot down to the literal at the
 * bottom, which is the value a def gets when it names none of the keys.
 * Returns that default plus every key the engine falls back to on the way.
 */
function resolveDefault(arg) {
  const fallbacks = [];
  let text = arg;
  for (;;) {
    const m = BARE_READ.exec(text);
    if (!m) break;
    const { args, end } = readArgs(text, m[0].length - 1);
    // Anything trailing the call means the default is an expression, not a
    // plain fallback to another key.
    if (text.slice(end + 1).trim() !== "") break;
    const key = literal(args[0]);
    if (key === null) break;
    fallbacks.push({ key, getter: m[1] });
    if (args.length < 2) return { default: undefined, fallbacks };
    text = args[1].trim();
  }
  return { default: text === "" ? undefined : text, fallbacks };
}

/** Every keyed and whole-table read in one parser. */
function scanReads(source, code, registry) {
  // Closing paren index of a SubTable call, to the section it opened, so
  // `wdTable.SubTable("customParams").GetMap(...)` resolves its receiver.
  const chained = new Map();
  ACCESSOR.lastIndex = 0;
  for (let m = ACCESSOR.exec(code); m; m = ACCESSOR.exec(code)) {
    const getter = m[1];
    const dot = m.index;
    const raw = receiverAt(code, dot);
    const recv = raw.replace(/\[[^\]]*\]/g, "");
    let section;
    if (recv in source.tables) {
      section = source.tables[recv];
    } else if (chained.has(dot - 1)) {
      section = chained.get(dot - 1);
    } else {
      throw new Error(
        `${source.path}:${lineOf(code, dot)}: read through unknown table ` +
          `'${raw || code.slice(dot - 40, dot)}'. Add it to SOURCES with the ` +
          `section it reads, or the registry will be missing every key ` +
          `under it.`,
      );
    }
    const { args, end } = readArgs(code, m.index + m[0].length - 1);
    // Resume inside the argument list rather than past it, so a read nested in
    // a default slot is still seen in its own right.
    ACCESSOR.lastIndex = m.index + m[0].length;
    if (section === null) continue;
    const where = `rts/${source.path}:${lineOf(code, dot)}`;
    if (getter.startsWith("SubTable") && literal(args[0]) !== null)
      chained.set(end, joinSection(section, literal(args[0])));

    if (WHOLE_TABLE.has(getter) || args.length === 0) {
      if (getter !== "IsValid" && section !== "")
        registry.openTables.add(section);
      continue;
    }

    const key = literal(args[0]);
    if (key === null) {
      registry.unparsed.push({
        where,
        call: `${raw}.${getter}(${args.join(", ")})`,
      });
      continue;
    }

    const resolved =
      args.length > 1 ? resolveDefault(args[1]) : { fallbacks: [] };
    const chain = [{ key, getter }, ...resolved.fallbacks];
    chain.forEach((step, at) => {
      const next = chain[at + 1];
      registry.add({
        key: step.key,
        type: KEYED[step.getter],
        section,
        defaults: [resolved.default],
        fallsBackTo: next ? [next.key] : [],
        source: where,
      });
    });
  }
}

const TAG = /^(WEAPONTAG|WEAPONDUMMYTAG)\s*\(/gm;
const TAG_TYPES = {
  "std::string": "string",
  string: "string",
  float: "number",
  int: "integer",
  unsigned: "integer",
  "unsigned int": "integer",
  bool: "boolean",
  table: "table",
  float3: "float3",
  float4: "float4",
};

/** The `WEAPONTAG(type, name).defaultValue(x).description(y);` declarations. */
function scanTags(source, code, registry) {
  TAG.lastIndex = 0;
  let found = 0;
  for (let m = TAG.exec(code); m; m = TAG.exec(code)) {
    const { args, end } = readArgs(code, m.index + m[0].length - 1);
    const cppType = args[0].trim();
    if (!(cppType in TAG_TYPES)) {
      throw new Error(
        `rts/${source.path}:${lineOf(code, m.index)}: unmapped tag type '${cppType}'`,
      );
    }
    const chain = {};
    let i = end + 1;
    while (i < code.length && code[i] !== ";") {
      const dot = code.indexOf(".", i);
      if (dot < 0 || dot > code.indexOf(";", i)) break;
      const open = code.indexOf("(", dot);
      const method = code.slice(dot + 1, open).trim();
      const call = readArgs(code, open);
      chain[method] = call.args[0] ?? "";
      i = call.end + 1;
    }
    TAG.lastIndex = Math.max(i, end + 1);
    found++;

    const key = literal(chain.externalName) ?? args[1].trim();
    const fallback = literal(chain.fallbackName);
    const field = {
      key,
      type: TAG_TYPES[cppType],
      section: "",
      defaults: [chain.defaultValue],
      fallsBackTo: fallback !== null && fallback !== key ? [fallback] : [],
      source: `rts/${source.path}:${lineOf(code, m.index)}`,
      description: literal(chain.description) ?? undefined,
      minimum: chain.minimumValue,
      maximum: chain.maximumValue,
      scale: chain.scaleValue,
    };
    registry.add(field);
    if (field.fallsBackTo.length > 0) {
      registry.add({ ...field, key: fallback, fallsBackTo: [] });
    }
    if (field.type === "table") registry.openTables.add(key);
  }
  if (found < 150) {
    throw new Error(
      `only ${found} weapon tags parsed from ${source.path}, the parse is wrong`,
    );
  }
}

/**
 * Sound keys reach the LuaTable read through a helper's parameter, so the read
 * itself has no literal to take. The helper's call sites do, which is where
 * these come from.
 */
function scanHelpers(source, code, registry) {
  for (const helper of source.helpers ?? []) {
    const call = new RegExp(`\\b${helper.call}\\s*\\(`, "g");
    let found = 0;
    for (let m = call.exec(code); m; m = call.exec(code)) {
      const { args, end } = readArgs(code, m.index + m[0].length - 1);
      call.lastIndex = end;
      const key = literal(args[helper.keyArg]);
      if (key === null) continue; // the helper's own declaration
      registry.add({
        key,
        type: helper.type,
        section: helper.section,
        defaults: ['""'],
        source: `rts/${source.path}:${lineOf(code, m.index)}`,
      });
      found++;
    }
    if (found === 0) {
      throw new Error(
        `no ${helper.call} call sites in ${source.path}, the parse is wrong`,
      );
    }
  }
}

async function fetchSource(path) {
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) throw new Error(`fetch ${path} at ${ref}: ${res.status}`);
  return res.text();
}

const registries = { unit: new Registry(), weapon: new Registry() };

for (const source of SOURCES) {
  const code = blankComments(await fetchSource(source.path));
  const registry = registries[source.side];
  scanReads(source, code, registry);
  scanHelpers(source, code, registry);
  if (source.path.endsWith("WeaponDef.cpp")) scanTags(source, code, registry);
}

const unit = registries.unit.list();
const weapon = registries.weapon.list();
const unparsed = [...registries.unit.unparsed, ...registries.weapon.unparsed];
const openTables = {
  unit: [...registries.unit.openTables].sort(),
  weapon: [...registries.weapon.openTables].sort(),
};

if (unit.length < 200 || weapon.length < 200) {
  throw new Error(
    `only ${unit.length} unit and ${weapon.length} weapon fields, the parse is wrong`,
  );
}

const file = `// Generated by scripts/build-engine-unit-fields.mjs. Do not edit.
// Source: RecoilEngine ${ref}, the unit and weapon definition parsers.
// Regenerate with: bun run unitfields:defaults

import type { EngineField, UnparsedRead } from "./unitFields";

/** The RecoilEngine tag these fields were read from. */
export const ENGINE_DEF_REF = ${JSON.stringify(ref)};

/** Every key the engine reads from a unit definition. */
export const ENGINE_UNIT_FIELDS: EngineField[] = ${JSON.stringify(unit, null, 2)};

/** Every key the engine reads from a weapon definition. */
export const ENGINE_WEAPON_FIELDS: EngineField[] = ${JSON.stringify(weapon, null, 2)};

/** Sub-tables the engine reads whole, so a game may put any key in them. */
export const ENGINE_OPEN_TABLES: { unit: string[]; weapon: string[] } = ${JSON.stringify(openTables, null, 2)};

/**
 * Reads whose key is built at runtime, so no key could be recovered. Listed so
 * the gap is visible in review rather than silently absent from the registry.
 */
export const ENGINE_UNPARSED_READS: UnparsedRead[] = ${JSON.stringify(unparsed, null, 2)};
`;

writeFileSync(
  join(here, "..", "src", "content", "engineUnitFields.generated.ts"),
  file,
);
console.log(
  `wrote ${unit.length} unit fields and ${weapon.length} weapon fields from ${ref}`,
);
console.log(`${unparsed.length} reads had no literal key:`);
for (const u of unparsed) console.log(`  ${u.where}  ${u.call}`);
