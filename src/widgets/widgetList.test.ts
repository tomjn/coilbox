import { describe, expect, it } from "vitest";
import type { PlayerWidgetFile, PlayerWidgetScan } from "@/content/bindings";
import type { WidgetHandler } from "./handlers";
import { folderToOpen, rowsForGame, widgetRows } from "./widgetList";

const upper: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config: { files: ["{short}.lua"], shape: "nested" },
};
const lower: WidgetHandler = {
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

function file(path: string, folder: string, nested = false): PlayerWidgetFile {
  return {
    path,
    folder,
    nested,
    coilbox: false,
    givesOrders: false,
    info: { name: path },
    error: null,
  };
}

const games = [
  { game: "Metal Factions v2.58", handler: upper },
  { game: "Splinter Faction 0.1.96", handler: lower },
  { game: "Beyond All Reason", handler: bar },
  { game: "Mystery", handler: null },
];

describe("widgetRows", () => {
  it("says which games load each file where the filesystem folds case", () => {
    const scan: PlayerWidgetScan = {
      caseSensitive: false,
      folders: ["LuaUI/widgets", "LuaUI/RmlWidgets"],
      files: [
        file("LuaUI/widgets/a.lua", "LuaUI/widgets"),
        file("LuaUI/widgets/pack/b.lua", "LuaUI/widgets", true),
        file("LuaUI/RmlWidgets/c.lua", "LuaUI/RmlWidgets"),
      ],
      errors: [],
    };
    expect(widgetRows(scan, games).map((r) => r.loadedBy)).toEqual([
      ["Metal Factions v2.58", "Splinter Faction 0.1.96", "Beyond All Reason"],
      ["Beyond All Reason"],
      ["Beyond All Reason"],
    ]);
  });

  it("keeps the two spellings apart where the filesystem does not fold case", () => {
    const scan: PlayerWidgetScan = {
      caseSensitive: true,
      folders: ["LuaUI/Widgets", "LuaUI/widgets"],
      files: [
        file("LuaUI/Widgets/a.lua", "LuaUI/Widgets"),
        file("LuaUI/widgets/b.lua", "LuaUI/widgets"),
      ],
      errors: [],
    };
    expect(widgetRows(scan, games).map((r) => r.loadedBy)).toEqual([
      ["Metal Factions v2.58", "Beyond All Reason"],
      ["Splinter Faction 0.1.96"],
    ]);
  });
});

describe("rowsForGame", () => {
  const scan: PlayerWidgetScan = {
    caseSensitive: true,
    folders: ["LuaUI/Widgets", "LuaUI/widgets"],
    files: [
      file("LuaUI/Widgets/a.lua", "LuaUI/Widgets"),
      file("LuaUI/widgets/b.lua", "LuaUI/widgets"),
    ],
    errors: [],
  };
  const rows = widgetRows(scan, games);

  it("shows a recognised game the files it loads", () => {
    expect(rowsForGame(rows, games[1]).map((r) => r.path)).toEqual([
      "LuaUI/widgets/b.lua",
    ]);
  });

  it("shows a game with an unknown handler every file", () => {
    expect(rowsForGame(rows, games[3])).toHaveLength(2);
  });
});

describe("folderToOpen", () => {
  const scan: PlayerWidgetScan = {
    caseSensitive: false,
    folders: ["LuaUI/RmlWidgets", "LuaUI/widgets"],
    files: [],
    errors: [],
  };

  it("opens the game's first folder that is there, as spelled on disk", () => {
    expect(folderToOpen(scan, upper)).toBe("LuaUI/widgets");
  });

  it("falls back to the first scanned folder", () => {
    expect(folderToOpen(scan, null)).toBe("LuaUI/RmlWidgets");
  });

  it("is null when no folder is there", () => {
    expect(folderToOpen({ ...scan, folders: [] }, upper)).toBeNull();
  });
});
