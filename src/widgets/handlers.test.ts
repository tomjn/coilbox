import { describe, expect, it } from "vitest";
import {
  HANDLER_FOLDERS,
  loads,
  recogniseHandler,
  type WidgetHandler,
} from "./handlers";

const none = async () => null;

describe("recogniseHandler", () => {
  it.each([
    ["luaui/barwidgets.lua", "bar"],
    ["luaui/bawidgets.lua", "ba"],
    ["LuaUI/cawidgets.lua", "ca"],
    ["luaui/mfwidgets.lua", "mf"],
    ["LuaUI/widgets_custom.lua", "sf"],
  ])("recognises %s as %s", async (marker, id) => {
    const handler = await recogniseHandler(["luaui.lua", marker], none);
    expect(handler?.id).toBe(id);
  });

  it.each([
    ["LuaUI/widgets_evo.lua", "evo", "engine", ["LuaUI/Widgets_Evo"]],
    ["luaui/jauriawidgets.lua", "jauria", "ca", ["LuaUI/Widgets"]],
    ["luaui/mosaicwidgets.lua", "mosaic", "ba", ["LuaUI/widgets_mosaic"]],
    ["luaui/tapwidgets.lua", "tap", "ba", ["LuaUI/Widgets_TAP"]],
    ["LuaUI/config/iwui.config.lua", "iw", "engine", ["LuaUI/Widgets"]],
  ])("recognises %s as %s", async (marker, id, family, folders) => {
    const handler = await recogniseHandler(["luaui.lua", marker], none);
    expect(handler).toEqual({ id, family, folders, subfolders: false });
  });

  it("does not take MOSAIC's or Total Annihilation Prime's main.lua for jK's", async () => {
    const handler = await recogniseHandler(
      ["luaui.lua", "LuaUI/main.lua", "LuaUI/tapwidgets.lua"],
      async () => "VFS.Include(LUAUI_DIRNAME .. 'tapmain.lua')",
    );
    expect(handler?.id).toBe("tap");
  });

  it("tells the pre-0.83 handler from the default one by what it saves", async () => {
    const files = ["LuaUI/widgets.lua"];
    const legacy = await recogniseHandler(
      files,
      async () =>
        "local ORDER_FILENAME = LUAUI_DIRNAME .. 'Config/widget_order.lua'",
    );
    expect(legacy?.family).toBe("legacy");
    const engine = await recogniseHandler(
      files,
      async () =>
        "local CONFIG_FILENAME = LUAUI_DIRNAME .. 'Config/' .. Game.modShortName .. '.lua'",
    );
    expect(engine?.id).toBe("engine");
  });

  it("recognises jK's handler from main.lua", async () => {
    const handler = await recogniseHandler(
      ["LuaUI/main.lua", "LuaUI/config.lua"],
      async () => 'include "LuaHandler/handler.lua"',
    );
    expect(handler).toMatchObject({
      family: "jk",
      folders: ["LuaUI/Widgets", "LuaUI/Addons"],
    });
  });

  it("gives a game that ships no handler the engine's own", async () => {
    const handler = await recogniseHandler(
      ["LuaUI/Widgets/gui_x.lua", "units/a.lua"],
      none,
    );
    expect(handler).toMatchObject({ id: "engine", folders: ["LuaUI/Widgets"] });
  });

  it("does not guess at a handler it does not know", async () => {
    expect(await recogniseHandler(["luaui.lua"], none)).toBeNull();
    expect(
      await recogniseHandler(["LuaUI/main.lua"], async () => "something else"),
    ).toBeNull();
  });

  it("only reads a file when the rule needs to look inside", async () => {
    const asked: string[] = [];
    await recogniseHandler(["luaui/bawidgets.lua"], async (f) => {
      asked.push(f);
      return null;
    });
    expect(asked).toEqual([]);
  });
});

describe("HANDLER_FOLDERS", () => {
  it("is every folder any handler reads, once, lower case", () => {
    expect([...HANDLER_FOLDERS].sort()).toEqual([
      "addons",
      "rmlwidgets",
      "widgets",
      "widgets_evo",
      "widgets_mosaic",
      "widgets_tap",
    ]);
  });
});

describe("loads", () => {
  const sf: WidgetHandler = {
    id: "sf",
    family: "engine",
    folders: ["LuaUI/widgets"],
    subfolders: false,
  };
  const bar: WidgetHandler = {
    id: "bar",
    family: "ba",
    folders: ["LuaUI/Widgets", "LuaUI/RmlWidgets"],
    subfolders: true,
  };

  it("folds case where the filesystem does", () => {
    expect(loads(sf, { folder: "LuaUI/Widgets", nested: false }, false)).toBe(
      true,
    );
  });

  it("matches only the handler's own spelling where it does not", () => {
    expect(loads(sf, { folder: "LuaUI/Widgets", nested: false }, true)).toBe(
      false,
    );
    expect(loads(sf, { folder: "LuaUI/widgets", nested: false }, true)).toBe(
      true,
    );
  });

  it("loads a subfolder only for a handler that reads them", () => {
    const nested = { folder: "LuaUI/Widgets", nested: true };
    expect(loads(bar, nested, false)).toBe(true);
    expect(loads(sf, nested, false)).toBe(false);
  });

  it("does not load from a folder the handler does not read", () => {
    expect(
      loads(sf, { folder: "LuaUI/RmlWidgets", nested: false }, false),
    ).toBe(false);
  });
});
