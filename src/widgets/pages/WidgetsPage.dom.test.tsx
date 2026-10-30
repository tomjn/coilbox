// @vitest-environment happy-dom
/**
 * The Widgets page (issue #1284) on a list it has already read: every file
 * with what it declares, coilbox's own marked, a broken one with its error,
 * and the games that load each one.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerWidgetScan } from "@/content/bindings";
import type { WidgetHandler } from "../handlers";
import { type GameHandler, widgetRows } from "../widgetList";

const engine: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
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
    // The nested file loads in no game, the other two in Metal Factions.
    expect(screen.getAllByText("Metal Factions v2.58")).toHaveLength(2);
    // Mystery's handler is not recognised, so it may still load that file.
    expect(screen.getByText("No game coilbox recognises")).toBeTruthy();
  });

  it("says so when a widget states no author or licence, and not when it could not be read", () => {
    page();
    // Only the coilbox row declares neither. The unreadable row says nothing.
    expect(screen.getAllByText("No author stated")).toHaveLength(1);
    expect(screen.getAllByText("No licence stated")).toHaveLength(1);
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
});
