import keysFile from "@/data/engineMapInfoKeys.json";
import { type Finding, readErrorsFinding } from "./compatReport";

/**
 * What would stop an old map loading on the current engine, worked out from
 * reads the map page makes (issue #4565): the archive's member list and its
 * `mapinfo.lua`. Pure, so every finding kind is tested from fixed inputs. The
 * findings are the same {@link Finding} rows the game report draws.
 */

/** One entry of `src/data/engineMapInfoKeys.json`. */
export interface WarnedMapInfoKey {
  /** Dotted path from the root of the table, such as `atmosphere.skyDir`. */
  key: string;
  level: string;
  message: string;
}

const WARNED_KEYS = keysFile.warned as WarnedMapInfoKey[];

/** One key of the evaluated `mapinfo.lua`. */
export interface MapInfoEntry {
  /** Lowercased dotted path, with array indices as numbers: `resources.detailtex`. */
  path: string;
  /** Set when the value is a string. */
  value?: string;
}

/**
 * The Lua that flattens a map's `mapinfo.lua`, run with the map's archive
 * mounted. Keys are lowercased, as the engine's parser does.
 *
 * One line out, `path=value;path`, because a string is all the parser hands
 * back. A path with no `=` holds a table or a value that is not a string. A key
 * holding a separator, a quote or a control character is left out, and so is
 * the value of a string holding one, so the parser's `%q` quoting never has to
 * be undone. Backslashes in a value become slashes, since old maps wrote
 * Windows paths and the engine reads both.
 */
export const MAPINFO_ENTRIES_LUA = `
local ok, info = pcall(VFS.Include, 'mapinfo.lua')
if not ok then error(info) end
if type(info) ~= 'table' then return '' end
local out, seen = {}, {}
local function walk(t, prefix)
  if seen[t] then return end
  seen[t] = true
  for k, v in pairs(t) do
    local key
    if type(k) == 'string' then key = string.lower(k)
    elseif type(k) == 'number' then key = tostring(k) end
    if key and not string.find(key, '[;=.\\"\\\\%c]') then
      local path = prefix == '' and key or (prefix .. '.' .. key)
      if type(v) == 'string' then
        v = string.gsub(v, '\\\\', '/')
        if string.find(v, '[;\\"%c]') then out[#out + 1] = path
        else out[#out + 1] = path .. '=' .. v end
      else
        out[#out + 1] = path
        if type(v) == 'table' then walk(v, path) end
      end
    end
  end
end
walk(info, '')
table.sort(out)
return table.concat(out, ';')
`;

/** Read {@link MAPINFO_ENTRIES_LUA}'s line back into entries. */
export function parseMapInfoEntries(
  result: string | undefined,
): MapInfoEntry[] {
  const line = (result ?? "").trim().replace(/^"|"$/g, "");
  if (line === "") return [];
  const out: MapInfoEntry[] = [];
  for (const entry of line.split(";")) {
    const at = entry.indexOf("=");
    if (at === 0 || entry === "") continue;
    out.push(
      at < 0
        ? { path: entry }
        : { path: entry.slice(0, at), value: entry.slice(at + 1) },
    );
  }
  return out;
}

export interface MapReportInputs {
  /** Every member path in the map's archive. */
  files: string[];
  /**
   * The evaluated `mapinfo.lua`, or null while it has not answered, when it
   * failed, or when the map has none.
   */
  mapinfo?: MapInfoEntry[] | null;
  /** Reads that failed, in their own words. */
  errors?: string[];
  /** Defaults to the list the app ships. */
  warnedKeys?: WarnedMapInfoKey[];
}

const lower = (p: string) => p.toLowerCase();

/** The findings for one map, in a fixed order. Empty when nothing is wrong. */
export function buildMapReport(inputs: MapReportInputs): Finding[] {
  const warnedKeys = inputs.warnedKeys ?? WARNED_KEYS;
  const files = inputs.files.map((f) => lower(f).replace(/\\/g, "/"));
  const out: Finding[] = [];

  const sm3 = files.filter((f) => f.endsWith(".sm3"));
  if (sm3.length > 0)
    out.push({
      kind: "sm3",
      label: "SM3 map, not supported since Spring 95.0",
      severity: "problem",
      details: [{ heading: "Files", lines: sm3 }],
    });

  const hasMapinfo = files.includes("mapinfo.lua");
  const smd = files.filter((f) => f.endsWith(".smd"));
  if (!hasMapinfo && smd.length === 0 && sm3.length === 0)
    out.push({
      kind: "no-map-settings",
      label: "No mapinfo.lua or .smd file",
      severity: "problem",
    });

  const models = files.filter((f) => /^(objects3d|features)\/.+\.3do$/.test(f));
  if (models.length > 0)
    out.push({
      kind: "features-3do",
      label: ".3do feature models",
      severity: "problem",
      count: models.length,
      details: [{ heading: "Models", lines: models }],
    });

  const entries = inputs.mapinfo ?? [];
  const textures = (ext: string) =>
    entries
      .filter((e) => e.value && lower(e.value).endsWith(ext))
      .map((e) => `${e.path} = ${e.value}`);

  const pcx = textures(".pcx");
  if (pcx.length > 0)
    out.push({
      kind: "textures-pcx",
      label: ".pcx textures in mapinfo.lua",
      severity: "problem",
      count: pcx.length,
      details: [{ heading: "mapinfo.lua", lines: pcx }],
    });

  const paths = new Set(entries.map((e) => e.path));
  const warned = warnedKeys.filter((k) => paths.has(lower(k.key)));
  if (warned.length > 0)
    out.push({
      kind: "mapinfo-keys",
      label: "mapinfo.lua keys the engine warns on",
      severity: "problem",
      count: warned.length,
      details: warned.map((k) => ({ heading: k.key, lines: [k.message] })),
    });

  const bmp = textures(".bmp");
  if (bmp.length > 0)
    out.push({
      kind: "textures-bmp",
      label: ".bmp textures in mapinfo.lua",
      severity: "info",
      count: bmp.length,
      details: [{ heading: "mapinfo.lua", lines: bmp }],
    });

  if (!hasMapinfo && smd.length > 0)
    out.push({
      kind: "smd-only",
      label: "No mapinfo.lua, settings from the .smd file",
      severity: "info",
      details: [{ heading: "Files", lines: smd }],
    });

  const errors = readErrorsFinding(inputs.errors ?? []);
  if (errors) out.push(errors);

  return out;
}
