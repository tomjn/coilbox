import { describe, expect, it } from "vitest";

import {
  applyOverrides,
  changelogEntries,
  diffRegistries,
  entryId,
  expandBraces,
  filterChangelog,
  finalise,
  mergeEntries,
  parseChangelog,
  registryOf,
} from "./catalogue.mjs";

/** A handle that puts each library's entries in its table, like LuaUI.cpp. */
const HANDLE = `
bool CLuaUI::LoadCFunctions(lua_State* L)
{
	lua_pushvalue(L, LUA_GLOBALSINDEX);
	if (!AddEntriesToTable(L, "Spring", LuaUnsyncedCtrl::PushEntries) ||
	    !AddEntriesToTable(L, "gl",     LuaOpenGL::PushEntries)) {
		return false;
	}
	lua_getglobal(L, "Script");
	LuaPushNamedCFunc(L, "UpdateCallIn", CallOutUpdateCallIn);
	lua_pop(L, 1);
	return true;
}
`;

/** 0.81-style sources, each file defining its own REGISTER_LUA_CFUNC. */
const OLD = [
  { path: "rts/Lua/LuaUI.cpp", text: HANDLE },
  {
    path: "rts/Lua/LuaUnsyncedCtrl.cpp",
    text: `
bool LuaUnsyncedCtrl::PushEntries(lua_State* L)
{
#define REGISTER_LUA_CFUNC(x) \\
	lua_pushstring(L, #x);      \\
	lua_pushcfunction(L, x);    \\
	lua_rawset(L, -3)

	REGISTER_LUA_CFUNC(MakeFont);
	REGISTER_LUA_CFUNC(SetUnitToFeature);
	REGISTER_LUA_CFUNC(GetUnitTravel);

	lua_pushstring(L, "UnitScript");
	lua_newtable(L);
	REGISTER_LUA_CFUNC(Turn);
	lua_rawset(L, -3);
	return true;
}

int LuaUnsyncedCtrl::GetUnitTravel(lua_State* L)
{
	lua_pushnumber(L, unit->travel);
	return 1;
}
`,
  },
  {
    path: "rts/Lua/LuaOpenGL.cpp",
    text: `
bool LuaOpenGL::PushEntries(lua_State* L)
{
	REGISTER_LUA_CFUNC(Smoothing);
	REGISTER_LUA_CFUNC(Color);
	LuaShaders::PushEntries(L);
	// A metatable's methods are not functions of gl.
	luaL_newmetatable(L, "Font");
	HSTR_PUSH_CFUNC(L, "Print", Print);
	lua_pop(L, 1);
	return true;
}

bool LuaShaders::PushEntries(lua_State* L)
{
	REGISTER_LUA_CFUNC(CreateShader);
	return true;
}
`,
  },
];

/** The same sources at a current tag: some gone, one kept as a stub. */
const NEW = [
  { path: "rts/Lua/LuaUI.cpp", text: HANDLE },
  {
    path: "rts/Lua/LuaUnsyncedCtrl.cpp",
    text: `
bool LuaUnsyncedCtrl::PushEntries(lua_State* L)
{
	REGISTER_LUA_CFUNC(GetUnitTravel);
	REGISTER_LUA_CFUNC(RemoveObjectDecal);
	lua_pushstring(L, "UnitScript");
	lua_createtable(L, 0, 1);
	REGISTER_LUA_CFUNC(Turn);
	lua_rawset(L, -3);
	return true;
}

int LuaUnsyncedCtrl::GetUnitTravel(lua_State* L) { lua_pushnumber(L, 0.0f); lua_pushnumber(L, 0.0f); return 2; } // FIXME: DELETE ME
`,
  },
  {
    path: "rts/Lua/LuaOpenGL.cpp",
    text: `
bool LuaOpenGL::PushEntries(lua_State* L)
{
	REGISTER_LUA_CFUNC(Color);
	LuaShaders::PushEntries(L);
	return true;
}

bool LuaShaders::PushEntries(lua_State* L)
{
	REGISTER_LUA_CFUNC(CreateShader);
	return true;
}
`,
  },
];

describe("reading registrations", () => {
  it("files each function under the table its caller opened", () => {
    const names = [...registryOf(OLD).keys()].sort();
    expect(names).toEqual([
      "Script.UpdateCallIn",
      "Spring.GetUnitTravel",
      "Spring.MakeFont",
      "Spring.SetUnitToFeature",
      "Spring.UnitScript.Turn",
      "gl.Color",
      "gl.CreateShader",
      "gl.Smoothing",
    ]);
  });

  it("tells a constant stub from a working function", () => {
    expect(registryOf(OLD).get("Spring.GetUnitTravel").stub).toBe(false);
    expect(registryOf(NEW).get("Spring.GetUnitTravel").stub).toBe(true);
  });
});

describe("diffing two tags", () => {
  const removed = diffRegistries(
    ["0.81.2.1", "105.0"],
    [registryOf(OLD), registryOf(NEW)],
  );

  it("lists what the old tag had and the new one lacks or stubs", () => {
    expect(removed.map((r) => [r.name, r.since, r.stub])).toEqual([
      ["Spring.GetUnitTravel", "105.0", true],
      ["Spring.MakeFont", "105.0", false],
      ["Spring.SetUnitToFeature", "105.0", false],
      ["gl.Smoothing", "105.0", false],
    ]);
  });

  it("dates a removal by the release it first went missing in", () => {
    const middle = registryOf([OLD[0], NEW[1], OLD[2]]);
    const walked = diffRegistries(
      ["0.81.2.1", "95.0", "105.0"],
      [registryOf(OLD), middle, registryOf(NEW)],
    );
    const since = Object.fromEntries(walked.map((r) => [r.name, r.since]));
    expect(since["Spring.MakeFont"]).toBe("95.0");
    expect(since["gl.Smoothing"]).toBe("105.0");
  });
});

const CHANGELOG = `Spring changelog

-- 105.0 --------------------------------------------------------
 ! remove Spring.SetUnitToFeature (use the AllowFeatureCreation callin to block features from being spawned)
 ! rename Spring.RemoveBuildingDecal to Spring.RemoveObjectDecal
 ! make Spring.Get{Unit,Factory}Commands always expect a second argument
 ! change {Allow,Unit}Command callin parameters
	AllowCommand(..., cmdTag, fromSynced) --> AllowCommand(..., cmdTag, playerID, fromSynced, fromLua)
 ! remove SpringLobby from spring installer
 - fix a crash that is not marked with a bang

-- 104.0 --------------------------------------------------------
 ! remove gl.Smoothing
 ! Made lockluaui.txt obsolete: no longer necessary for it to exist
`;

describe("the changelog", () => {
  const lines = parseChangelog(CHANGELOG);

  it("reads every ! line with its version and continuation", () => {
    expect(lines).toHaveLength(7);
    expect(lines[3]).toMatchObject({
      version: "105.0",
      line: 7,
      text: "change {Allow,Unit}Command callin parameters AllowCommand(..., cmdTag, fromSynced) --> AllowCommand(..., cmdTag, playerID, fromSynced, fromLua)",
    });
    expect(lines[5].version).toBe("104.0");
  });

  it("keeps only lines about functions, call-ins, def tags and files", () => {
    const kept = filterChangelog(lines).map((l) => l.line);
    expect(kept).toEqual([4, 5, 6, 7, 13, 14]);
  });

  it("turns kept lines into entries of the right kind", () => {
    const registry = new Map([
      ["Spring.RemoveObjectDecal", { stub: false }],
      ["Spring.GetUnitCommands", { stub: false }],
      ["Spring.GetFactoryCommands", { stub: false }],
    ]);
    const universe = new Set([
      ...registry.keys(),
      "Spring.RemoveBuildingDecal",
      "Spring.SetUnitToFeature",
      "gl.Smoothing",
    ]);
    const callins = new Set([
      "AllowCommand",
      "UnitCommand",
      "AllowFeatureCreation",
    ]);
    const entries = changelogEntries(filterChangelog(lines), {
      registry,
      universe,
      callins,
    });
    expect(entries.map((e) => [entryId(e), e.replacement])).toEqual([
      ["removed:Spring.SetUnitToFeature", undefined],
      ["renamed:Spring.RemoveBuildingDecal", "Spring.RemoveObjectDecal"],
      ["signature:Spring.GetUnitCommands@105.0", undefined],
      ["signature:Spring.GetFactoryCommands@105.0", undefined],
      ["signature:AllowCommand@105.0", undefined],
      ["signature:UnitCommand@105.0", undefined],
      ["removed:gl.Smoothing", undefined],
      ["file:lockluaui.txt", undefined],
    ]);
  });
});

describe("expanding brace names", () => {
  it("expands lists and treats a single option as optional", () => {
    expect(expandBraces("Spring.{Set,Get}UnitTravel")).toEqual([
      "Spring.SetUnitTravel",
      "Spring.GetUnitTravel",
    ]);
    expect(expandBraces("Unit{Pre}Damaged")).toEqual([
      "UnitDamaged",
      "UnitPreDamaged",
    ]);
  });
});

describe("assembling the catalogue", () => {
  const removed = [
    {
      name: "Spring.SetUnitToFeature",
      since: "105.0",
      lastSeen: "104.0.1",
      stub: false,
      files: ["rts/Lua/LuaSyncedCtrl.cpp"],
    },
  ];
  const fromChangelog = [
    {
      kind: "removed",
      name: "Spring.SetUnitToFeature",
      since: "105.0",
      note: "remove Spring.SetUnitToFeature",
    },
    {
      kind: "signature",
      name: "Spring.GetUnitCommands",
      since: "105.0",
      note: "make Spring.Get{Unit,Factory}Commands always expect a second argument",
    },
  ];
  const merged = mergeEntries(removed, fromChangelog);

  it("folds the changelog's wording into the source diff's entry", () => {
    const entry = merged.find(
      (e) => e.id === "removed:Spring.SetUnitToFeature",
    );
    expect(entry.note).toBe(
      "remove Spring.SetUnitToFeature. Last registered in 104.0.1 (rts/Lua/LuaSyncedCtrl.cpp).",
    );
    expect(
      merged.filter((e) => e.name === "Spring.SetUnitToFeature"),
    ).toHaveLength(1);
  });

  it("lets an override replace the generated entry with the same id", () => {
    const override = {
      id: "signature:Spring.GetUnitCommands@105.0",
      kind: "signature",
      name: "Spring.GetUnitCommands",
      since: "105.0",
      note: "The count argument is required.",
      changelog:
        "make Spring.Get{Unit,Factory}Commands always expect a second argument",
    };
    const out = finalise(applyOverrides(merged, [override], CHANGELOG));
    expect(out.map((e) => e.id)).toEqual([
      "removed:Spring.SetUnitToFeature",
      "signature:Spring.GetUnitCommands@105.0",
    ]);
    expect(out[1]).toEqual({
      id: "signature:Spring.GetUnitCommands@105.0",
      kind: "signature",
      name: "Spring.GetUnitCommands",
      since: "105.0",
      note: "The count argument is required.",
    });
  });

  it("adds an override the changelog filter could not produce", () => {
    const override = {
      kind: "signature",
      name: "AllowCommand",
      since: "105.0",
      note: "fromSynced moves to the 9th argument.",
      changelog:
        "AllowCommand(..., cmdTag, fromSynced) --> AllowCommand(..., cmdTag, playerID, fromSynced, fromLua)",
    };
    const out = applyOverrides(merged, [override], CHANGELOG);
    expect(out.map((e) => e.id)).toContain("signature:AllowCommand@105.0");
  });

  it("refuses an override whose changelog line is not in the changelog", () => {
    const override = {
      kind: "signature",
      name: "UnitDamaged",
      since: "95.0",
      note: "made up",
      changelog: "a line nobody wrote",
    };
    expect(() => applyOverrides(merged, [override], CHANGELOG)).toThrow(
      /not found/,
    );
  });

  it("refuses an override whose id does not match its fields", () => {
    const override = {
      id: "signature:UnitDamaged",
      kind: "signature",
      name: "UnitDamaged",
      since: "105.0",
      note: "x",
      changelog: "remove gl.Smoothing",
    };
    expect(() => applyOverrides(merged, [override], CHANGELOG)).toThrow(
      /should be signature:UnitDamaged@105.0/,
    );
  });
});
