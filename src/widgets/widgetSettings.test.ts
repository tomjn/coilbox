import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { WidgetConfigFile } from "./handlers";
import type { ConfigFileIO } from "./widgetConfig";
import type { WidgetSwitch } from "./widgetNames";
import {
  loadWidgetSettings,
  mentionsGetConfigData,
  readSettings,
  type SettingNode,
  saveWidgetSettings,
  writeSettings,
} from "./widgetSettings";

/** What luajit makes of a whole file, as JSON with every key tagged by its
 *  type, so a test can check the handler would read it back. */
function readBack(lua: string): unknown {
  const script = `
    local f, err = loadstring(io.read("*a"))
    if not f then io.stderr:write(err) os.exit(1) end
    setfenv(f, {math = {huge = math.huge}})
    local ok, value = pcall(f)
    if not ok then io.stderr:write(tostring(value)) os.exit(1) end
    local function jstr(s)
      s = s:gsub("[\\\\\\"]", "\\\\%0"):gsub("\\n", "\\\\n"):gsub("\\r", "\\\\r")
      s = s:gsub("%c", function(c)
        return string.format("\\\\u%04x", string.byte(c))
      end)
      return '"' .. s .. '"'
    end
    local function dump(v)
      local t = type(v)
      if t == "string" then return jstr(v) end
      if t == "number" and (v == math.huge or v == -math.huge) then return jstr(tostring(v)) end
      if t == "number" or t == "boolean" then return tostring(v) end
      if t ~= "table" then return "null" end
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = k end
      table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
      local parts = {}
      for _, k in ipairs(keys) do
        parts[#parts + 1] = jstr(type(k) .. ":" .. tostring(k))
          .. ":" .. dump(v[k])
      end
      return "{" .. table.concat(parts, ",") .. "}"
    end
    io.write(dump(value))
  `;
  const result = spawnSync("luajit", ["-e", script], {
    input: lua,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "luajit failed");
  return JSON.parse(result.stdout);
}

const nested: WidgetConfigFile = { files: ["{short}.lua"], shape: "nested" };
const separate: WidgetConfigFile = {
  files: ["{SHORT}_order.lua"],
  shape: "flat",
  dataFiles: ["{SHORT}_data.lua"],
};

const sw = (
  name: string,
  previousNames: string[] = [],
): Extract<WidgetSwitch, { kind: "ready" }> => ({
  kind: "ready",
  name,
  previousNames,
});

/** As the engine's `savetable.lua` writes it, data and all. */
const NESTED_FILE = `-- Widget Custom data and order, order = 0 disabled widget
return {
\tdata = {
\t\t["Build Watch"] = {
\t\t\tcolours = {
\t\t\t\t[1] = 0.5,
\t\t\t\t[2] = 1,
\t\t\t},
\t\t\tenabled = true,
\t\t\tlabel = "say \\"hi\\"\\
next line",
\t\t\tsize = 12,
\t\t},
\t\t["odd-name.v2"] = {
\t\t\tlimit = math.huge,
\t\t\tname = "caf\\195\\169",
\t\t},
\t\tOther = {
\t\t\tkeep = 1,
\t\t},
\t},
\torder = {
\t\t["Build Watch"] = 14,
\t},
}
`;

/** Zero-K's data file, with the `version` key it adds. */
const FLAT_DATA = `-- Widget Custom Data
return {
\t["Chili Minimap"] = {
\t\tsize = 3,
\t},
\tversion = 6,
}
`;

function find(root: SettingNode, ...labels: string[]): SettingNode {
  let node = root;
  for (const label of labels) {
    if (node.kind !== "table") throw new Error(`${node.label} is no table`);
    const next = node.children.find((c) => c.label === label);
    if (!next) throw new Error(`no ${label}`);
    node = next;
  }
  return node;
}

describe("readSettings", () => {
  it("shows a widget's keys and values with their types", () => {
    const got = readSettings(NESTED_FILE, nested, sw("Build Watch"));
    expect(got?.name).toBe("Build Watch");
    const root = got?.root as SettingNode;
    expect(root.kind).toBe("table");
    expect(find(root, "size")).toMatchObject({ kind: "number", value: 12 });
    expect(find(root, "enabled")).toMatchObject({
      kind: "boolean",
      value: true,
    });
    expect(find(root, "label")).toMatchObject({
      kind: "string",
      value: 'say "hi"\nnext line',
    });
    expect(find(root, "colours").kind).toBe("table");
    expect(find(root, "colours", "2")).toMatchObject({
      kind: "number",
      value: 1,
    });
  });

  it("shows what it does not evaluate, or cannot round trip, as written", () => {
    const root = readSettings(NESTED_FILE, nested, sw("odd-name.v2"))
      ?.root as SettingNode;
    expect(find(root, "limit")).toMatchObject({
      kind: "other",
      text: "math.huge",
    });
    expect(find(root, "name").kind).toBe("other");
  });

  it("reads a separate data file as a table keyed by widget name", () => {
    const got = readSettings(FLAT_DATA, separate, sw("Chili Minimap"));
    expect(find(got?.root as SettingNode, "size")).toMatchObject({
      value: 3,
    });
  });

  it("finds a renamed widget's settings under the name it had", () => {
    const got = readSettings(NESTED_FILE, nested, sw("New", ["Build Watch"]));
    expect(got?.name).toBe("Build Watch");
  });

  it("answers null for a widget that has saved nothing", () => {
    expect(readSettings(NESTED_FILE, nested, sw("Never Run"))).toBeNull();
    expect(readSettings("return {\n\torder = {},\n}", nested, sw("A"))).toBe(
      null,
    );
    expect(readSettings(FLAT_DATA, separate, sw("version"))).toMatchObject({
      root: { kind: "number", value: 6 },
    });
  });

  it("keeps the last copy of a key, as Lua does", () => {
    const src = "return {\n\tA = {\n\t\tn = 1,\n\t\tn = 2,\n\t},\n}";
    const root = readSettings(src, separate, sw("A"))?.root as SettingNode;
    expect(root.kind === "table" && root.children).toHaveLength(1);
    expect(find(root, "n")).toMatchObject({ value: 2 });
  });

  it("refuses a file that is not a table the handler wrote", () => {
    expect(() => readSettings("garbage", nested, sw("A"))).toThrow(
      /could not read/,
    );
    expect(() =>
      readSettings("return {\n\tdata = 3,\n}", nested, sw("A")),
    ).toThrow(/could not read/);
  });
});

describe("writeSettings", () => {
  const path = (...labels: string[]): number[] => {
    const root = readSettings(NESTED_FILE, nested, sw("Build Watch"))
      ?.root as SettingNode;
    let node = root;
    for (const label of labels) node = find(node, label);
    return [...node.path];
  };

  it("changes the values it is given and nothing else", () => {
    const out = writeSettings(NESTED_FILE, nested, sw("Build Watch"), [
      { path: path("size"), value: 18.5 },
      { path: path("enabled"), value: false },
      { path: path("label"), value: 'a "b"\\c\nd' },
      { path: path("colours", "1"), value: 0.25 },
    ]);
    const before = readBack(NESTED_FILE) as Record<string, any>;
    const after = readBack(out) as Record<string, any>;
    const mine = (o: Record<string, any>) =>
      o["string:data"]["string:Build Watch"];
    expect(mine(after)["string:size"]).toBe(18.5);
    expect(mine(after)["string:enabled"]).toBe(false);
    expect(mine(after)["string:label"]).toBe('a "b"\\c\nd');
    expect(mine(after)["string:colours"]["number:1"]).toBe(0.25);
    // Every other entry reads back the same.
    mine(after)["string:size"] = mine(before)["string:size"];
    mine(after)["string:enabled"] = mine(before)["string:enabled"];
    mine(after)["string:label"] = mine(before)["string:label"];
    mine(after)["string:colours"]["number:1"] =
      mine(before)["string:colours"]["number:1"];
    expect(after).toEqual(before);
    // And the text outside the four values is the same bytes.
    expect(out).toContain('\t\t["odd-name.v2"] = {\n\t\t\tlimit = math.huge,');
    expect(out).toContain('\torder = {\n\t\t["Build Watch"] = 14,\n\t},');
  });

  it("writes a negative or exponent number Lua reads back", () => {
    const out = writeSettings(NESTED_FILE, nested, sw("Build Watch"), [
      { path: path("size"), value: -1e-7 },
    ]);
    const got = readBack(out) as Record<string, any>;
    expect(got["string:data"]["string:Build Watch"]["string:size"]).toBe(-1e-7);
  });

  it("writes a string with control characters Lua reads back", () => {
    const value = "tab\there\u0001\u007f and \u00e9";
    const out = writeSettings(NESTED_FILE, nested, sw("Build Watch"), [
      { path: path("label"), value },
    ]);
    const got = readBack(out) as Record<string, any>;
    expect(got["string:data"]["string:Build Watch"]["string:label"]).toBe(
      value,
    );
  });

  it("edits a separate data file in place", () => {
    const root = readSettings(FLAT_DATA, separate, sw("Chili Minimap"))
      ?.root as SettingNode;
    const out = writeSettings(FLAT_DATA, separate, sw("Chili Minimap"), [
      { path: [...find(root, "size").path], value: 4 },
    ]);
    expect(out).toBe(FLAT_DATA.replace("size = 3", "size = 4"));
  });

  it("will not turn a value into another type, or edit what is not there", () => {
    const run = (edit: { path: number[]; value: number | string | boolean }) =>
      writeSettings(NESTED_FILE, nested, sw("Build Watch"), [edit]);
    expect(() => run({ path: path("size"), value: "12" })).toThrow(
      /changed after/,
    );
    expect(() => run({ path: path("colours"), value: 1 })).toThrow(
      /changed after/,
    );
    expect(() => run({ path: [99], value: 1 })).toThrow(/changed after/);
    expect(() => run({ path: path("size"), value: Number.NaN })).toThrow(
      /finite/,
    );
    expect(() =>
      writeSettings(NESTED_FILE, nested, sw("Never Run"), [
        { path: [0], value: 1 },
      ]),
    ).toThrow(/changed after/);
  });

  it("will not edit a value it shows as written", () => {
    const root = readSettings(NESTED_FILE, nested, sw("odd-name.v2"))
      ?.root as SettingNode;
    expect(() =>
      writeSettings(NESTED_FILE, nested, sw("odd-name.v2"), [
        { path: [...find(root, "limit").path], value: 1 },
      ]),
    ).toThrow(/changed after/);
  });
});

/** An in-memory folder. */
function memory(files: Record<string, string>): ConfigFileIO & {
  files: Record<string, string>;
  writes: string[];
} {
  const state = { files: { ...files }, writes: [] as string[] };
  return {
    files: state.files,
    writes: state.writes,
    read: async (p) => state.files[p] ?? null,
    write: async (p, text) => {
      state.writes.push(p);
      state.files[p] = text;
    },
  };
}

const DIR = "/home/p/.spring";
const NOW = new Date(Date.UTC(2026, 9, 30, 9, 5, 30));

describe("loadWidgetSettings", () => {
  const widgetPath = "LuaUI/Widgets/watch.lua";
  const base = (io: ConfigFileIO) => ({
    io,
    writeDir: DIR,
    config: nested,
    shortName: "MF",
    sw: sw("Build Watch"),
    widgetPath,
  });

  it("reads a widget that has saved", async () => {
    const io = memory({ [`${DIR}/LuaUI/Config/MF.lua`]: NESTED_FILE });
    const got = await loadWidgetSettings(base(io));
    expect(got).toMatchObject({
      kind: "ready",
      path: `${DIR}/LuaUI/Config/MF.lua`,
      name: "Build Watch",
    });
  });

  it("says nothing is saved yet for a widget that saves through GetConfigData", async () => {
    const io = memory({
      [`${DIR}/LuaUI/Config/MF.lua`]: "return {\n\tdata = {},\n}",
      [`${DIR}/${widgetPath}`]: "function widget:GetConfigData() return {} end",
    });
    expect(await loadWidgetSettings(base(io))).toEqual({ kind: "unsaved" });
    // And when the game has no file at all yet.
    delete io.files[`${DIR}/LuaUI/Config/MF.lua`];
    expect(await loadWidgetSettings(base(io))).toEqual({ kind: "unsaved" });
  });

  it("says a widget that never implements GetConfigData has no saved settings", async () => {
    const io = memory({
      [`${DIR}/LuaUI/Config/MF.lua`]: "return {\n\tdata = {},\n}",
      [`${DIR}/${widgetPath}`]:
        "local size = 12 -- GetConfigData is not here\nfunction widget:GetInfo() return {} end",
    });
    expect(await loadWidgetSettings(base(io))).toEqual({ kind: "none" });
  });

  it("throws on a file that is there and cannot be read", async () => {
    const io = memory({
      [`${DIR}/LuaUI/Config/MF.lua`]: "return {\n\tdata = {",
    });
    await expect(loadWidgetSettings(base(io))).rejects.toThrow(
      /could not read/,
    );
  });
});

describe("mentionsGetConfigData", () => {
  it.each([
    ["function widget:GetConfigData() return {} end", true],
    ["widget.GetConfigData = function() end", true],
    ["-- GetConfigData\nlocal x = 1", false],
    ['local s = "GetConfigData"', false],
    ["function widget:SetConfigData(d) end", false],
    ["local s = '\\q' GetConfigData = 1", true],
  ])("%s -> %s", (src, expected) => {
    expect(mentionsGetConfigData(src)).toBe(expected);
  });
});

describe("saveWidgetSettings", () => {
  const file = `${DIR}/LuaUI/Config/MF.lua`;
  const request = (io: ConfigFileIO, over = {}) => ({
    io,
    writeDir: DIR,
    config: nested,
    shortName: "MF",
    sw: sw("Build Watch"),
    edits: [{ path: [0, 0], value: 1 }],
    gameRunning: false,
    now: NOW,
    ...over,
  });
  const sizePath = () => {
    const root = readSettings(NESTED_FILE, nested, sw("Build Watch"))
      ?.root as SettingNode;
    return [...find(root, "size").path];
  };

  it("copies the file, then changes only that value", async () => {
    const io = memory({ [file]: NESTED_FILE });
    const out = await saveWidgetSettings(
      request(io, { edits: [{ path: sizePath(), value: 20 }] }),
    );
    expect(out.backup).toBe(`${file}.20261030-090530.bak`);
    expect(io.files[`${file}.20261030-090530.bak`]).toBe(NESTED_FILE);
    expect(io.files[file]).toBe(NESTED_FILE.replace("size = 12", "size = 20"));
    // The copy goes first.
    expect(io.writes).toEqual([`${file}.20261030-090530.bak`, file]);
  });

  it("writes nothing when nothing changes", async () => {
    const io = memory({ [file]: NESTED_FILE });
    const out = await saveWidgetSettings(
      request(io, { edits: [{ path: sizePath(), value: 12 }] }),
    );
    expect(out).toEqual({});
    expect(io.writes).toEqual([]);
  });

  it("refuses while a game is running, before it reads or writes", async () => {
    const io = memory({ [file]: NESTED_FILE });
    await expect(
      saveWidgetSettings(
        request(io, {
          gameRunning: true,
          edits: [{ path: sizePath(), value: 20 }],
        }),
      ),
    ).rejects.toThrow(/A game is running/);
    expect(io.writes).toEqual([]);
  });

  it("never writes over a file it could not read", async () => {
    const io = memory({ [file]: "return {\n\tdata = {" });
    await expect(saveWidgetSettings(request(io))).rejects.toThrow(
      /could not read/,
    );
    expect(io.writes).toEqual([]);
  });

  it("does not create a file the game has not saved", async () => {
    const io = memory({});
    await expect(saveWidgetSettings(request(io))).rejects.toThrow(
      /changed after/,
    );
    expect(io.writes).toEqual([]);
  });

  it("writes a separate data file", async () => {
    const data = `${DIR}/LuaUI/Config/ZK_data.lua`;
    const io = memory({ [data]: FLAT_DATA });
    await saveWidgetSettings({
      io,
      writeDir: DIR,
      config: separate,
      shortName: "ZK",
      sw: sw("Chili Minimap"),
      edits: [{ path: [0], value: 9 }],
      gameRunning: false,
      now: NOW,
    });
    expect(io.files[data]).toBe(FLAT_DATA.replace("size = 3", "size = 9"));
  });
});
