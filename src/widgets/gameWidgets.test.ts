import { describe, expect, it } from "vitest";
import type { PlayerWidgetScan } from "@/content/bindings";
import {
  type GameWidget,
  gameWidgetRows,
  gameWidgetStates,
  readWidgets,
  widgetMembers,
} from "./gameWidgets";
import type { WidgetHandler } from "./handlers";
import { type GameHandler, widgetRows } from "./widgetList";

const bar: WidgetHandler = {
  id: "bar",
  family: "ba",
  folders: ["LuaUI/Widgets", "LuaUI/RmlWidgets"],
  subfolders: true,
  config: { files: ["BYAR.lua"], shape: "nested" },
};
const sf: WidgetHandler = {
  id: "sf",
  family: "engine",
  folders: ["LuaUI/widgets"],
  subfolders: false,
  config: { files: ["{SHORT}_data.lua"], shape: "nested" },
};

const owner = new Map([
  ["luaui/widgets/gui_a.lua", "game.sdp"],
  ["luaui/widgets/pack/gui_b.lua", "game.sdp"],
  ["luaui/widgets/pack/deep/c.lua", "game.sdp"],
  ["luaui/rmlwidgets/gui_r.lua", "game.sdp"],
  ["luaui/widgets/readme.txt", "game.sdp"],
  ["luaui/headers/keysym.h.lua", "game.sdp"],
  ["LuaUI/Widgets/base.lua", "base.sdz"],
]);

describe("widgetMembers", () => {
  it("takes the handler's folders whatever their case, one subfolder down when it reads them", () => {
    const got = widgetMembers(owner, bar);
    expect(got.get("game.sdp")).toEqual([
      {
        path: "luaui/widgets/gui_a.lua",
        folder: "LuaUI/Widgets",
        nested: false,
      },
      {
        path: "luaui/widgets/pack/gui_b.lua",
        folder: "LuaUI/Widgets",
        nested: true,
      },
      {
        path: "luaui/rmlwidgets/gui_r.lua",
        folder: "LuaUI/RmlWidgets",
        nested: false,
      },
    ]);
    expect(got.get("base.sdz")).toEqual([
      {
        path: "LuaUI/Widgets/base.lua",
        folder: "LuaUI/Widgets",
        nested: false,
      },
    ]);
  });

  it("leaves subfolders out for a handler that does not read them", () => {
    expect(
      widgetMembers(owner, sf)
        .get("game.sdp")
        ?.map((m) => m.path),
    ).toEqual(["luaui/widgets/gui_a.lua"]);
  });
});

describe("readWidgets", () => {
  const members = [
    { path: "w/a.lua", folder: "w", nested: false },
    { path: "w/plain.lua", folder: "w", nested: false },
    { path: "w/pack/helper.lua", folder: "w", nested: true },
    { path: "w/broken.lua", folder: "w", nested: false },
  ];
  it("drops helpers in subfolders and says why a direct file is not a widget", () => {
    const got = readWidgets(members, "g.sdz", [
      { path: "w/a.lua", info: { name: "A" }, error: null },
      { path: "w/plain.lua", info: null, error: null },
      { path: "w/pack/helper.lua", info: null, error: null },
      { path: "w/broken.lua", info: null, error: "syntax error" },
    ]);
    expect(got.map((w) => [w.path, w.info?.name ?? null, w.error])).toEqual([
      ["w/a.lua", "A", null],
      ["w/plain.lua", null, "the file defines no GetInfo function"],
      ["w/broken.lua", null, "syntax error"],
    ]);
  });
});

const game: GameHandler = {
  game: "Beyond All Reason",
  shortName: "BYAR",
  handler: bar,
};

const own = (path: string, name: string, extra = {}): GameWidget => ({
  path,
  archive: "game.sdp",
  folder: "LuaUI/Widgets",
  nested: false,
  info: { name, ...extra },
  error: null,
});

const scan: PlayerWidgetScan = {
  caseSensitive: false,
  folders: ["LuaUI/Widgets"],
  files: [
    {
      root: "/data",
      path: "LuaUI/Widgets/my_minimap.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
      givesOrders: false,
      info: { name: "Minimap" },
      error: null,
    },
  ],
  errors: [],
};

describe("gameWidgetRows", () => {
  const rows = gameWidgetRows(
    [
      own("luaui/widgets/gui_a.lua", "A"),
      own("luaui/widgets/minimap.lua", "Minimap"),
      own("luaui/widgets/t1.lua", "Twin"),
      own("luaui/widgets/t2.lua", "Twin"),
    ],
    game,
    widgetRows(scan, [game]),
  );

  it("gives a game widget a switch under its name", () => {
    expect(rows[0].switch).toEqual({
      kind: "ready",
      name: "A",
      previousNames: [],
    });
    expect(rows[0].loadedBy).toEqual(["Beyond All Reason"]);
  });

  it("leaves the switch to a player widget with the same name", () => {
    expect(rows[1].switch).toEqual({
      kind: "none",
      reason: "duplicate",
      name: "Minimap",
      others: ["LuaUI/Widgets/my_minimap.lua"],
    });
  });

  it("gives two game widgets with one name no switch", () => {
    expect(rows[2].switch.kind).toBe("none");
    expect(rows[3].switch.kind).toBe("none");
  });
});

describe("gameWidgetStates", () => {
  it("reads the order entry, its previous name, or what GetInfo says", () => {
    const rows = gameWidgetRows(
      [
        own("w/on.lua", "On"),
        own("w/off.lua", "Off", { enabled: true }),
        own("w/renamed.lua", "New", { previousNames: ["Old"] }),
        own("w/default.lua", "Default", { enabled: true }),
        own("w/unset.lua", "Unset"),
      ],
      game,
      [],
    );
    const order = new Map([
      ["On", 12],
      ["Off", 0],
      ["Old", 3],
    ]);
    expect(gameWidgetStates(rows, order)).toEqual({
      On: true,
      Off: false,
      New: true,
      Default: true,
      Unset: false,
    });
  });
});
