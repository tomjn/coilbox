import { describe, expect, it } from "vitest";
import {
  HANDLER_FOLDERS,
  loads,
  recogniseHandler,
  type WidgetConfigFile,
  type WidgetHandler,
} from "./handlers";
import { configCandidates } from "./widgetConfig";

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

  // The file names each game's own handler saves to, under LuaUI/Config.
  it.each([
    ["luaui/barwidgets.lua", "BYAR", ["BYAR.lua"]],
    ["luaui/bawidgets.lua", "BA", ["BA.lua"]],
    ["luaui/cawidgets.lua", "ZK", ["ZK_order.lua"]],
    ["luaui/cawidgets.lua", "ca", ["CA_order.lua", "ca_order.lua"]],
    ["luaui/mfwidgets.lua", "MF", ["MF.lua"]],
    ["LuaUI/widgets_custom.lua", "sf", ["SF_data.lua"]],
  ])("%s with short name %s saves to %j", async (marker, short, files) => {
    const handler = await recogniseHandler(["luaui.lua", marker], none);
    expect(
      configCandidates(handler?.config as WidgetConfigFile, short).map((f) =>
        f.replace("LuaUI/Config/", ""),
      ),
    ).toEqual(files);
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
    ]);
  });
});

describe("loads", () => {
  const sf: WidgetHandler = {
    id: "sf",
    family: "engine",
    folders: ["LuaUI/widgets"],
    subfolders: false,
    config: { files: ["{short}.lua"], shape: "nested" },
  };
  const bar: WidgetHandler = {
    id: "bar",
    family: "ba",
    folders: ["LuaUI/Widgets", "LuaUI/RmlWidgets"],
    subfolders: true,
    config: { files: ["{short}.lua"], shape: "nested" },
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
