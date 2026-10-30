/**
 * Switching a newly added widget (issue #1286): on in the set being looked at,
 * and written as off, said outright, in the config file of every other game.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerWidgetScan } from "@/content/bindings";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import type { WidgetHandler } from "./handlers";
import type { GameHandler } from "./widgetList";

const files = new Map<string, string>();
/** The folder each scan was asked to read. */
const scanned: string[] = [];
const scan: PlayerWidgetScan = {
  caseSensitive: false,
  folders: ["LuaUI/Widgets"],
  files: ["Minimap", "Radar"].map((name) => ({
    path: `LuaUI/Widgets/${name.toLowerCase()}.lua`,
    folder: "LuaUI/Widgets",
    nested: false,
    coilbox: false,
    givesOrders: false,
    info: { name },
    error: null,
  })),
  errors: [],
};

vi.mock("@/blueprint/fileIO", () => ({
  appFileIO: {
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, text: string) => {
      files.set(path, text);
    },
  },
}));

vi.mock("@/content/bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@/content/bindings");
  return {
    ...actual,
    contentPlayerWidgets: async (args: { writeDir: string }) => {
      scanned.push(args.writeDir);
      return scan;
    },
  };
});

const { readSets, recordWrite, resetSets, updateSets } = await import(
  "./widgetSets"
);
const { switchAddedWidgets } = await import("./widgetSync");

const handler: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config: { files: ["{short}.lua"], shape: "nested" },
};
const games: GameHandler[] = [
  { game: "Metal Factions v2.58", shortName: "MF", handler },
  { game: "Splinter Faction 0.1", shortName: "SF", handler },
  { game: "Not saved yet 1.0", shortName: "NS", handler },
  { game: "Mystery 1.0", handler: null },
];
const MF = "/spring/LuaUI/Config/MF.lua";
const SF = "/spring/LuaUI/Config/SF.lua";
const saved = "return {\n\torder = {\n\t\tMinimap = 1,\n\t},\n}\n";

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  resetSets();
  scanned.length = 0;
  files.clear();
  files.set(MF, saved);
  files.set(SF, saved);
});

// `writeDir` is where the games' config files are looked for, so the files
// above sit in its `LuaUI/Config`. The widgets are under `widgetDir`, which is
// another folder for an engine that keeps its own springsettings.cfg.
const run = (key: string | null) =>
  switchAddedWidgets({
    widgetDir: "/content",
    writeDir: "/spring",
    games,
    key,
    names: ["Radar"],
  });

describe("switchAddedWidgets", () => {
  it("writes the new widget as off in the file of each game it was not added for", async () => {
    expect(await run("SF")).toEqual([]);
    expect(readSets().overrides.SF).toMatchObject({ Radar: true });
    expect(readSets().global).toMatchObject({ Radar: false });
    expect(files.get(MF)).toContain('["Radar"] = 0');
    expect(files.get(SF)).toContain('["Radar"] = 1');
  });

  it("reads the widgets from the widget folder, not the write folder", async () => {
    await run(null);
    expect(scanned).toEqual(["/content"]);
  });

  it("writes it as on everywhere when added for all games", async () => {
    await run(null);
    expect(readSets().global).toMatchObject({ Radar: true });
    expect(files.get(MF)).toContain('["Radar"] = 1');
    expect(files.get(SF)).toContain('["Radar"] = 1');
  });

  it("is not undone by an entry a removed copy of the widget left in a file", async () => {
    // Coilbox once wrote Radar on, the player switched it off in the game and
    // removed the widget. Adding it again for all games still switches it on.
    updateSets((s) => recordWrite(s, MF, new Map([["Radar", true]])));
    files.set(
      MF,
      "return {\n\torder = {\n\t\tMinimap = 1,\n\t\tRadar = 0,\n\t},\n}\n",
    );
    await run(null);
    expect(readSets().global).toMatchObject({ Radar: true });
    expect(files.get(MF)).toContain("Radar = 1");
  });

  it("leaves a game that has saved no file without one", async () => {
    await run(null);
    // Writing a file keeps a dated copy of what it replaced beside it.
    const written = [...files.keys()].filter((p) => !p.includes(".bak"));
    expect(written.sort()).toEqual([MF, SF]);
  });

  it("changes nothing when no widget has a name to switch", async () => {
    expect(
      await switchAddedWidgets({
        widgetDir: "/content",
        writeDir: "/spring",
        games,
        key: null,
        names: [],
      }),
    ).toEqual([]);
    expect(readSets().global).toEqual({});
  });
});
