import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { WidgetConfigFile } from "./handlers";
import {
  type ConfigFileIO,
  configCandidates,
  readFlag,
  readLocalWidgets,
  readOrder,
  writeOrder,
  writeWidgetStates,
} from "./widgetConfig";

/**
 * What luajit makes of a whole config file, as JSON with every key tagged by
 * its type. Checking the text alone would only prove it looks like Lua. The
 * claim worth checking is that the game's handler reads it back, with only the
 * one entry changed. `src/lib/lua.test.ts` shells out the same way.
 */
function readBack(lua: string): Record<string, unknown> {
  const script = `
    local f, err = loadstring(io.read("*a"))
    if not f then io.stderr:write(err) os.exit(1) end
    setfenv(f, {math = {huge = math.huge}})
    local ok, value = pcall(f)
    if not ok then io.stderr:write(tostring(value)) os.exit(1) end
    local function jstr(s)
      s = s:gsub("[\\\\\\"]", "\\\\%0"):gsub("\\n", "\\\\n"):gsub("\\r", "\\\\r")
      s = s:gsub("\\t", "\\\\t")
      s = s:gsub("%c", function(c)
        return string.format("\\\\u%04x", string.byte(c))
      end)
      return '"' .. s .. '"'
    end
    local function dump(v)
      local t = type(v)
      if t == "string" then return jstr(v) end
      -- JSON has no infinity, and the handlers save math.huge.
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

const nested: WidgetConfigFile["shape"] = "nested";
const flat: WidgetConfigFile["shape"] = "flat";

/** As the engine's `savetable.lua` writes it, data and all. */
const ENGINE_FILE = `-- Widget Custom data and order, order = 0 disabled widget
return {
\tdata = {
\t\t["Build Watch"] = {
\t\t\tcolours = {
\t\t\t\t[1] = 0.5,
\t\t\t\t[2] = 1,
\t\t\t},
\t\t\tlabel = "say \\"hi\\"\\
next line",
\t\t},
\t\t["odd-name.v2"] = {
\t\t\tlimit = math.huge,
\t\t},
\t},
\torder = {
\t\t["Build Watch"] = 14,
\t\tMinimap = 0,
\t\t["Say \\"when\\""] = 3,
\t},
}
`;

/** Zero-K's and Complete Annihilation's order file. */
const FLAT_FILE = `-- Widget Order List  (0 disables a widget)
return {
\t["Chili Minimap"] = 7,
\tlastWidgetDetailLevel = 2,
\tversion = 6,
}
`;

describe("readOrder", () => {
  it("reads a nested file's order, whatever the key looks like", () => {
    expect(readOrder(ENGINE_FILE, nested)).toEqual(
      new Map([
        ["Build Watch", 14],
        ["Minimap", 0],
        ['Say "when"', 3],
      ]),
    );
  });

  it("reads a flat file as the order itself", () => {
    expect(readOrder(FLAT_FILE, flat).get("Chili Minimap")).toBe(7);
  });

  it("refuses a file that is not a table", () => {
    expect(() => readOrder("return {\n\torder = {", nested)).toThrow(
      /could not read/,
    );
    expect(() => readOrder("garbage", nested)).toThrow(/could not read/);
  });
});

describe("readFlag", () => {
  const file = (flag: string) =>
    `-- Widget Custom data and order\nreturn {\n\t["allowUserWidgets"] = ${flag},\n\t["order"] = {\n\t\t["A"] = 1,\n\t},\n}`;

  it("reads the flag a Balanced Annihilation family handler saves", () => {
    expect(readFlag(file("false"), "allowUserWidgets")).toBe(false);
    expect(readFlag(file("true"), "allowUserWidgets")).toBe(true);
  });

  it("reads a flag written as a name", () => {
    expect(
      readFlag("return { allowUserWidgets = false }", "allowUserWidgets"),
    ).toBe(false);
  });

  it("is null for a file with no such entry or a value that is not a boolean", () => {
    expect(readFlag(ENGINE_FILE, "allowUserWidgets")).toBeNull();
    expect(readFlag(file("1"), "allowUserWidgets")).toBeNull();
  });

  it("does not read the flag from inside the order table", () => {
    expect(
      readFlag(
        "return { order = { allowUserWidgets = false } }",
        "allowUserWidgets",
      ),
    ).toBeNull();
  });

  it("refuses a file that is not a table", () => {
    expect(() => readFlag("garbage", "allowUserWidgets")).toThrow(
      /could not read/,
    );
  });
});

describe("readLocalWidgets", () => {
  const entry = (fields: string) =>
    `return {\n\t["Local Widgets Config"] = {\n${fields}\n\t},\n\t["Other"] = { localWidgets = true },\n}`;

  it("is on when the entry turns either kind of local widgets on", () => {
    for (const key of [
      "localWidgets",
      "localWidgetsFirst",
      "useLocalWidgets",
      "useLocalWidgetsFirst",
    ]) {
      expect(readLocalWidgets(entry(`\t\t["${key}"] = true,`))).toBe(true);
    }
  });

  it("is off when the entry has them off, has neither, or is missing", () => {
    expect(readLocalWidgets(entry('\t\t["localWidgets"] = false,'))).toBe(
      false,
    );
    expect(readLocalWidgets(entry(""))).toBe(false);
    expect(readLocalWidgets("return { Other = { localWidgets = true } }")).toBe(
      false,
    );
  });

  it("goes by the last copy of a key, as Lua does", () => {
    expect(
      readLocalWidgets(
        entry('\t\t["localWidgets"] = true,\n\t\t["localWidgets"] = false,'),
      ),
    ).toBe(false);
    expect(
      readLocalWidgets(
        entry('\t\t["localWidgets"] = false,\n\t\t["localWidgets"] = true,'),
      ),
    ).toBe(true);
  });

  it("refuses a file that is not a table", () => {
    expect(() => readLocalWidgets("garbage")).toThrow(/could not read/);
  });
});

describe("writeOrder", () => {
  /** The file as luajit reads it, with one order entry changed. */
  function expectOnlyChanged(
    before: string,
    after: string,
    shape: WidgetConfigFile["shape"],
    name: string,
    value: number,
  ) {
    const was = readBack(before);
    const now = readBack(after);
    const key = `string:${name}`;
    if (shape === "flat") {
      expect(now).toEqual({ ...was, [key]: value });
    } else {
      const order = (was["string:order"] ?? {}) as Record<string, unknown>;
      expect(now).toEqual({
        ...was,
        "string:order": { ...order, [key]: value },
      });
    }
  }

  it("changes only the value of an entry that is there", () => {
    const after = writeOrder(ENGINE_FILE, nested, "Build Watch", 0);
    expect(after).toBe(
      ENGINE_FILE.replace('["Build Watch"] = 14', '["Build Watch"] = 0'),
    );
    expectOnlyChanged(ENGINE_FILE, after, nested, "Build Watch", 0);
  });

  it("finds a key written as a name or with escapes", () => {
    expectOnlyChanged(
      ENGINE_FILE,
      writeOrder(ENGINE_FILE, nested, "Minimap", 1),
      nested,
      "Minimap",
      1,
    );
    expectOnlyChanged(
      ENGINE_FILE,
      writeOrder(ENGINE_FILE, nested, 'Say "when"', 0),
      nested,
      'Say "when"',
      0,
    );
  });

  it("adds a new entry in the file's own layout", () => {
    const after = writeOrder(ENGINE_FILE, nested, "New\\one", 1);
    expect(after).toContain('\t\t["New\\\\one"] = 1,\n\t},\n}');
    expectOnlyChanged(ENGINE_FILE, after, nested, "New\\one", 1);
  });

  it("does not take a data entry for the order entry", () => {
    const after = writeOrder(ENGINE_FILE, nested, "odd-name.v2", 0);
    expect(after).toContain("limit = math.huge");
    expectOnlyChanged(ENGINE_FILE, after, nested, "odd-name.v2", 0);
  });

  it("writes into a flat file and keeps its version", () => {
    const after = writeOrder(FLAT_FILE, flat, "Chili Minimap", 0);
    expectOnlyChanged(FLAT_FILE, after, flat, "Chili Minimap", 0);
    const added = writeOrder(FLAT_FILE, flat, "Ally Cursors", 1);
    expectOnlyChanged(FLAT_FILE, added, flat, "Ally Cursors", 1);
  });

  it("adds an order table to a nested file saved without one", () => {
    // Balanced Annihilation's handler saves only this when the user widget
    // option is set before anything else.
    const before =
      "-- Widget Custom data and order\nreturn {\n\tallowUserWidgets = true,\n}\n";
    const after = writeOrder(before, nested, "Build Watch", 1);
    expectOnlyChanged(before, after, nested, "Build Watch", 1);
  });

  it("copes with a table on one line and no separator after the last field", () => {
    const before = "return { order = { a = 1 }, data = {} }";
    const after = writeOrder(before, nested, "b c", 0);
    expectOnlyChanged(before, after, nested, "b c", 0);
    const empty = "return {order={}}";
    expectOnlyChanged(empty, writeOrder(empty, nested, "x", 1), nested, "x", 1);
  });

  it("skips comments and long strings that look like tables", () => {
    const before = `--[[ order = { fake = 1 } ]]
return {
\tdata = { note = [==[ } order = { ]==] },
\t-- order = { fake = 2 },
\torder = {
\t\treal = 1,
\t},
}`;
    const after = writeOrder(before, nested, "real", 0);
    expect(after).toBe(before.replace("real = 1", "real = 0"));
    expectOnlyChanged(before, after, nested, "real", 0);
  });
});

describe("configCandidates", () => {
  it("fills in the short name in each spelling", () => {
    expect(
      configCandidates(
        { files: ["{SHORT}_order.lua", "{short}_order.lua"], shape: "flat" },
        "ca",
      ),
    ).toEqual(["LuaUI/Config/CA_order.lua", "LuaUI/Config/ca_order.lua"]);
    expect(
      configCandidates(
        { files: ["{SHORT}_order.lua", "{short}_order.lua"], shape: "flat" },
        "ZK",
      ),
    ).toEqual(["LuaUI/Config/ZK_order.lua"]);
  });

  it("names no file for a short name that leaves the folder", () => {
    const config: WidgetConfigFile = {
      files: ["{short}.lua"],
      shape: "nested",
    };
    expect(configCandidates(config, "../../evil")).toEqual([]);
    expect(configCandidates(config, "a\\b")).toEqual([]);
    expect(configCandidates(config, "")).toEqual([]);
    expect(
      configCandidates({ files: ["BYAR.lua"], shape: "nested" }, "../x"),
    ).toEqual(["LuaUI/Config/BYAR.lua"]);
  });
});

describe("writeWidgetStates", () => {
  const config: WidgetConfigFile = { files: ["{short}.lua"], shape: "nested" };
  const path = "/home/player/.spring/LuaUI/Config/MF.lua";

  function memoryIO(files: Record<string, string>) {
    const written: Record<string, string> = {};
    const io: ConfigFileIO = {
      read: async (p) => {
        if (p in written) return written[p];
        if (p in files) return files[p];
        return null;
      },
      write: async (p, text) => {
        written[p] = text;
      },
    };
    return { io, written };
  }

  const request = {
    writeDir: "/home/player/.spring",
    config,
    shortName: "MF",
    now: new Date(Date.UTC(2026, 9, 30, 9, 5, 30)),
  };

  it("writes every entry after one copy, and keeps the rest of the file", async () => {
    const { io, written } = memoryIO({ [path]: ENGINE_FILE });
    const out = await writeWidgetStates({
      ...request,
      io,
      states: new Map([
        ["Minimap", true],
        ['Say "when"', false],
        ["New One", false],
      ]),
    });
    expect(out?.backup).toBe(`${path}.20261030-090530.bak`);
    expect(written[`${path}.20261030-090530.bak`]).toBe(ENGINE_FILE);
    expect(Object.keys(written)).toHaveLength(2);
    expect(out?.order).toEqual(
      new Map([
        ["Build Watch", 14],
        ["Minimap", 1],
        ['Say "when"', 0],
        ["New One", 0],
      ]),
    );
    const back = readBack(written[path]) as Record<string, unknown>;
    expect(back["string:data"]).toEqual(readBack(ENGINE_FILE)["string:data"]);
  });

  it("keeps a widget that is already on where it is, and writes nothing", async () => {
    const { io, written } = memoryIO({ [path]: ENGINE_FILE });
    const out = await writeWidgetStates({
      ...request,
      io,
      states: new Map([
        ["Build Watch", true],
        ["Minimap", false],
      ]),
    });
    expect(written).toEqual({});
    expect(out?.backup).toBeUndefined();
    expect(out?.order.get("Build Watch")).toBe(14);
  });

  it("keeps the first copy when two writes land in one second", async () => {
    const { io, written } = memoryIO({ [path]: ENGINE_FILE });
    await writeWidgetStates({
      ...request,
      io,
      states: new Map([["Minimap", true]]),
    });
    const second = await writeWidgetStates({
      ...request,
      io,
      states: new Map([["Build Watch", false]]),
    });
    expect(second?.backup).toBe(`${path}.20261030-090530-2.bak`);
    expect(written[`${path}.20261030-090530.bak`]).toBe(ENGINE_FILE);
  });

  it("does not create a file the game has not saved", async () => {
    const { io, written } = memoryIO({});
    expect(
      await writeWidgetStates({
        ...request,
        io,
        states: new Map([["Minimap", true]]),
      }),
    ).toBeNull();
    expect(written).toEqual({});
  });

  it("writes nothing, not even a copy, over a file it cannot read", async () => {
    const { io, written } = memoryIO({ [path]: "return { order = " });
    await expect(
      writeWidgetStates({
        ...request,
        io,
        states: new Map([["Minimap", false]]),
      }),
    ).rejects.toThrow(/could not read/);
    expect(written).toEqual({});
  });

  it("passes on a read that failed rather than treating it as no file", async () => {
    const io: ConfigFileIO = {
      read: async () => {
        throw new Error("permission denied");
      },
      write: async () => {
        throw new Error("must not write");
      },
    };
    await expect(
      writeWidgetStates({
        ...request,
        io,
        states: new Map([["Minimap", false]]),
      }),
    ).rejects.toThrow("permission denied");
  });
});
