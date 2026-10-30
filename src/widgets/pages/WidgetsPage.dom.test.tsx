// @vitest-environment happy-dom
/**
 * The Widgets page (issue #1284) on a list it has already read: every file
 * with what it declares, coilbox's own marked, a broken one with its error,
 * and the games that load each one.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      info: { name: "Coilbox blueprints" },
      error: null,
    },
    {
      path: "LuaUI/Widgets/pack/helper.lua",
      folder: "LuaUI/Widgets",
      nested: true,
      coilbox: false,
      info: null,
      error: "runtime error: attempt to perform arithmetic on a nil value",
    },
    {
      path: "LuaUI/Widgets/twin_a.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
      info: { name: "Twin" },
      error: null,
    },
    {
      path: "LuaUI/Widgets/twin_b.lua",
      folder: "LuaUI/Widgets",
      nested: false,
      coilbox: false,
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
    writeDir: "/home/player/.spring",
    locating: false,
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

beforeEach(() => {
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
