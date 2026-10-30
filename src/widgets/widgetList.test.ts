import { describe, expect, it } from "vitest";
import type { PlayerWidgetFile, PlayerWidgetScan } from "@/content/bindings";
import type { WidgetHandler } from "./handlers";
import {
  findGame,
  folderToOpen,
  type InstalledGame,
  oneEntryPerGame,
  rowsForGame,
  widgetRows,
} from "./widgetList";

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

function file(
  path: string,
  folder: string,
  nested = false,
  caseSensitive = false,
  root = "/data",
): PlayerWidgetFile {
  return {
    root,
    caseSensitive,
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
        file("LuaUI/Widgets/a.lua", "LuaUI/Widgets", false, true),
        file("LuaUI/widgets/b.lua", "LuaUI/widgets", false, true),
      ],
      errors: [],
    };
    expect(widgetRows(scan, games).map((r) => r.loadedBy)).toEqual([
      ["Metal Factions v2.58", "Beyond All Reason"],
      ["Splinter Faction 0.1.96"],
    ]);
  });

  it("applies each file's own root's case rules when roots differ", () => {
    const scan: PlayerWidgetScan = {
      caseSensitive: true,
      folders: ["LuaUI/Widgets"],
      files: [
        file("LuaUI/widgets/a.lua", "LuaUI/widgets", false, true, "/ext4"),
        file("LuaUI/widgets/b.lua", "LuaUI/widgets", false, false, "/apfs"),
      ],
      errors: [],
    };
    expect(widgetRows(scan, games).map((r) => r.loadedBy)).toEqual([
      ["Splinter Faction 0.1.96"],
      ["Metal Factions v2.58", "Splinter Faction 0.1.96", "Beyond All Reason"],
    ]);
  });
});

describe("rowsForGame", () => {
  const scan: PlayerWidgetScan = {
    caseSensitive: true,
    folders: ["LuaUI/Widgets", "LuaUI/widgets"],
    files: [
      file("LuaUI/Widgets/a.lua", "LuaUI/Widgets", false, true),
      file("LuaUI/widgets/b.lua", "LuaUI/widgets", false, true),
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

describe("oneEntryPerGame", () => {
  const install = (
    game: string,
    title: string,
    version: string,
    shortName: string | undefined,
    handler: WidgetHandler | null = lower,
  ): InstalledGame => ({ game, title, version, shortName, handler });

  it("makes one entry of the versions of a game, named without a version", () => {
    const entries = oneEntryPerGame([
      install("Splinter Faction 0.1.93", "Splinter Faction", "0.1.93", "SF"),
      install("Splinter Faction 0.1.96", "Splinter Faction", "0.1.96", "SF"),
      install("Splinter Faction 0.1.95", "Splinter Faction", "0.1.95", "SF"),
    ]);
    expect(entries).toEqual([
      {
        game: "Splinter Faction",
        shortName: "SF",
        handler: lower,
        versions: [
          "Splinter Faction 0.1.96",
          "Splinter Faction 0.1.95",
          "Splinter Faction 0.1.93",
        ],
      },
    ]);
  });

  it("uses the newest version's handler", () => {
    const [entry] = oneEntryPerGame([
      install("Game 1.9", "Game", "1.9", "G", upper),
      install("Game 1.10", "Game", "1.10", "G", lower),
    ]);
    expect(entry.handler).toBe(lower);
  });

  it("keeps a game with no short name as an entry per version", () => {
    const entries = oneEntryPerGame([
      install("Odd 1", "Odd", "1", undefined),
      install("Odd 2", "Odd", "2", undefined),
    ]);
    expect(entries.map((e) => e.game)).toEqual(["Odd 1", "Odd 2"]);
    expect(entries.every((e) => e.versions === undefined)).toBe(true);
  });

  it("tells apart two games that share a name without a version", () => {
    const entries = oneEntryPerGame([
      install("Zero-K v1.14", "Zero-K", "v1.14", "ZK"),
      install("Zero-K Benchmark v3", "Zero-K", "v3", "ZKB"),
    ]);
    expect(entries.map((e) => e.game)).toEqual(["Zero-K", "Zero-K (ZKB)"]);
  });

  it("keeps names unique when the fallback name is taken too", () => {
    const entries = oneEntryPerGame([
      install("Zero-K v1.14", "Zero-K", "v1.14", "ZK"),
      install("Zero-K Benchmark v3", "Zero-K", "v3", "ZKB"),
      install("Zero-K (ZKB)", "Zero-K (ZKB)", "1", undefined),
    ]);
    expect(entries.map((e) => e.game)).toEqual([
      "Zero-K",
      "Zero-K (ZKB 2)",
      "Zero-K (ZKB)",
    ]);
  });
});

describe("findGame", () => {
  const entries = oneEntryPerGame([
    {
      game: "Splinter Faction 0.1.96",
      title: "Splinter Faction",
      version: "0.1.96",
      shortName: "SF",
      handler: lower,
    },
    {
      game: "Odd 1",
      title: "Odd",
      version: "1",
      handler: null,
    },
  ]);

  it("finds an entry by its name or by the full name of one of its versions", () => {
    expect(findGame(entries, "Splinter Faction")?.shortName).toBe("SF");
    expect(findGame(entries, "Splinter Faction 0.1.96")?.shortName).toBe("SF");
    expect(findGame(entries, "Odd 1")?.game).toBe("Odd 1");
  });

  it("finds nothing for a game that is not installed", () => {
    expect(findGame(entries, "Gone 1.0")).toBeUndefined();
    expect(findGame(null, "Gone 1.0")).toBeUndefined();
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
