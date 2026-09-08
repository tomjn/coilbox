import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isLuaIdentifier, luaLiteral, luaString } from "./lua";

/**
 * What luajit makes of the literal, as JSON, or the error it refused with.
 *
 * Asserting on the string this module writes only proves it looks like Lua.
 * The claim worth checking is stronger: that a game's own Lua reads it back as
 * the table it went in as. `src/lego/luaScript.test.ts` shells out to luajit
 * the same way, for the same reason.
 */
function readBack(lua: string): unknown {
  const script = `
    local f, err = loadstring("return " .. io.read("*a"))
    if not f then io.stderr:write(err) os.exit(1) end
    local ok, value = pcall(f)
    if not ok then io.stderr:write(tostring(value)) os.exit(1) end
    -- Lua's own %q escapes a newline as a backslash and a real newline, which
    -- JSON will not take, so the quoting is done by hand.
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
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe("luaString", () => {
  it("quotes a plain string", () => {
    expect(luaString("armcom")).toBe('"armcom"');
  });

  it("escapes a quote and a backslash", () => {
    expect(luaString('say "hi"')).toBe('"say \\"hi\\""');
    expect(luaString("objects3d\\arm")).toBe('"objects3d\\\\arm"');
  });

  it("escapes newlines, returns and tabs", () => {
    expect(luaString("a\nb\r\tc")).toBe('"a\\nb\\r\\tc"');
  });

  it("pads a control character to three digits", () => {
    // Two digits would read back as byte 5 followed by the character "1".
    expect(luaString("\x051")).toBe('"\\0051"');
  });

  it("leaves bytes above ASCII alone", () => {
    expect(luaString("Ärger")).toBe('"Ärger"');
  });
});

describe("isLuaIdentifier", () => {
  it("accepts a bare name", () => {
    expect(isLuaIdentifier("maxdamage")).toBe(true);
    expect(isLuaIdentifier("_x1")).toBe(true);
  });

  it("rejects a keyword and anything that is not a name", () => {
    expect(isLuaIdentifier("repeat")).toBe(false);
    expect(isLuaIdentifier("1")).toBe(false);
    expect(isLuaIdentifier("with space")).toBe(false);
    expect(isLuaIdentifier("")).toBe(false);
  });
});

describe("luaLiteral", () => {
  it("writes scalars", () => {
    expect(luaLiteral(5)).toBe("5");
    expect(luaLiteral(-0.25)).toBe("-0.25");
    expect(luaLiteral(true)).toBe("true");
    expect(luaLiteral("DEAD")).toBe('"DEAD"');
    expect(luaLiteral(null)).toBe("nil");
    expect(luaLiteral(undefined)).toBe("nil");
  });

  it("writes a number Lua has no literal for as the expression it comes from", () => {
    expect(luaLiteral(Number.POSITIVE_INFINITY)).toBe("math.huge");
    expect(luaLiteral(Number.NEGATIVE_INFINITY)).toBe("-math.huge");
    expect(luaLiteral(Number.NaN)).toBe("0/0");
  });

  it("writes an empty table", () => {
    expect(luaLiteral({})).toBe("{}");
    expect(luaLiteral([])).toBe("{}");
  });

  it("keeps a short table of scalars on one line", () => {
    expect(luaLiteral({ x: 1, z: 2 })).toBe("{ x = 1, z = 2 }");
    expect(luaLiteral([27, 39])).toBe("{ [1] = 27, [2] = 39 }");
  });

  it("breaks a table that is too wide for one line", () => {
    const long = {
      description: "A very long piece of prose about a unit here",
    };
    expect(luaLiteral(long)).toBe(
      '{\n  description = "A very long piece of prose about a unit here",\n}',
    );
  });

  it("brackets a key that is not an identifier", () => {
    expect(luaLiteral({ "with space": 1, repeat: 2 })).toBe(
      '{ ["with space"] = 1, ["repeat"] = 2 }',
    );
  });

  it("writes an integer key as a number, not as a string", () => {
    // ["1"] and [1] are different keys to Lua, and the def held the number.
    expect(luaLiteral({ "1": "armsolar", "2": "armwin" })).toBe(
      '{ [1] = "armsolar", [2] = "armwin" }',
    );
  });

  it("indents a nested table under its key", () => {
    expect(
      luaLiteral({
        sounds: {
          select: { "1": "commander_select_one", "2": "commander_select_two" },
        },
      }),
    ).toBe(
      [
        "{",
        "  sounds = {",
        "    select = {",
        '      [1] = "commander_select_one",',
        '      [2] = "commander_select_two",',
        "    },",
        "  },",
        "}",
      ].join("\n"),
    );
  });

  it("escapes a string holding a quote or a backslash inside a table", () => {
    expect(luaLiteral({ name: 'The "Big" One\\Two' })).toBe(
      '{ name = "The \\"Big\\" One\\\\Two" }',
    );
  });

  it("writes an array with its indices, the way both games write theirs", () => {
    expect(luaLiteral(["armsolar", "armwin", "armmstor", "armestor"])).toBe(
      [
        "{",
        '  [1] = "armsolar",',
        '  [2] = "armwin",',
        '  [3] = "armmstor",',
        '  [4] = "armestor",',
        "}",
      ].join("\n"),
    );
  });

  it("breaks a table holding a table even when it would fit on a line", () => {
    expect(luaLiteral({ a: { b: 1 } })).toBe("{\n  a = { b = 1 },\n}");
  });

  it("reads back under luajit as the table it was written from", () => {
    // Keys carry their Lua type, so a key that should have stayed a number
    // cannot pass by arriving back as the string "1".
    expect(
      readBack(
        luaLiteral({
          "with space": 1,
          repeat: 2,
          "1": "armsolar",
          name: 'The "Big" One\\Two',
          tabbed: "a\tb\nc",
          nested: { empty: {}, list: ["x", "y"], on: true },
        }),
      ),
    ).toEqual({
      "number:1": "armsolar",
      "string:with space": 1,
      "string:repeat": 2,
      "string:name": 'The "Big" One\\Two',
      "string:tabbed": "a\tb\nc",
      "string:nested": {
        "string:empty": {},
        "string:list": { "number:1": "x", "number:2": "y" },
        "string:on": true,
      },
    });
  });
});
