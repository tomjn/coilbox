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
import type { PlayerWidgetFile, PlayerWidgetScan } from "@/content/bindings";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import type { GameWidget } from "../gameWidgets";
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

const ROOT = "/home/player/.spring";
const SECOND = "/mnt/games/spring";

const scan: PlayerWidgetScan = {
  caseSensitive: false,
  folders: ["LuaUI/Widgets"],
  files: [
    {
      root: ROOT,
      caseSensitive: false,
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
      root: ROOT,
      caseSensitive: false,
      path: "LuaUI/Widgets/coilbox_blueprints.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: true,
      givesOrders: false,
      info: { name: "Coilbox blueprints" },
      error: null,
    },
    {
      root: ROOT,
      caseSensitive: false,
      path: "LuaUI/Widgets/pack/helper.lua",
      folder: "LuaUI/Widgets",
      nested: true,
      coilbox: false,
      givesOrders: false,
      info: null,
      error: "runtime error: attempt to perform arithmetic on a nil value",
    },
    {
      root: ROOT,
      caseSensitive: false,
      path: "LuaUI/Widgets/twin_a.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
      givesOrders: false,
      info: { name: "Twin" },
      error: null,
    },
    {
      root: ROOT,
      caseSensitive: false,
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
  {
    game: "Metal Factions",
    shortName: "MF",
    handler: engine,
    versions: ["Metal Factions v2.58", "Metal Factions v2.57"],
  },
  { game: "Mystery 1.0", handler: null },
];

/** What the page is told about the engine's write folder, and whether a second
 *  content root holds a widget too. */
const list: { configDir: string | undefined; second: boolean } = {
  configDir: "/home/player/.spring/engine/2026.09.01",
  second: false,
};

const secondFile: PlayerWidgetFile = {
  root: SECOND,
  caseSensitive: false,
  path: "LuaUI/Widgets/gui_build_watch.lua",
  folder: "LuaUI/Widgets",
  nested: false,
  coilbox: false,
  givesOrders: false,
  info: { name: "BuildWatch" },
  error: null,
};

vi.mock("../useWidgetList", () => ({
  useWidgetList: () => {
    const shown = list.second
      ? { ...scan, files: [...scan.files, secondFile] }
      : scan;
    return {
      targets: [{}],
      enginePath: "/engines/2026.09.01",
      installed: [{ name: "Metal Factions v2.58" }],
      widgetDir: ROOT,
      roots: list.second ? [ROOT, SECOND] : [ROOT],
      configDir: list.configDir,
      widgets: shown,
      games,
      rows: widgetRows(shown, games),
      reading: false,
      error: null,
      folderErrors: [],
      gamesKnown: true,
      reload: async () => {},
    };
  },
}));

const files = {
  files: new Map<string, GameFile>(),
  reload: async () => {},
};

vi.mock("@/content/contentState", () => ({
  loadContentState: async () => ({
    schemaVersion: 1,
    roots: (list.second ? [ROOT, SECOND] : [ROOT]).map((path) => ({
      path,
      exists: true,
      valid: true,
    })),
  }),
}));

vi.mock("../useGameFiles", () => ({
  useGameFiles: () => files,
}));

const openPath = vi.fn(async (_: { path: string }) => ({}));
const play = { running: false };
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => play,
}));

// The games have saved no config file here unless a test puts one in.
const disk = new Map<string, string>();
vi.mock("@/blueprint/fileIO", () => ({
  appFileIO: {
    read: async (path: string) => disk.get(path) ?? null,
    write: async (path: string, text: string) => {
      disk.set(path, text);
    },
  },
}));

/** The widgets the picked game ships. */
const shipped: { widgets: GameWidget[] | null } = { widgets: null };
vi.mock("../useGameWidgets", () => ({
  useGameWidgets: () => ({
    widgets: shipped.widgets,
    reading: false,
    errors: [],
  }),
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
  list.configDir = "/home/player/.spring/engine/2026.09.01";
  list.second = false;
  play.running = false;
  removeCalls.length = 0;
  disk.clear();
  shipped.widgets = [];
  installSettingsStorage(memorySettingsStorage());
  resetSets();
  files.files = new Map([
    ["Metal Factions", { kind: "ready", path: "/x/MF.lua", order: new Map() }],
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
    // A licence matters to game developers, not to players.
    expect(screen.queryByText("GPLv2")).toBeNull();
    expect(screen.getByText("someone")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Coilbox")).toBeTruthy();
    expect(
      screen.getByText(
        "Could not read: runtime error: attempt to perform arithmetic on a nil value",
      ),
    ).toBeTruthy();
    // The nested file loads in no game, the other four in Metal Factions, which
    // only the nested file's row needs to say anything about. Mystery's handler
    // is not recognised, so it may still load that file.
    expect(
      screen.getAllByText("No game coilbox recognises loads this."),
    ).toHaveLength(1);
    expect(screen.queryByText("Metal Factions")).toBeNull();
  });

  it("says so when a widget states no author, and not when it could not be read", () => {
    page();
    // The coilbox row and the two Twin rows declare none. The unreadable row
    // says nothing.
    expect(screen.getAllByText("No author stated")).toHaveLength(3);
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
    page("/library/widgets?game=Metal%20Factions");
    expect(screen.getByText("BuildWatch")).toBeTruthy();
    expect(screen.queryByText("helper.lua")).toBeNull();
  });

  it("lists each game once, whatever versions are installed", () => {
    page();
    fireEvent.click(screen.getByRole("combobox", { name: "Game" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All games",
      "Metal Factions",
      "Mystery 1.0",
    ]);
  });

  it("lands on the game's entry from a link naming one of its versions", () => {
    page("/library/widgets?game=Metal%20Factions%20v2.57");
    expect(
      screen.getByRole("combobox", { name: "Game" }).textContent,
    ).toContain("Metal Factions");
    expect(screen.getByRole("switch", { name: "BuildWatch on" })).toBeTruthy();
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
    page("/library/widgets?game=Metal%20Factions");
    const buildWatch = screen.getByRole("switch", { name: "BuildWatch on" });
    expect(buildWatch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(buildWatch);
    expect(readSets().global).toEqual({ BuildWatch: true });
    expect(readSets().overrides.MF).toEqual({ BuildWatch: false });
    expect(
      screen.getByText(
        "Metal Factions uses its own widgets, not the ones for all games.",
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

  it("offers no settings when the engine does not say where its config is", () => {
    page("/library/widgets?game=Metal Factions v2.58");
    expect(
      screen.queryAllByRole("button", { name: /^Settings of / }).length,
    ).toBeGreaterThan(0);
    cleanup();
    list.configDir = undefined;
    page("/library/widgets?game=Metal Factions v2.58");
    expect(screen.queryAllByRole("button", { name: /^Settings of / })).toEqual(
      [],
    );
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
      ["Metal Factions", { kind: "error", error: "bad file" }],
    ]);
    page();
    expect(screen.getByText("Metal Factions: bad file")).toBeTruthy();
  });

  it("asks before removing a widget, naming the games that lose it", async () => {
    page();
    fireEvent.click(screen.getByRole("button", { name: "Remove BuildWatch" }));
    expect(screen.getByText("Remove BuildWatch?")).toBeTruthy();
    expect(
      screen.getByText(
        "It is removed from every game that loads it: Metal Factions",
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

  it("shows where each widget is when there is more than one content root, and removes from that root", async () => {
    list.second = true;
    page();
    expect(
      screen.getByText(`${ROOT}/LuaUI/Widgets/gui_build_watch.lua`),
    ).toBeTruthy();
    expect(
      screen.getByText(`${SECOND}/LuaUI/Widgets/gui_build_watch.lua`),
    ).toBeTruthy();
    // Each says the other is the same widget, by where it is.
    expect(
      screen.getByText(
        `Has the same name as ${SECOND}/LuaUI/Widgets/gui_build_watch.lua, so they share one setting.`,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove BuildWatch" })[1],
    );
    const confirm = await waitFor(() => {
      const button = screen
        .getAllByRole("button", { name: "Remove" })
        .find((b) => b.className.includes("destructive"));
      if (!button || button.hasAttribute("disabled")) throw new Error("wait");
      return button;
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(removeCalls).toHaveLength(1));
    expect(removeCalls[0]).toMatchObject({
      writeDir: SECOND,
      files: ["LuaUI/Widgets/gui_build_watch.lua"],
    });
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
        "Metal Factions",
        { kind: "error", error: "Coilbox could not read this file: x" },
      ],
    ]);
    page("/library/widgets?game=Metal%20Factions");
    expect(
      screen.getByText("Coilbox could not read this file: x"),
    ).toBeTruthy();
  });

  it("lists a game's own widgets and switches one in its config file", async () => {
    const config = "/home/player/.spring/engine/2026.09.01/LuaUI/Config/MF.lua";
    disk.set(
      config,
      'return {\n\torder = {\n\t\t["Unit Glow"] = 5,\n\t\tRadar = 0,\n\t},\n}\n',
    );
    files.files = new Map([
      [
        "Metal Factions",
        {
          kind: "ready",
          path: config,
          order: new Map([
            ["Unit Glow", 5],
            ["Radar", 0],
          ]),
        },
      ],
    ]);
    const shippedWidget = (path: string, name: string): GameWidget => ({
      path,
      archive: "mf.sdz",
      folder: "LuaUI/Widgets",
      nested: false,
      info: { name },
      error: null,
    });
    shipped.widgets = [
      shippedWidget("luaui/widgets/unit_glow.lua", "Unit Glow"),
      shippedWidget("luaui/widgets/radar.lua", "Radar"),
      shippedWidget("luaui/widgets/watch.lua", "BuildWatch"),
    ];
    page("/library/widgets?game=Metal%20Factions");
    expect(screen.getByText("Metal Factions's own widgets")).toBeTruthy();
    const glow = screen.getByRole("switch", { name: "Unit Glow on" });
    expect(glow.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Radar on" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    // The player's BuildWatch has the name, so only its switch sets it.
    expect(
      screen.getAllByRole("switch", { name: "BuildWatch on" }),
    ).toHaveLength(1);
    fireEvent.click(glow);
    await waitFor(() =>
      expect(disk.get(config)).toBe(
        'return {\n\torder = {\n\t\t["Unit Glow"] = 0,\n\t\tRadar = 0,\n\t},\n}\n',
      ),
    );
    // A game widget is no set's business.
    expect(readSets().global).toEqual({});
  });

  it("creates the config file when a game's own widget is switched before the game has saved one", async () => {
    files.files = new Map([["Metal Factions", { kind: "missing" }]]);
    const shippedWidget = (name: string, enabled: boolean): GameWidget => ({
      path: `luaui/widgets/${name}.lua`,
      archive: "mf.sdz",
      folder: "LuaUI/Widgets",
      nested: false,
      info: { name, enabled },
      error: null,
    });
    shipped.widgets = [
      shippedWidget("Glow", true),
      shippedWidget("Radar", false),
    ];
    page("/library/widgets?game=Metal%20Factions");
    // With no file, each widget is as its `GetInfo()` says.
    const glow = screen.getByRole("switch", { name: "Glow on" });
    expect(glow.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Radar on" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.click(glow);
    await waitFor(() => expect(disk.size).toBe(1));
    expect([...disk.values()]).toEqual([
      'return {\n\torder = {\n\t\t["Glow"] = 0,\n\t},\n}\n',
    ]);
  });

  it("offers a reset only when a game's own widget is away from its default, and resets it", async () => {
    const config = `${list.configDir}/LuaUI/Config/MF.lua`;
    const text =
      'return {\n\tdata = {\n\t\tGlow = { size = 3 },\n\t},\n\torder = {\n\t\t["Glow"] = 0,\n\t\t["Radar"] = 4,\n\t\t["Theirs"] = 5,\n\t},\n}\n';
    disk.set(config, text);
    shipped.widgets = [
      {
        path: "luaui/widgets/glow.lua",
        archive: "mf.sdz",
        folder: "LuaUI/Widgets",
        nested: false,
        info: { name: "Glow", enabled: true },
        error: null,
      },
    ];
    const reset = { name: "Reset Metal Factions's own widgets" };
    files.files = new Map([
      [
        "Metal Factions",
        { kind: "ready", path: config, order: new Map([["Glow", 1]]) },
      ],
    ]);
    const first = page("/library/widgets?game=Metal%20Factions");
    expect(screen.queryByRole("button", reset)).toBeNull();
    first.unmount();

    files.files = new Map([
      [
        "Metal Factions",
        { kind: "ready", path: config, order: new Map([["Glow", 0]]) },
      ],
    ]);
    page("/library/widgets?game=Metal%20Factions");
    fireEvent.click(screen.getByRole("button", reset));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() =>
      expect(disk.get(config)).toBe(
        'return {\n\tdata = {\n\t\tGlow = { size = 3 },\n\t},\n\torder = {\n\t\t["Radar"] = 4,\n\t\t["Theirs"] = 5,\n\t},\n}\n',
      ),
    );
    // The file as it was is kept beside it.
    expect([...disk.values()]).toContain(text);
  });

  it("lines a game's own widgets up with the player's by using one table", () => {
    shipped.widgets = [
      {
        path: "luaui/widgets/radar.lua",
        archive: "mf.sdz",
        folder: "LuaUI/Widgets",
        nested: false,
        info: { name: "Radar" },
        error: null,
      },
    ];
    page("/library/widgets?game=Metal%20Factions");
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText("Your widgets")).toBeTruthy();
    expect(screen.getByText("Metal Factions's own widgets")).toBeTruthy();
  });

  it("will not switch a game's own widget while a game is running", () => {
    play.running = true;
    shipped.widgets = [
      {
        path: "luaui/widgets/radar.lua",
        archive: "mf.sdz",
        folder: "LuaUI/Widgets",
        nested: false,
        info: { name: "Radar" },
        error: null,
      },
    ];
    page("/library/widgets?game=Metal%20Factions");
    expect(
      screen.getByRole("switch", { name: "Radar on" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
