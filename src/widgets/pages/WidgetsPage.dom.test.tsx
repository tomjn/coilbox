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
import type { WidgetHandler } from "../handlers";
import type { SwitchesState } from "../useWidgetSwitches";
import { type GameHandler, widgetRows } from "../widgetList";

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
  { game: "Metal Factions v2.58", handler: engine },
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

const switches = {
  state: { kind: "none" } as SwitchesState,
  error: null as string | null,
  running: false,
  writing: null as string | null,
  toggle: vi.fn(async (_name: string, _on: boolean) => {}),
  reload: async () => {},
};

vi.mock("../useWidgetSwitches", () => ({
  useWidgetSwitches: () => switches,
}));

beforeEach(() => {
  switches.state = { kind: "none" };
  switches.running = false;
  switches.toggle.mockClear();
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

  it("switches a widget in the picked game's file", () => {
    switches.state = {
      kind: "ready",
      path: "/home/player/.spring/LuaUI/Config/MF.lua",
      order: new Map([["BuildWatch", 0]]),
    };
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    const buildWatch = screen.getByRole("switch", { name: "BuildWatch on" });
    expect(buildWatch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(buildWatch);
    expect(switches.toggle).toHaveBeenCalledWith("BuildWatch", true);
  });

  it("reads a widget's state under the name it had before", () => {
    switches.state = {
      kind: "ready",
      path: "/home/player/.spring/LuaUI/Config/MF.lua",
      order: new Map([["Old Watch", 4]]),
    };
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    const buildWatch = screen.getByRole("switch", { name: "BuildWatch on" });
    expect(buildWatch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(buildWatch);
    // Written under its own name, which the handler reads first.
    expect(switches.toggle).toHaveBeenCalledWith("BuildWatch", false);
  });

  it("offers no switch while a game is running", () => {
    switches.state = { kind: "ready", path: "x", order: new Map() };
    switches.running = true;
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    expect(
      screen.getByText("Close the game to switch widgets on or off."),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("switch", {
          name: "BuildWatch on",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("says when the game has not saved a file yet", () => {
    switches.state = { kind: "missing" };
    page("/library/widgets?game=Metal%20Factions%20v2.58");
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "has not saved its widget settings yet",
    );
  });
});
