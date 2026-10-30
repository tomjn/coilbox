// @vitest-environment happy-dom
/**
 * The Widgets page (issue #1284) on a list it has already read: every file
 * with what it declares, coilbox's own marked, a broken one with its error,
 * and the games that load each one.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerWidgetScan } from "@/content/bindings";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import type { WidgetHandler } from "../handlers";
import { type GameHandler, widgetRows } from "../widgetList";
import { readSets, resetSets, updateSets } from "../widgetSets";
import type { GameFile } from "../widgetSync";

const engine: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config: { files: ["{short}.lua"], shape: "nested" },
};

const scan: PlayerWidgetScan = {
  caseSensitive: false,
  folders: ["LuaUI/Widgets"],
  files: [
    {
      path: "LuaUI/Widgets/gui_build_watch.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
      givesOrders: false,
      info: {
        name: "BuildWatch",
        desc: "Watches builds",
        author: "someone",
        version: "2",
        license: "GPLv2",
        previousNames: ["Old Watch"],
      },
      error: null,
    },
    {
      path: "LuaUI/Widgets/coilbox_blueprints.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: true,
      givesOrders: false,
      info: { name: "Coilbox blueprints" },
      error: null,
    },
    {
      path: "LuaUI/Widgets/pack/helper.lua",
      folder: "LuaUI/Widgets",
      nested: true,
      coilbox: false,
      givesOrders: false,
      info: null,
      error: "runtime error: attempt to perform arithmetic on a nil value",
    },
    {
      path: "LuaUI/Widgets/twin_a.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
      givesOrders: false,
      info: { name: "Twin" },
      error: null,
    },
    {
      path: "LuaUI/Widgets/twin_b.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
      givesOrders: false,
      info: { name: "Twin" },
      error: null,
    },
  ],
  errors: [],
};

const games: GameHandler[] = [
  { game: "Metal Factions v2.58", shortName: "MF", handler: engine },
  { game: "Mystery 1.0", handler: null },
];

vi.mock("../useWidgetList", () => ({
  useWidgetList: () => ({
    targets: [{}],
    widgetDir: "/home/player/.spring",
    configDir: "/home/player/.spring/engine/2026.09.01",
    widgets: scan,
    games,
    rows: widgetRows(scan, games),
    reading: false,
    error: null,
    folderErrors: [],
    gamesKnown: true,
    reload: async () => {},
  }),
}));

const files = {
  files: new Map<string, GameFile>(),
  reload: async () => {},
};

vi.mock("../useGameFiles", () => ({
  useGameFiles: () => files,
}));

const openPath = vi.fn(async (_: { path: string }) => ({}));
const play = { running: false };
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => play,
}));

// The games have saved no config file here.
vi.mock("@/blueprint/fileIO", () => ({
  appFileIO: { read: async () => null, write: async () => {} },
}));

const removeCalls: { files: string[]; folders: string[] }[] = [];
vi.mock("@/content/bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@/content/bindings");
  return {
    ...actual,
    contentWidgetDelete: async (args: {
      files: string[];
      folders: string[];
    }) => {
      removeCalls.push(args);
      return {
        files: args.files,
        backup: `/data/widget-backups/${removeCalls.length}-buildwatch`,
      };
    },
    contentWidgetRestore: async () => ["LuaUI/Widgets/gui_build_watch.lua"],
    contentPlayerWidgets: async () => scan,
    contentOpenPath: (args: { path: string }) => openPath(args),
  };
});

beforeEach(() => {
  play.running = false;
  removeCalls.length = 0;
  installSettingsStorage(memorySettingsStorage());
  resetSets();
  files.files = new Map([
    ["Metal Factions v2.58", { kind: "ready", path: "/x/MF.lua" }],
  ]);
});

const { default: WidgetsPage } = await import("./WidgetsPage");

const page = (url = "/library/widgets") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <WidgetsPage />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("WidgetsPage", () => {
  it("lists every file with what it declares and who loads it", () => {
    page();
    expect(screen.getByText("BuildWatch")).toBeTruthy();
    expect(screen.getByText("Watches builds")).toBeTruthy();
    expect(screen.getByText("GPLv2")).toBeTruthy();
    expect(screen.getByText("someone")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Coilbox")).toBeTruthy();
    expect(
      screen.getByText(
        "Could not read: runtime error: attempt to perform arithmetic on a nil value",
      ),
    ).toBeTruthy();
    // The nested file loads in no game, the other four in Metal Factions.
    expect(screen.getAllByText("Metal Factions v2.58")).toHaveLength(4);
    // Mystery's handler is not recognised, so it may still load that file.
    expect(screen.getByText("No game coilbox recognises")).toBeTruthy();
  });

  it("says so when a widget states no author or licence, and not when it could not be read", () => {
    page();
    // The coilbox row and the two Twin rows declare neither. The unreadable
    // row says nothing.
    expect(screen.getAllByText("No author stated")).toHaveLength(3);
    expect(screen.getAllByText("No licence stated")).toHaveLength(3);
  });

  it("says which files share a name, and so a setting", () => {
    page();
    expect(
      screen.getByText(
        "Has the same name as LuaUI/Widgets/twin_b.lua, so they share one setting.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Has the same name as LuaUI/Widgets/twin_a.lua, so they share one setting.",
      ),
    ).toBeTruthy();
  });

  it("shows a picked game only the files it loads", () => {
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    expect(screen.getByText("BuildWatch")).toBeTruthy();
    expect(screen.queryByText("helper.lua")).toBeNull();
  });

  it("shows a game with an unknown handler every file, and says why", () => {
    page("/library/widgets?game=Mystery%201.0");
    expect(screen.getByRole("status").textContent).toContain(
      "does not recognise Mystery 1.0's widget handler",
    );
    expect(screen.getByText("helper.lua")).toBeTruthy();
  });

  it("switches a widget on for every game", () => {
    page();
    const buildWatch = screen.getByRole("switch", { name: "BuildWatch on" });
    expect(buildWatch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(buildWatch);
    expect(readSets().global).toEqual({ BuildWatch: true });
    expect(readSets().overrides).toEqual({});
    // Two files share a name, so neither has a switch.
    expect(screen.queryByRole("switch", { name: "Twin on" })).toBeNull();
  });

  it("gives a game its own set on its first change, and drops it again", () => {
    updateSets((s) => ({ ...s, global: { BuildWatch: true } }));
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    const buildWatch = screen.getByRole("switch", { name: "BuildWatch on" });
    expect(buildWatch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(buildWatch);
    expect(readSets().global).toEqual({ BuildWatch: true });
    expect(readSets().overrides.MF).toEqual({ BuildWatch: false });
    expect(
      screen.getByText(
        "Metal Factions v2.58 uses its own widgets, not the ones for all games.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use the widgets for all games" }),
    );
    expect(readSets().overrides).toEqual({});
    expect(
      screen
        .getByRole("switch", { name: "BuildWatch on" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("opens the widget folder under the content root, not the engine's folder", () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    expect(openPath).toHaveBeenCalledWith({
      path: "/home/player/.spring/LuaUI/Widgets",
    });
  });

  it("opens the drawer that adds a widget", () => {
    page();
    expect(
      screen.queryByRole("button", { name: "Choose a folder" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    expect(
      screen.getByRole("button", { name: "Choose a file or zip" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Choose a folder" }),
    ).toBeTruthy();
  });

  it("does not add a widget for a linked game that is not installed", () => {
    page("/library/widgets?game=Gone%201.0");
    expect(
      screen
        .getByRole("button", { name: "Add widget" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("offers no switch in a game whose handler is not recognised", () => {
    page("/library/widgets?game=Mystery%201.0");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("offers no switch for a linked game that is not installed", () => {
    page("/library/widgets?game=Gone%201.0");
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("shows every game's unreadable file with all games picked", () => {
    files.files = new Map([
      ["Metal Factions v2.58", { kind: "error", error: "bad file" }],
    ]);
    page();
    expect(screen.getByText("Metal Factions v2.58: bad file")).toBeTruthy();
  });

  it("says when the game has not saved a file yet", () => {
    files.files = new Map([["Metal Factions v2.58", { kind: "missing" }]]);
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    expect(screen.getByRole("status").textContent).toContain(
      "has not saved its widget settings yet",
    );
  });

  it("asks before removing a widget, naming the games that lose it", async () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Remove BuildWatch" }));
    expect(screen.getByText("Remove BuildWatch?")).toBeTruthy();
    expect(
      screen.getByText(
        "It is removed from every game that loads it: Metal Factions v2.58",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Coilbox cannot tell whether these games load it too: Mystery 1.0",
      ),
    ).toBeTruthy();
    expect(removeCalls).toEqual([]);
    // Nothing in a config file to offer to delete.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: "Remove" })
          .every((b) => !b.hasAttribute("disabled")),
      ).toBe(true),
    );
    expect(
      screen.queryByText("Also delete its entries from the config files"),
    ).toBeNull();
  });

  it("removes a widget when confirmed, forgets it in the sets, and can restore it", async () => {
    updateSets((s) => ({ ...s, global: { BuildWatch: true, Other: true } }));
    page();
    fireEvent.click(screen.getByRole("button", { name: "Remove BuildWatch" }));
    const confirm = await waitFor(() => {
      const button = screen
        .getAllByRole("button", { name: "Remove" })
        .find((b) => b.className.includes("destructive"));
      if (!button || button.hasAttribute("disabled")) throw new Error("wait");
      return button;
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByText("Removed BuildWatch.")).toBeTruthy(),
    );
    expect(removeCalls).toEqual([
      {
        writeDir: "/home/player/.spring",
        files: ["LuaUI/Widgets/gui_build_watch.lua"],
        folders: [],
        label: "BuildWatch",
      },
    ]);
    expect(readSets().global).toEqual({ Other: true });
    expect(screen.getByText("/data/widget-backups/1-buildwatch")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(
        screen.getByText("Restored BuildWatch, switched off."),
      ).toBeTruthy(),
    );
    expect(readSets().global).toEqual({ BuildWatch: false, Other: true });
  });

  it("keeps a way back for every removal, not only the last", async () => {
    page();
    for (let n = 1; n <= 2; n++) {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove BuildWatch" }),
      );
      const confirm = await waitFor(() => {
        const button = screen
          .getAllByRole("button", { name: "Remove" })
          .find((b) => b.className.includes("destructive"));
        if (!button || button.hasAttribute("disabled")) throw new Error("wait");
        return button;
      });
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(screen.getAllByText("Removed BuildWatch.")).toHaveLength(n),
      );
    }
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(2);
    // Restoring one leaves the other's button.
    fireEvent.click(screen.getAllByRole("button", { name: "Restore" })[0]);
    await waitFor(() =>
      expect(
        screen.getByText("Restored BuildWatch, switched off."),
      ).toBeTruthy(),
    );
    expect(screen.getAllByRole("button", { name: "Restore" })).toHaveLength(1);
  });

  it("offers no way to remove coilbox's own widget", () => {
    page();
    expect(
      screen.queryByRole("button", { name: "Remove Coilbox blueprints" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove BuildWatch" }),
    ).toBeTruthy();
  });

  it("will not remove while a game is running", async () => {
    play.running = true;
    page();
    fireEvent.click(screen.getByRole("button", { name: "Remove BuildWatch" }));
    expect(
      screen.getByText("A game is running. Close it to remove widgets."),
    ).toBeTruthy();
    const confirm = screen
      .getAllByRole("button", { name: "Remove" })
      .find((b) => b.className.includes("destructive"));
    expect(confirm?.hasAttribute("disabled")).toBe(true);
  });

  it("shows a file it could not read", () => {
    files.files = new Map([
      [
        "Metal Factions v2.58",
        { kind: "error", error: "Coilbox could not read this file: x" },
      ],
    ]);
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    expect(
      screen.getByText("Coilbox could not read this file: x"),
    ).toBeTruthy();
  });
});
