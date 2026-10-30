import { describe, expect, it } from "vitest";
import {
  HANDLER_FOLDERS,
  loads,
  recogniseHandler,
  type WidgetConfigFile,
  type WidgetHandler,
} from "./handlers";
import { configCandidates, dataCandidates } from "./widgetConfig";

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
    expect(handler).toMatchObject({ id, family, folders, subfolders: false });
  });

  it("finds MOSAIC's file in its own configs folder, not Config", async () => {
    const handler = await recogniseHandler(
      ["luaui.lua", "luaui/mosaicwidgets.lua"],
      none,
    );
    expect(
      configCandidates(handler?.config as WidgetConfigFile, "mosaic"),
    ).toEqual(["LuaUI/configs/MOSAIC_data.lua"]);
  });

  it.each([
    ["LuaUI/mosaicwidgets.lua", "mosaic", "mosaicmain.lua"],
    ["LuaUI/tapwidgets.lua", "tap", "tapmain.lua"],
  ])("does not take %s's main.lua for jK's", async (marker, id, main) => {
    const handler = await recogniseHandler(
      ["luaui.lua", "LuaUI/main.lua", marker],
      async () => `VFS.Include(LUAUI_DIRNAME .. '${main}')`,
    );
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
    ["luaui/widgets_evo.lua", "evo", ["EVO_data.lua"]],
    ["luaui/jauriawidgets.lua", "jauria", ["JAURIA_order.lua"]],
    ["luaui/tapwidgets.lua", "tap", ["tap.lua"]],
    ["luaui/config/iwui.config.lua", "iw", ["iw.lua"]],
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

// What can stop each game loading a player's widgets, as read from the
// handlers and mod options in the games' own archives (#1292).
describe("userWidgets", () => {
  const gates = async (marker: string) =>
    (await recogniseHandler(["luaui.lua", marker], none))?.userWidgets;

  it("gives Beyond All Reason its option, flag, colour mode, spectator rule and unit control option", async () => {
    expect(await gates("luaui/barwidgets.lua")).toEqual({
      option: { key: "allowuserwidgets", loads: true, unset: true },
      configFlag: true,
      anonymousColours: true,
      spectators: "all",
      unitControlOption: "allowunitcontrolwidgets",
    });
  });

  it("gives Splinter Faction an option that is off until the room turns it on", async () => {
    expect((await gates("luaui/widgets_custom.lua"))?.option).toEqual({
      key: "allowuserwidgets",
      loads: true,
      unset: false,
    });
  });

  it("gives Balanced Annihilation its prefixed option and the flag in BA.lua", async () => {
    expect(await gates("luaui/bawidgets.lua")).toEqual({
      option: { key: "mo_allowuserwidgets", loads: true, unset: true },
      configFlag: true,
    });
  });

  it("gives the Complete Annihilation family the local widgets entry and Zero-K's option", async () => {
    expect(await gates("luaui/cawidgets.lua")).toMatchObject({
      option: { key: "disable_local_widgets", loads: false },
      localWidgetsFile: "{SHORT}_data.lua",
    });
  });

  it("gives Jauria RTS the local widgets entry and no option", async () => {
    expect(await gates("luaui/jauriawidgets.lua")).toEqual({
      localWidgetsFile: "{SHORT}_data.lua",
    });
  });

  it("gives MOSAIC an option and a flag, and Total Annihilation Prime only the flag", async () => {
    expect(await gates("luaui/mosaicwidgets.lua")).toMatchObject({
      option: { key: "allowuserwidgets" },
      configFlag: true,
    });
    expect(await gates("luaui/tapwidgets.lua")).toEqual({ configFlag: true });
  });

  it.each([
    "luaui/mfwidgets.lua",
    "luaui/widgets_evo.lua",
    "luaui/config/iwui.config.lua",
  ])("gives %s no gates", async (marker) => {
    expect(await gates(marker)).toBeUndefined();
  });

  it("gives the engine's own handler, the default handler, Spring 1944 and the pre-0.83 handler no gates", async () => {
    const recognised = [
      ["engine's own", await recogniseHandler(["units/a.lua"], none), "engine"],
      [
        "default",
        await recogniseHandler(["LuaUI/widgets.lua"], none),
        "engine",
      ],
      [
        "Spring 1944",
        await recogniseHandler(
          ["LuaUI/main.lua"],
          async () => 'include "LuaHandler/handler.lua"',
        ),
        "jk",
      ],
      [
        "pre-0.83",
        await recogniseHandler(
          ["LuaUI/widgets.lua"],
          async () => "local ORDER_FILENAME = 'Config/widget_order.lua'",
        ),
        "legacy",
      ],
    ] as const;
    for (const [, handler, family] of recognised) {
      expect(handler?.family).toBe(family);
      expect(handler?.userWidgets).toBeUndefined();
    }
  });

  it("keeps a data file where the handler saves it, beside the config", async () => {
    const handler = await recogniseHandler(["luaui/cawidgets.lua"], none);
    expect(
      configCandidates(
        {
          ...(handler?.config as WidgetConfigFile),
          files: [handler?.userWidgets?.localWidgetsFile ?? ""],
        },
        "ZK",
      ),
    ).toEqual(["LuaUI/Config/ZK_data.lua"]);
  });
});

describe("dataCandidates", () => {
  const markers = [
    [
      "luaui/cawidgets.lua",
      ["LuaUI/Config/ZK_data.lua", "LuaUI/Config/Zk_data.lua"],
    ],
    ["luaui/jauriawidgets.lua", ["LuaUI/Config/ZK_data.lua"]],
    ["luaui/main.lua", ["LuaUI/Config/Zk_data.lua"]],
    ["luaui/barwidgets.lua", ["LuaUI/Config/BYAR.lua"]],
    ["luaui/widgets_custom.lua", ["LuaUI/Config/ZK_data.lua"]],
    ["luaui/mosaicwidgets.lua", ["LuaUI/configs/ZK_data.lua"]],
  ] as const;

  it.each(
    markers,
  )("%s keeps widgets' saved settings in %j", async (marker, expected) => {
    const handler = await recogniseHandler(
      ["luaui.lua", marker],
      async () => "LuaHandler/handler.lua",
    );
    expect(dataCandidates(handler?.config as WidgetConfigFile, "Zk")).toEqual(
      expected,
    );
  });

  it("gives only a handler that keeps its order apart a data file of its own", async () => {
    const own = ["ca", "jauria", "jk", "legacy"];
    for (const [marker] of [
      ["luaui/cawidgets.lua"],
      ["luaui/jauriawidgets.lua"],
      ["luaui/main.lua"],
      ["luaui/barwidgets.lua"],
      ["luaui/bawidgets.lua"],
      ["luaui/mfwidgets.lua"],
      ["luaui/widgets_evo.lua"],
      ["luaui/tapwidgets.lua"],
      ["luaui/config/iwui.config.lua"],
    ]) {
      const handler = await recogniseHandler(
        ["luaui.lua", marker],
        async () => "LuaHandler/handler.lua",
      );
      expect(!!handler?.config.dataFiles).toBe(own.includes(handler?.id ?? ""));
      expect(!!handler?.config.dataFiles).toBe(
        handler?.config.shape === "flat",
      );
    }
    const legacy = await recogniseHandler(
      ["luaui/widgets.lua"],
      async () => "Config/widget_order.lua",
    );
    expect(legacy?.config.dataFiles).toEqual(["widget_data.lua"]);
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

describe("Complete Annihilation's handlers", () => {
  it("tells the one that saves to the shared files from the later one", async () => {
    const old = await recogniseHandler(
      ["luaui/cawidgets.lua"],
      async () =>
        "local ORDER_FILENAME = LUAUI_DIRNAME .. 'Config/widget_order.lua'",
    );
    expect(old?.id).toBe("ca-old");
    expect(old?.config.files).toEqual(["widget_order.lua"]);
    const later = await recogniseHandler(
      ["luaui/cawidgets.lua"],
      async () =>
        "local ORDER_FILENAME = LUAUI_DIRNAME .. 'Config/ZK_order.lua'",
    );
    expect(later?.id).toBe("ca");
    expect(later?.source).toBe("luaui/cawidgets.lua");
  });
});
