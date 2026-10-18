/**
 * The pure half of scripts/build-engine-lua-compat.mjs: reading which Lua
 * functions an engine tag registers, reading the changelog, and turning both
 * into catalogue entries. Nothing here touches git or the disk, so the tests
 * can feed it small fake sources.
 */

/** The tables a game's Lua calls into. Anything else the scan finds is dropped. */
export const TABLE_ROOTS = ["Spring", "gl", "VFS", "Script"];

/**
 * Blank preprocessor lines, including every line a trailing backslash carries
 * on. The old engine defined REGISTER_LUA_CFUNC in each file with
 * lua_pushstring and lua_rawset in the body, which would otherwise read as
 * real stack operations.
 */
function blankDirectives(src) {
  const lines = src.split("\n");
  let continued = false;
  for (let i = 0; i < lines.length; i++) {
    if (continued || /^\s*#/.test(lines[i])) {
      continued = /\\\s*$/.test(lines[i]);
      lines[i] = "";
    }
  }
  return lines.join("\n");
}

/** Replace comments and preprocessor lines with spaces, keeping every line. */
export function blankComments(source) {
  const src = blankDirectives(source);
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
    if (src[i] === quote || src[i] === "\n") return i + 1;
    i++;
  }
  return src.length;
}

/** The raw text of each top-level argument of the call whose `(` is at `open`. */
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
  return { args, end: code.length - 1 };
}

const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/;

function literal(arg) {
  const m = STRING_LITERAL.exec(arg ?? "");
  return m ? m[1] : null;
}

/** `CLuaHandle::LoadStringData` gives `LoadStringData`. */
const bare = (name) =>
  name
    .replace(/<[^<>]*>/g, "")
    .split("::")
    .pop()
    .trim();

/** `LuaObjectRendering<LUAOBJ_UNIT>::PushEntries` gives `LuaObjectRendering::PushEntries`. */
const qualified = (name) =>
  name
    .replace(/<[^<>]*>/g, "")
    .split("::")
    .slice(-2)
    .join("::")
    .trim();

const REGISTERS = new Set([
  "REGISTER_LUA_CFUNC",
  "REGISTER_NAMED_LUA_CFUNC",
  "HSTR_PUSH_CFUNC",
  "LuaPushNamedCFunc",
  "LuaPushRawNamedCFunc",
]);
const KEY_PUSHES = new Set([
  "lua_pushstring",
  "lua_pushliteral",
  "LuaPushString",
  "HSTR_PUSH",
]);
const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "sizeof",
  "do",
  "else",
]);

const TOKEN = new RegExp(
  [
    // R"delim( ... )delim" raw strings, then ordinary literals.
    String.raw`R"([^(\s]*)\([\s\S]*?\)\1"`,
    String.raw`"(?:[^"\\\n]|\\.)*"`,
    String.raw`'(?:[^'\\\n]|\\.)*'`,
    "[{}]",
    // A call: an identifier, maybe qualified or templated, then `(`.
    String.raw`((?:[A-Za-z_]\w*(?:<[^<>(){};]*>)?::)*[A-Za-z_]\w*)\s*\(`,
  ].join("|"),
  "g",
);

const FUNCTION_HEAD =
  /((?:[A-Za-z_]\w*(?:<[^<>(){};]*>)?::)*~?[A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?$/;

/**
 * One file's Lua registrations. A small model of the Lua stack follows which
 * table each function lands in: `lua_pushstring(L, "UnitScript")` then
 * `lua_createtable` opens a sub-table, `lua_rawset` closes it, and
 * `lua_getglobal(L, "Script")` opens a table by absolute name.
 *
 * The table a file's PushEntries writes into is chosen by its caller, often in
 * another file, so registrations are kept relative to the enclosing C++
 * function and resolved later by resolveTables.
 */
export function scanSource(path, raw) {
  const code = blankComments(raw);
  const macros = stringifyingMacros(raw);
  const functions = [];
  const classes = [];
  let fn = null;
  let depth = 0;
  let stack = [];
  let pending = null;
  let pendingValue = false;

  const snapshot = () => stack.map((s) => ({ ...s }));
  const clearPending = () => {
    pending = null;
    pendingValue = false;
  };

  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(code); m; m = TOKEN.exec(code)) {
    const text = m[0];
    if (text[0] === '"' || text[0] === "'" || text.startsWith('R"')) continue;
    if (text === "{") {
      if (!fn) {
        const back = code.slice(
          Math.max(
            code.lastIndexOf(";", m.index - 1),
            code.lastIndexOf("}", m.index - 1),
            code.lastIndexOf("{", m.index - 1),
          ) + 1,
          m.index,
        );
        const flat = back.replace(/\s+/g, " ").trim();
        const head = FUNCTION_HEAD.exec(flat);
        const owner = /\b(?:class|struct)\s+(\w+)[^()]*$/.exec(flat);
        if (owner) {
          classes.push({ name: owner[1], depth });
        } else if (
          head &&
          !KEYWORDS.has(bare(head[1])) &&
          !/^(namespace|enum|union)\b/.test(flat)
        ) {
          // A method defined inside its class body has no `Class::` of its own.
          const inClass = classes.at(-1);
          const name = qualified(head[1]);
          fn = {
            path,
            name:
              inClass && !name.includes("::")
                ? `${inClass.name}::${name}`
                : name,
            depth,
            registrations: [],
            calls: [],
          };
          functions.push(fn);
          stack = [];
          clearPending();
        }
      }
      depth++;
      continue;
    }
    if (text === "}") {
      depth--;
      if (classes.at(-1)?.depth === depth) classes.pop();
      if (fn && depth === fn.depth) {
        fn = null;
        stack = [];
        clearPending();
      }
      continue;
    }

    const callee = m[2];
    const open = m.index + text.length - 1;
    const { args, end } = readArgs(code, open);
    const op = bare(callee);
    if (!fn) {
      TOKEN.lastIndex = end + 1;
      continue;
    }
    // Resume inside the argument list so a nested call is still seen.
    TOKEN.lastIndex = open + 1;

    if (macros.has(op)) {
      if (args[0])
        fn.registrations.push({
          name: args[0],
          cfunc: args[0],
          stack: snapshot(),
        });
      TOKEN.lastIndex = end + 1;
      continue;
    }
    if (REGISTERS.has(op)) {
      const named = op !== "REGISTER_LUA_CFUNC";
      const offset = op === "REGISTER_NAMED_LUA_CFUNC" ? 0 : 1;
      const name = named ? literal(args[offset]) : args[0];
      const cfunc = named ? args[offset + 1] : args[0];
      if (name && cfunc) {
        fn.registrations.push({
          name,
          cfunc: bare(cfunc),
          stack: snapshot(),
        });
      }
      TOKEN.lastIndex = end + 1;
      continue;
    }
    if (op === "AddEntriesToTable") {
      const table = literal(args[1]);
      if (table && args[2]) {
        fn.calls.push({
          callee: args[2].replace(/^&/, "").trim(),
          stack: [...snapshot(), { name: table }],
        });
      }
      TOKEN.lastIndex = end + 1;
      continue;
    }
    if (KEY_PUSHES.has(op)) {
      const key = literal(args[1]);
      if (pending !== null) pendingValue = true;
      else pending = key ?? "?";
      continue;
    }
    if (op === "lua_pushcfunction") {
      if (pending !== null && !pendingValue && pending !== "?") {
        fn.registrations.push({
          name: pending,
          cfunc: bare(args[1] ?? ""),
          stack: snapshot(),
        });
      }
      if (pending !== null) pendingValue = true;
      continue;
    }
    if (op === "lua_pushvalue") {
      if (pending !== null) pendingValue = true;
      else if (/GLOBALSINDEX/.test(args[1] ?? ""))
        stack.push({ name: "", abs: true });
      else stack.push({ name: "?" });
      continue;
    }
    if (op.startsWith("lua_push")) {
      if (pending !== null) pendingValue = true;
      continue;
    }
    if (op === "lua_newtable" || op === "lua_createtable") {
      stack.push({ name: pending !== null && !pendingValue ? pending : "?" });
      clearPending();
      continue;
    }
    if (op === "lua_rawget" || op === "lua_gettable") {
      stack.push({ name: pending ?? "?" });
      clearPending();
      continue;
    }
    if (op === "lua_getglobal") {
      stack.push({ name: literal(args[1]) ?? "?", abs: true });
      continue;
    }
    if (op === "lua_getfield") {
      stack.push({ name: literal(args[2]) ?? "?" });
      continue;
    }
    if (op === "lua_rawset" || op === "lua_settable") {
      if (!(pending !== null && pendingValue)) stack.pop();
      clearPending();
      continue;
    }
    if (
      op === "lua_setglobal" ||
      op === "lua_setfield" ||
      op === "lua_setmetatable"
    ) {
      stack.pop();
      clearPending();
      continue;
    }
    if (op === "lua_pop") {
      const n = Number.parseInt(args[1] ?? "1", 10);
      for (let i = 0; i < (Number.isNaN(n) ? 1 : n); i++) stack.pop();
      clearPending();
      continue;
    }
    if (op === "luaL_newmetatable" || op === "luaL_getmetatable") {
      stack.push({ name: "<meta>" });
      continue;
    }
    // Any other call passing the Lua state on is a function that may push
    // entries into whatever table is open here.
    if (
      /^\s*L\s*$/.test(args[0] ?? "") &&
      !op.startsWith("lua") &&
      !KEYWORDS.has(op)
    ) {
      fn.calls.push({ callee: callee.trim(), stack: snapshot() });
    }
  }

  // Functions whose whole body pushes constants and returns, such as
  // `int LuaSyncedRead::GetUnitTravel(lua_State* L) { lua_pushnumber(L, 0.0f); lua_pushnumber(L, 0.0f); return 2; }`.
  // The engine keeps a few of these registered so old calls do not error.
  const stubs = new Set();
  for (const m of code.matchAll(
    /^\s*int\s+(?:\w+::)*(\w+)\s*\(\s*lua_State\s*\*\s*\w+\s*\)\s*\{((?:\s*lua_push(?:nil\s*\(\s*L|(?:number|integer)\s*\(\s*L\s*,\s*-?[\d.]+f?|boolean\s*\(\s*L\s*,\s*(?:true|false|0|1))\s*\)\s*;)*\s*return\s+\d+\s*;\s*)\}/gm,
  )) {
    stubs.add(m[1]);
  }
  return { path, functions, stubs };
}

/**
 * Function-like macros a file defines that stringify their argument, such as
 * `#define PUSH_FUNCTION(x) LuaObjectRenderingImpl::PushFunction(L, x, #x)`.
 * Each one registers a Lua function named after its argument.
 */
function stringifyingMacros(raw) {
  const out = new Set();
  const joined = raw.replace(/\\\r?\n/g, " ");
  for (const m of joined.matchAll(
    /^[ \t]*#[ \t]*define[ \t]+(\w+)\([ \t]*(\w+)[ \t]*\)(.*)$/gm,
  )) {
    const body = m[3];
    if (
      new RegExp(`#\\s*${m[2]}\\b`).test(body) &&
      /CFunc|cfunction|PushFunction/i.test(body)
    )
      out.add(m[1]);
  }
  return out;
}

/** Join a context path and a stack snapshot into a dotted table path, or null. */
function tablePath(context, stack) {
  let parts = context === "" ? [] : context.split(".");
  for (const entry of stack) {
    if (entry.name === "?" || entry.name === "<meta>") return null;
    if (entry.abs) parts = entry.name === "" ? [] : [entry.name];
    else parts = [...parts, entry.name];
  }
  return parts.join(".");
}

/**
 * Resolve every file's registrations into `Map<table, Map<name, cfuncs>>`.
 * A function's tables come from whoever calls it with the Lua state, and a
 * function nobody calls is taken to run with the globals table on top.
 */
export function resolveTables(scans) {
  const all = scans.flatMap((s) => s.functions);
  const byQualified = new Map();
  const byBare = new Map();
  for (const f of all) {
    const q = f.name;
    if (!byQualified.has(q)) byQualified.set(q, []);
    byQualified.get(q).push(f);
    const b = bare(q);
    if (!byBare.has(b)) byBare.set(b, []);
    byBare.get(b).push(f);
  }
  const targets = (call, from) => {
    const name = call.callee.replace(/<[^<>]*>/g, "");
    if (name.includes("::")) return byQualified.get(qualified(name)) ?? [];
    const same = (byBare.get(name) ?? []).filter((f) => f.path === from.path);
    if (same.length > 0) return same;
    const any = byBare.get(name) ?? [];
    return any.length === 1 ? any : [];
  };

  const contexts = new Map(all.map((f) => [f, new Set()]));
  const called = new Set();
  for (const f of all)
    for (const c of f.calls) for (const t of targets(c, f)) called.add(t);
  const queue = [];
  const reach = (f, ctx) => {
    if (ctx === null || contexts.get(f).has(ctx)) return;
    contexts.get(f).add(ctx);
    queue.push([f, ctx]);
  };
  for (const f of all) if (!called.has(f)) reach(f, "");
  while (queue.length > 0) {
    const [f, ctx] = queue.shift();
    for (const c of f.calls) {
      for (const t of targets(c, f)) reach(t, tablePath(ctx, c.stack));
    }
  }

  const stubs = new Set(scans.flatMap((s) => [...s.stubs]));
  const tables = new Map();
  for (const f of all) {
    for (const ctx of contexts.get(f)) {
      for (const r of f.registrations) {
        const table = tablePath(ctx, r.stack);
        if (table === null || !TABLE_ROOTS.includes(table.split(".")[0]))
          continue;
        if (!tables.has(table)) tables.set(table, new Map());
        const names = tables.get(table);
        if (!names.has(r.name))
          names.set(r.name, { cfuncs: new Set(), files: new Set() });
        names.get(r.name).cfuncs.add(r.cfunc);
        names.get(r.name).files.add(f.path);
      }
    }
  }
  // A name is a stub only if every C++ function behind it is one.
  const out = new Map();
  for (const [table, names] of tables) {
    for (const [name, info] of names) {
      out.set(`${table}.${name}`, {
        stub: [...info.cfuncs].every((c) => stubs.has(c)),
        files: [...info.files].sort(),
      });
    }
  }
  return out;
}

/** What one tag registers: `Map<"Spring.MakeFont", { stub, files }>`. */
export function registryOf(files) {
  return resolveTables(files.map(({ path, text }) => scanSource(path, text)));
}

/**
 * For every name some walked tag registered that the newest tag does not, or
 * only as a stub: the tag its final removal landed in and the last tag that
 * still had it working. `tags` is oldest first and ends with the newest tag.
 */
export function diffRegistries(tags, registries) {
  const newest = registries.at(-1);
  const names = new Set(registries.flatMap((r) => [...r.keys()]));
  const removed = [];
  for (const name of [...names].sort()) {
    const now = newest.get(name);
    if (now && !now.stub) continue;
    let at = tags.length - 1;
    while (at > 0) {
      const before = registries[at - 1].get(name);
      if (before && !before.stub) break;
      at--;
    }
    if (at === 0) continue; // never a working function in any walked tag
    const last = registries[at - 1].get(name);
    removed.push({
      name,
      since: tags[at],
      lastSeen: tags[at - 1],
      inOldest: Boolean(
        registries[0].get(name) && !registries[0].get(name).stub,
      ),
      stub: Boolean(now?.stub),
      files: last.files,
    });
  }
  return removed;
}

/* ------------------------------------------------------------------------ */
/* The changelog                                                            */
/* ------------------------------------------------------------------------ */

const API_MENTION =
  /\b(?:Spring|gl|VFS|Script|Game|Engine|Platform|MoveCtrl|UnitDefs?|WeaponDefs?|FeatureDefs?|Lua[A-Z]\w*)\s*(?:\.|::|:)\s*[A-Za-z{]|\b(?:Get|Set)(?:\{[\w,]+\})?[A-Z]\w*|\{(?:Get|Set|S|G)[\w,]*\}\w*/;
const CALLIN_MENTION = /\bcall-?ins?\b/i;
const DEF_MENTION =
  /\b(?:Lua)?(?:unit|weapon|feature|move)?defs?\b|\b\w+defs?_post\b|\btags?\b|\bmodinfo\b|\bmodrules\b|\bcustomparams\b/i;
const FILE_MENTION = /\b[\w./-]+\.(?:lua|txt|tdf|fbi|gui|cob|bos)\b/i;
export const REMOVAL_WORDING =
  /\b(?:remov(?:e|ed|es|al)|delet(?:e|ed|es)|drop(?:s|ped)?|nuke[sd]?|get rid of|obsolete|no longer (?:available|read|supported|exists?|loaded))\b/i;
export const RENAME_WORDING =
  /\b(?:renam(?:e|ed|es)|replace[ds]?|now resides? in|moved? to)\b|→/i;

/** Whether a changelog paragraph is about something a game's Lua or defs touch. */
export function mentionsGameApi(text) {
  return (
    API_MENTION.test(text) ||
    CALLIN_MENTION.test(text) ||
    DEF_MENTION.test(text) ||
    FILE_MENTION.test(text)
  );
}

const indentOf = (line) => line.replace(/\t/g, "    ").match(/^ */)[0].length;

/**
 * Every changelog line starting with `!`, which is how the engine marks a
 * change that can break a game, with the version header above it and any
 * deeper-indented lines that continue it. Version headers are lines starting
 * `-- `.
 */
export function parseChangelog(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let version = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("-- ")) {
      version = line
        .slice(3)
        .replace(/-+\s*$/, "")
        .trim();
      continue;
    }
    if (!/^\s*!/.test(line)) continue;
    const indent = indentOf(line);
    const body = [line.trim().replace(/^!\s*/, "")];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (next.trim() === "" || indentOf(next) <= indent || /^\s*!/.test(next))
        break;
      body.push(next.trim());
    }
    out.push({ version, line: i + 1, text: body.join(" "), parts: body });
  }
  return out;
}

/** The `!` lines a compatibility catalogue cares about. */
export function filterChangelog(entries) {
  return entries.filter((e) => mentionsGameApi(e.text));
}

/** `Spring.Get{Unit,Factory}Commands` gives both names. `{Pre}` is optional. */
export function expandBraces(name) {
  const m = /\{([^{}]*)\}/.exec(name);
  if (!m) return [name];
  let options = m[1].split(",").map((o) => o.trim());
  if (options.length === 1) options = ["", options[0]];
  return options.flatMap((o) =>
    expandBraces(
      name.slice(0, m.index) + o + name.slice(m.index + m[0].length),
    ),
  );
}

const CONTINUES =
  /(?:,|\b(?:and|or|of|the|a|an|to|by|with|for|in|from|on|now))$/i;

/**
 * The sentence a `!` line opens, which is where its subject is. Wrapped lines
 * join while a line ends mid-phrase or the next starts in lower case, and a
 * line ending in a colon takes the list below it. What follows "use",
 * "instead", "see" or a bracket is advice about the replacement, so it is cut.
 */
export function leadSentence(parts) {
  let sentence = parts[0];
  for (let i = 1; i < parts.length; i++) {
    if (sentence.endsWith(":")) {
      sentence = parts.join(" ");
      break;
    }
    if (/[.!?]$/.test(sentence)) break;
    if (!(CONTINUES.test(sentence) || /^[a-z]/.test(parts[i]))) break;
    sentence = `${sentence} ${parts[i]}`;
  }
  const end = /[^.\s][.](?:\s|$)/.exec(sentence);
  if (
    end &&
    !/\b(?:e\.g|i\.e|etc|[A-Za-z])\.$/.test(sentence.slice(0, end.index + 2))
  ) {
    sentence = sentence.slice(0, end.index + 2);
  }
  const advice =
    /[,;]?\s*\b(?:use|using|instead|see|in favou?r of)\b|\s\(/i.exec(sentence);
  return advice && advice.index > 0
    ? sentence.slice(0, advice.index)
    : sentence;
}

const TABLE_ALIASES = { MoveCtrl: "Spring.MoveCtrl" };

/**
 * Names in a sentence, each with what sort of thing it is. `universe` holds
 * every function any walked tag registered, `callins` every call-in name.
 */
export function extractNames(sentence, universe, callins) {
  const found = [];
  const add = (type, name) => {
    if (!found.some((f) => f.name === name)) found.push({ type, name });
  };
  const resolveBare = (name) => {
    for (const table of [
      "Spring",
      "Spring.MoveCtrl",
      "Spring.UnitScript",
      "gl",
      "VFS",
      "Script",
    ]) {
      if (universe.has(`${table}.${name}`)) return `${table}.${name}`;
    }
    return null;
  };

  for (const m of sentence.matchAll(
    /\b(?:Lua)?(Unit|Weapon|Feature)Defs?(?:\[[^\]]*\])?(?:\.|::)((?:\w|\{[\w,\s]+\})+(?:\.(?:\w|\{[\w,\s]+\})+)*)/g,
  )) {
    for (const field of expandBraces(m[2]))
      add("defTag", `${m[1]}Defs.${field}`);
  }
  for (const m of sentence.matchAll(
    /\{((?:unit|weapon|feature)(?:,(?:unit|weapon|feature))*)\}def\.(\w+)/gi,
  )) {
    for (const side of m[1].split(",")) {
      add(
        "defTag",
        `${side[0].toUpperCase()}${side.slice(1).toLowerCase()}Defs.${m[2]}`,
      );
    }
  }
  for (const m of sentence.matchAll(/\bwdef\[\w+\]\.(\w+)/g))
    add("defTag", `WeaponDefs.${m[1]}`);
  if (/\btags?\b/i.test(sentence)) {
    const sides = ["unit", "weapon", "feature"].filter((s) =>
      new RegExp(`\\b${s}(?:def)?s?\\b`, "i").test(sentence),
    );
    if (sides.length === 1) {
      const side = `${sides[0][0].toUpperCase()}${sides[0].slice(1)}Defs`;
      for (const m of sentence.matchAll(/[`"]([A-Za-z_]\w*)[`"]/g))
        add("defTag", `${side}.${m[1]}`);
    }
  }

  for (const m of sentence.matchAll(
    /(?<![\w.])(Spring(?:\.(?:MoveCtrl|UnitScript|UnitRendering))?|gl|VFS|Script|Game|Engine|Platform|MoveCtrl)\.((?:\w|\{[\w,]+\})+)/g,
  )) {
    const table = TABLE_ALIASES[m[1]] ?? m[1];
    for (const name of expandBraces(m[2])) add("api", `${table}.${name}`);
  }
  for (const m of sentence.matchAll(/\bLua(?:Synced|Unsynced)\w*::(\w+)/g)) {
    const full = resolveBare(m[1]);
    if (full) add("api", full);
  }
  for (const m of sentence.matchAll(
    /(?<![\w.:{])((?:Get|Set|\{(?:Get|Set|S|G)[\w,]*\})(?:\w|\{[\w,]+\})*)/g,
  )) {
    for (const name of expandBraces(m[1])) {
      const full = resolveBare(name);
      if (full) add("api", full);
    }
  }
  for (const m of sentence.matchAll(
    /(?<![\w.:])((?:\{[A-Z][\w,]*\}|[A-Z][a-z]+)(?:\w|\{[\w,]+\})*)/g,
  )) {
    for (const name of expandBraces(m[1])) {
      // A one-word call-in such as Update reads as an ordinary word unless the
      // sentence says it is talking about call-ins.
      if (
        callins.has(name) &&
        (/[a-z][A-Z]/.test(name) || CALLIN_MENTION.test(sentence))
      )
        add("callin", name);
    }
  }
  for (const m of sentence.matchAll(
    /(?<![\w/.-])((?:[\w-]+\/)*[\w-]+\.(?:lua|txt|tdf|fbi|gui|cob|bos))\b/gi,
  )) {
    add("file", m[1]);
  }
  return found;
}

/** Pairs of old name to new name from rename wording in a sentence. */
function renamePairs(sentence, universe, callins) {
  const pairs = new Map();
  const names = (text) =>
    extractNames(text, universe, callins).map((n) => n.name);
  const patterns = [
    /\brenam(?:e|ed|es)\s+(.+?)\s+(?:to|into|->|-->)\s+(.+)$/i,
    /\breplace[ds]?\s+(.+?)\s+(?:by|with)\s+(.+)$/i,
    /(\S+)\s*→\s*(.+)$/,
  ];
  for (const re of patterns) {
    const m = re.exec(sentence);
    if (!m) continue;
    const to = names(m[2]);
    for (const from of names(m[1])) if (to.length > 0) pairs.set(from, to[0]);
  }
  const moved = /^(.*?)\bnow resides? in the (\w+) table/i.exec(sentence);
  if (moved) {
    for (const from of names(moved[1])) {
      pairs.set(from, `${moved[2]}.${from.split(".").pop()}`);
    }
  }
  return pairs;
}

/** Collapse runs of whitespace so a stored note never depends on wrapping. */
const squash = (text) => text.replace(/\s+/g, " ").trim();

/**
 * Entries from the filtered changelog. `registry` is the newest tag's
 * registrations, `universe` every name any walked tag registered.
 */
export function changelogEntries(lines, { registry, universe, callins }) {
  const entries = [];
  for (const line of lines) {
    const sentence = leadSentence(line.parts ?? [line.text]);
    // A line introducing something new breaks nothing that already exists.
    if (/^(?:add(?:ed|s)?\s+)?(?:a\s+)?new\b/i.test(sentence)) continue;
    const removal = REMOVAL_WORDING.test(sentence);
    const pairs = RENAME_WORDING.test(sentence)
      ? renamePairs(sentence, universe, callins)
      : new Map();
    for (const { type, name } of extractNames(sentence, universe, callins)) {
      const base = { name, since: line.version, note: squash(line.text) };
      if ([...pairs.values()].includes(name)) continue; // the new name of a rename
      if (type === "defTag") {
        entries.push({
          ...base,
          kind: "defTag",
          ...(pairs.has(name) ? { replacement: pairs.get(name) } : {}),
        });
        continue;
      }
      if (type === "file") {
        if (removal) entries.push({ ...base, kind: "file" });
        continue;
      }
      const scanned =
        type === "api" && TABLE_ROOTS.includes(name.split(".")[0]);
      const now = registry.get(name);
      const working = Boolean(now && !now.stub);
      if (pairs.has(name)) {
        entries.push({
          ...base,
          kind: "renamed",
          replacement: pairs.get(name),
        });
      } else if (removal && !working) {
        entries.push({ ...base, kind: "removed" });
      } else if (scanned && !working) {
      } else {
        entries.push({ ...base, kind: "signature" });
      }
    }
  }
  return entries;
}

/* ------------------------------------------------------------------------ */
/* Assembling the catalogue                                                 */
/* ------------------------------------------------------------------------ */

/**
 * The stable id of an entry. Removals and renames happen once per name, so the
 * name is enough. A signature can change more than once, so it carries the
 * version too.
 */
export function entryId(entry) {
  if (entry.kind === "signature")
    return `signature:${entry.name}@${entry.since}`;
  return `${entry.kind}:${entry.name}`;
}

/** A changelog line rarely ends in a full stop, so give it one before more text follows. */
const sentenceEnd = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** Entries from the source diff, with the changelog's wording folded in. */
export function mergeEntries(removed, fromChangelog) {
  const byId = new Map();
  const put = (entry) => {
    const id = entryId(entry);
    const existing = byId.get(id);
    if (existing) {
      if (!existing.note.includes(entry.note))
        existing.note = `${existing.note} ${entry.note}`;
      return;
    }
    byId.set(id, { id, ...entry });
  };

  const told = new Map();
  for (const e of fromChangelog) {
    if (e.kind === "removed" || e.kind === "renamed") {
      if (!told.has(e.name)) told.set(e.name, []);
      told.get(e.name).push(e);
    }
  }
  for (const r of removed) {
    const lines = told.get(r.name) ?? [];
    told.delete(r.name);
    const rename = lines.find((l) => l.kind === "renamed");
    const where = r.files.join(", ");
    const facts = r.stub
      ? `Still registered, but from ${r.since} only as a stub that does nothing or returns fixed values. Last working in ${r.lastSeen} (${where}).`
      : `Last registered in ${r.lastSeen} (${where}).`;
    put({
      kind: rename ? "renamed" : "removed",
      name: r.name,
      ...(rename ? { replacement: rename.replacement } : {}),
      since: r.since,
      note: squash([...lines.map((l) => sentenceEnd(l.note)), facts].join(" ")),
    });
  }
  for (const e of fromChangelog) {
    if ((e.kind === "removed" || e.kind === "renamed") && !told.has(e.name))
      continue;
    put(e);
  }
  return [...byId.values()];
}

/**
 * Fold the hand-curated overrides in. Each must quote the changelog line that
 * justifies it, and the quote must be found in the changelog, so an override
 * cannot drift away from the engine's own record. An override with the id of a
 * generated entry replaces it.
 */
export function applyOverrides(entries, overrides, changelogText) {
  const haystack = squash(changelogText);
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const o of overrides) {
    for (const key of ["kind", "name", "since", "note", "changelog"]) {
      if (typeof o[key] !== "string" || o[key] === "") {
        throw new Error(`override ${o.id ?? o.name}: missing ${key}`);
      }
    }
    if (!haystack.includes(squash(o.changelog))) {
      throw new Error(
        `override ${o.id ?? o.name}: changelog line not found: ${o.changelog}`,
      );
    }
    const { changelog, ...rest } = o;
    const id = entryId(rest);
    if (o.id !== undefined && o.id !== id) {
      throw new Error(`override ${o.id}: its id should be ${id}`);
    }
    byId.set(id, { ...rest, id });
  }
  return [...byId.values()];
}

/** Sort and shape entries so the written file depends only on its inputs. */
export function finalise(entries) {
  return entries
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      ...(e.replacement ? { replacement: e.replacement } : {}),
      since: e.since,
      note: e.note,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
