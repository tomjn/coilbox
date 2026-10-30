import { beforeEach, describe, expect, it } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import type { WidgetHandler } from "./handlers";
import type { ConfigFileIO } from "./widgetConfig";
import type { WidgetRow } from "./widgetList";
import {
  EMPTY_SETS,
  readSets,
  recordWrite,
  resetSets,
  updateSets,
} from "./widgetSets";
import { absorbGame } from "./widgetSync";

const handler: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config: { files: ["{short}.lua"], shape: "nested" },
};
const game = { game: "Metal Factions v2.58", shortName: "MF", handler };
const PATH = "/spring/LuaUI/Config/MF.lua";
const rows: WidgetRow[] = [
  {
    root: "/data",
    caseSensitive: false,
    path: "LuaUI/Widgets/minimap.lua",
    folder: "LuaUI/Widgets",
    nested: false,
    coilbox: false,
    givesOrders: false,
    info: { name: "Minimap" },
    error: null,
    loadedBy: [game.game],
    switch: { kind: "ready", name: "Minimap", previousNames: [] },
  },
];
const file = (on: number) =>
  `return {\n\torder = {\n\t\tMinimap = ${on},\n\t},\n}\n`;

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  resetSets();
});

describe("absorbGame", () => {
  it("reads again when a launch wrote the file during the read", async () => {
    updateSets(() =>
      recordWrite(
        { ...EMPTY_SETS, global: { Minimap: false } },
        PATH,
        new Map([["Minimap", false]]),
      ),
    );
    let text = file(0);
    let reads = 0;
    const io: ConfigFileIO = {
      read: async (p) => {
        if (p !== PATH) return null;
        const seen = text;
        if (reads++ === 0) {
          // The player switched it on and a launch wrote that meanwhile.
          updateSets((s) =>
            recordWrite(
              { ...s, global: { Minimap: true } },
              PATH,
              new Map([["Minimap", true]]),
            ),
          );
          text = file(1);
        }
        return seen;
      },
      write: async () => {},
    };
    expect(await absorbGame(io, "/spring", game, rows)).toEqual({
      kind: "ready",
      path: PATH,
      order: new Map([["Minimap", 1]]),
    });
    expect(reads).toBe(2);
    expect(readSets().global).toEqual({ Minimap: true });
  });
});
