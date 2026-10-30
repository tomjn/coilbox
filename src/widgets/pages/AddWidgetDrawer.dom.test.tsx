// @vitest-environment happy-dom
/**
 * Adding a widget (issue #1286): the drawer shows what the pick holds and where
 * it goes before it copies anything, asks before it replaces a widget that is
 * already there, and switches the new widget on in the set being looked at.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetAddOutcome, WidgetPlan } from "@/content/bindings";
import type { WidgetHandler } from "../handlers";
import type { GameHandler } from "../widgetList";

const openDialog = vi.fn();
const plan = vi.fn();
const add = vi.fn();
const switchAdded = vi.fn();
const onAdded = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openDialog(...args),
}));

vi.mock("@/content/bindings", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@/content/bindings");
  return {
    ...actual,
    contentOpenPath: vi.fn(async () => ({})),
    contentWidgetPlan: (args: unknown) => plan(args),
    contentWidgetAdd: (args: unknown) => add(args),
  };
});

vi.mock("../widgetSync", () => ({
  switchAddedWidgets: (args: unknown) => switchAdded(args),
}));

const { AddWidgetDrawer } = await import("./AddWidgetDrawer");

const config = { files: ["{short}.lua"], shape: "nested" } as const;
const engine: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config,
};
const sf: WidgetHandler = { ...engine, id: "sf", folders: ["LuaUI/widgets"] };

const games: GameHandler[] = [
  { game: "Metal Factions v2.58", shortName: "MF", handler: engine },
  { game: "Splinter Faction 0.1", shortName: "SF", handler: sf },
  { game: "Mystery 1.0", handler: null },
];

const flat: WidgetPlan = {
  files: ["gui_radar.lua"],
  widgets: [
    { path: "gui_radar.lua", name: "Radar", nested: false, error: null },
  ],
  rml: false,
  tooDeep: [],
};

const render_ = (props: { game?: GameHandler; setKey?: string | null } = {}) =>
  render(
    <AddWidgetDrawer
      widgetDir="/content"
      writeDir="/spring"
      games={games}
      caseSensitive={false}
      setKey={null}
      onAdded={onAdded}
      {...props}
    />,
  );

const choose = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await screen.findByRole("button", { name: "Add widget" });
};

const added = (backup: string | null = null): WidgetAddOutcome => ({
  kind: "added",
  folders: ["LuaUI/Widgets"],
  widgets: flat.widgets,
  backup,
});

beforeEach(() => {
  openDialog.mockResolvedValue("/downloads/gui_radar.lua");
  plan.mockResolvedValue(flat);
  add.mockResolvedValue(added());
  switchAdded.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddWidgetDrawer", () => {
  it("shows what was picked and where it goes before copying anything", async () => {
    render_();
    await choose("Choose a file or zip");
    expect(plan).toHaveBeenCalledWith({ source: "/downloads/gui_radar.lua" });
    expect(screen.getByText("Radar")).toBeTruthy();
    // Case folds here, so the two spellings are one folder.
    expect(screen.getByText("LuaUI/Widgets")).toBeTruthy();
    expect(
      screen.getByText("Metal Factions v2.58, Splinter Faction 0.1"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Coilbox does not recognise Mystery 1.0's widget handler/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Switched on for All games, off everywhere else."),
    ).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

  it("copies the widget and switches it on in the set it was looking at", async () => {
    render_({ setKey: null });
    await choose("Choose a file or zip");
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    await screen.findByText("Added to LuaUI/Widgets.");
    // The widget goes under the content root, and the games' config files in
    // the engine's write folder (issue #4856).
    expect(add).toHaveBeenCalledWith({
      writeDir: "/content",
      source: "/downloads/gui_radar.lua",
      folders: ["LuaUI/Widgets"],
      replace: false,
    });
    expect(switchAdded).toHaveBeenCalledWith({
      widgetDir: "/content",
      writeDir: "/spring",
      games,
      key: null,
      names: ["Radar"],
    });
    expect(onAdded).toHaveBeenCalled();
  });

  it("adds for the picked game alone, in its own set", async () => {
    render_({ game: games[1], setKey: "SF" });
    await choose("Choose a file or zip");
    expect(screen.getByText("LuaUI/widgets")).toBeTruthy();
    expect(
      screen.getByText(
        "Switched on for Splinter Faction 0.1, off everywhere else.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    await waitFor(() => expect(switchAdded).toHaveBeenCalled());
    expect(add.mock.calls[0][0].folders).toEqual(["LuaUI/widgets"]);
    expect(switchAdded.mock.calls[0][0].key).toBe("SF");
  });

  it("says when a widget in a subfolder will not load in a game", async () => {
    plan.mockResolvedValue({
      files: ["Pack/gui_radar.lua"],
      widgets: [
        {
          path: "Pack/gui_radar.lua",
          name: "Radar",
          nested: true,
          error: null,
        },
      ],
      rml: false,
      tooDeep: [],
    });
    openDialog.mockResolvedValue("/downloads/pack");
    render_();
    await choose("Choose a folder");
    expect(openDialog.mock.calls[0][0].directory).toBe(true);
    expect(
      screen.getByText(
        /widget sits in a subfolder, which these games do not load/,
      ),
    ).toBeTruthy();
  });

  it("asks before replacing, then replaces and keeps the old widget's setting", async () => {
    add.mockResolvedValueOnce({
      kind: "conflicts",
      conflicts: [
        { path: "LuaUI/Widgets/old.lua", name: "Radar", reason: "name" },
      ],
    });
    add.mockResolvedValueOnce(added("/data/widget-backups/1-radar"));
    render_();
    await choose("Choose a file or zip");
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    await screen.findByText("Replace what is already there?");
    expect(screen.getByText("LuaUI/Widgets/old.lua")).toBeTruthy();
    expect(switchAdded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await screen.findByText("Added to LuaUI/Widgets.");
    expect(add.mock.calls[1][0].replace).toBe(true);
    expect(screen.getByText(/widget-backups\/1-radar/)).toBeTruthy();
    // Replacing a widget of the same name keeps the setting it had.
    expect(switchAdded.mock.calls[0][0].names).toEqual([]);
  });

  it("cancels a replace without writing", async () => {
    add.mockResolvedValueOnce({
      kind: "conflicts",
      conflicts: [
        { path: "LuaUI/Widgets/gui_radar.lua", name: null, reason: "path" },
      ],
    });
    render_();
    await choose("Choose a file or zip");
    fireEvent.click(screen.getByRole("button", { name: "Add widget" }));
    await screen.findByText("Replace what is already there?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Replace what is already there?")).toBeNull();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("shows why a pick could not be read", async () => {
    plan.mockRejectedValue(new Error("pick a .lua file, a .zip or a folder"));
    render_();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose a file or zip" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Add widget" })).toBeNull();
  });

  it("says when a file is too deep for any game and offers no add when no widget is left", async () => {
    plan.mockResolvedValue({
      files: ["repo-main/widgets/gui_radar.lua"],
      widgets: [],
      rml: false,
      tooDeep: ["repo-main/widgets/gui_radar.lua"],
    });
    render_();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose a file or zip" }),
    );
    await screen.findByText(/more than one folder down, which no game loads/);
    expect(screen.getByText(/repo-main\/widgets\/gui_radar.lua/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Add widget" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("offers nothing to add for a game whose handler is not recognised", async () => {
    render_({ game: games[2], setKey: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Choose a file or zip" }),
    );
    await screen.findByText("No installed game with a folder for this widget.");
    expect(
      screen
        .getByRole("button", { name: "Add widget" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
