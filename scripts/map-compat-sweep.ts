#!/usr/bin/env bun
/**
 * Run the map compatibility report (issue #4565) over every map archive in a
 * folder, from inputs read straight from the archives, and print how many maps
 * have each finding kind.
 *
 * The member list comes from `7zz l`. Each archive's Lua files are extracted to
 * a scratch folder, and mapinfo.lua is evaluated under luajit with a stand-in
 * VFS and Spring table, through the same MAPINFO_ENTRIES_LUA the app runs. The
 * map archives are only read. The scratch folder is created by this script and
 * deleted at the end.
 *
 * Needs `7zz` and `luajit` on PATH.
 *
 * Run: bun scripts/map-compat-sweep.ts <maps folder> <scratch folder>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildMapReport,
  MAPINFO_ENTRIES_LUA,
  parseMapInfoEntries,
} from "../src/content/mapCompatReport";

const [mapsDir, scratch] = process.argv.slice(2);
if (!mapsDir || !scratch) {
  console.error("usage: bun scripts/map-compat-sweep.ts <maps> <scratch>");
  process.exit(2);
}
if (existsSync(scratch)) {
  console.error(`${scratch} already exists, give a folder that does not`);
  process.exit(2);
}

const ARCHIVE = /\.(sd7|sdz)$/i;

function run(cmd: string, args: string[], input?: string) {
  const res = spawnSync(cmd, args, { input, maxBuffer: 1 << 28 });
  if (res.error) throw res.error;
  return res;
}

/** Every file under `dir`, as slash-separated paths relative to it. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full, base)
      : [relative(base, full).split("\\").join("/")];
  });
}

/** Member files of an `.sd7` or `.sdz`, folders left out. */
function members(archive: string): string[] {
  const res = run("7zz", ["l", "-slt", "-ba", archive]);
  if (res.status !== 0) throw new Error(res.stderr.toString());
  const out: string[] = [];
  for (const block of res.stdout.toString().split(/\n\s*\n/)) {
    const path = /^Path = (.*)$/m.exec(block)?.[1];
    if (
      path &&
      !/^Folder = \+$/m.test(block) &&
      !/^Attributes = D/m.test(block)
    )
      out.push(path.split("\\").join("/"));
  }
  return out;
}

const lua = (s: string) => JSON.stringify(s);

/** The luajit program that evaluates `mapinfo.lua` the way the app does. */
function harness(root: string, files: string[]): string {
  const index = files
    .map((f) => `[${lua(f.toLowerCase())}] = ${lua(f)}`)
    .join(",\n");
  return `
local root = ${lua(root)}
local files = {
${index}
}
local function find(path)
  return files[string.lower(string.gsub(path, '\\\\', '/'))]
end
VFS = {
  RAW = 'r', MOD = 'M', GAME = 'M', MAP = 'm', BASE = 'b', MENU = 'e',
  ZIP = 'Mmeb', RAW_FIRST = 'rMmeb', ZIP_FIRST = 'Mmebr', RAW_ONLY = 'r', ZIP_ONLY = 'Mmeb',
}
VFS.FileExists = function(path) return find(path) ~= nil end
VFS.LoadFile = function(path)
  local real = find(path)
  if not real then return nil end
  local f = io.open(root .. '/' .. real, 'rb')
  if not f then return nil end
  local s = f:read('*a'); f:close(); return s
end
VFS.Include = function(path, env)
  local src = VFS.LoadFile(path)
  if not src then error('file not found: ' .. path) end
  local chunk, err = loadstring(src, path)
  if not chunk then error(err) end
  setfenv(chunk, env or getfenv(2))
  return chunk()
end
VFS.DirList = function() return {} end
VFS.SubDirs = function() return {} end
local function empty() return {} end
local function nothing() end
Spring = {
  GetMapOptions = empty, GetModOptions = empty, GetMapOption = nothing,
  Echo = nothing, Log = nothing, GetGameFrame = function() return 0 end,
}
Game = { mapName = '', squareSize = 8, gameSpeed = 30 }
io.write((function()
${MAPINFO_ENTRIES_LUA}
end)())
`;
}

mkdirSync(scratch, { recursive: true });
const names = readdirSync(mapsDir).sort();
const maps = names.filter(
  (n) =>
    ARCHIVE.test(n) ||
    (/\.sdd$/i.test(n) && statSync(join(mapsDir, n)).isDirectory()),
);
const byKind = new Map<string, string[]>();
const perMap: Record<string, string[]> = {};
try {
  for (const name of maps) {
    const archive = join(mapsDir, name);
    const errors: string[] = [];
    let files: string[];
    let root: string;
    let luaFiles: string[];
    if (ARCHIVE.test(name)) {
      files = members(archive);
      root = join(scratch, name);
      mkdirSync(root);
      const x = run("7zz", [
        "x",
        `-o${root}`,
        "-y",
        archive,
        "-ir!*.lua",
        "-ir!*.LUA",
        "-ir!*.Lua",
      ]);
      if (x.status !== 0) errors.push(`extract: ${x.stderr.toString().trim()}`);
      luaFiles = walk(root);
    } else {
      files = walk(archive);
      root = archive;
      luaFiles = files.filter((f) => /\.lua$/i.test(f));
    }

    let mapinfo = null;
    if (files.some((f) => f.toLowerCase() === "mapinfo.lua")) {
      const res = run(
        "luajit",
        [
          "-e",
          "local f, err = loadstring(io.read('*a')); if not f then io.stderr:write(err); os.exit(1) end f()",
        ],
        harness(root, luaFiles),
      );
      if (res.status === 0)
        mapinfo = parseMapInfoEntries(res.stdout.toString());
      else errors.push(`mapinfo.lua: ${res.stderr.toString().trim()}`);
    }

    const findings = buildMapReport({ files, mapinfo, errors });
    perMap[name] = findings.map((f) =>
      f.count === undefined ? f.kind : `${f.kind} (${f.count})`,
    );
    for (const f of findings) {
      const list = byKind.get(f.kind) ?? [];
      list.push(name);
      byKind.set(f.kind, list);
      if (f.kind === "read-errors")
        for (const d of f.details ?? [])
          for (const l of d.lines) console.error(`${name}: ${l}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const clean = maps.filter((m) => perMap[m].length === 0).length;
console.log(
  JSON.stringify(
    {
      entries: names.length,
      maps: maps.length,
      clean,
      byKind: Object.fromEntries(
        [...byKind].map(([kind, list]) => [kind, { maps: list.length, list }]),
      ),
      perMap,
    },
    null,
    2,
  ),
);
