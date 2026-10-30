import { describe, expect, it } from "vitest";
import type { PlannedWidget, WidgetPlan } from "@/content/bindings";
import { destinationsFor, namesToSwitch, nestedWarning } from "./addWidget";
import type { WidgetHandler } from "./handlers";
import type { GameHandler } from "./widgetList";

const config = { files: ["{short}.lua"], shape: "nested" } as const;

const upper: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: false,
  config,
};
const lower: WidgetHandler = { ...upper, id: "sf", folders: ["LuaUI/widgets"] };
const bar: WidgetHandler = {
  id: "bar",
  family: "ba",
  folders: ["LuaUI/Widgets", "LuaUI/RmlWidgets"],
  subfolders: true,
  config,
};

const games: GameHandler[] = [
  { game: "Metal Factions", handler: upper },
  { game: "Splinter Faction", handler: lower },
  { game: "Beyond All Reason", handler: bar },
  { game: "Mystery", handler: null },
];

const widget = (path: string, name: string | null = "W"): PlannedWidget => ({
  path,
  name,
  nested: path.includes("/"),
  error: null,
});

const planOf = (...widgets: PlannedWidget[]): WidgetPlan => ({
  files: widgets.map((w) => w.path),
  widgets,
  rml: false,
});

describe("destinationsFor", () => {
  it("lists one folder where case folds, and each spelling where it does not", () => {
    const folding = destinationsFor(games, {
      rml: false,
      caseSensitive: false,
    });
    expect(folding.destinations).toEqual([
      {
        folder: "LuaUI/Widgets",
        games: ["Metal Factions", "Splinter Faction", "Beyond All Reason"],
      },
    ]);
    const telling = destinationsFor(games, { rml: false, caseSensitive: true });
    expect(telling.destinations).toEqual([
      {
        folder: "LuaUI/Widgets",
        games: ["Metal Factions", "Beyond All Reason"],
      },
      { folder: "LuaUI/widgets", games: ["Splinter Faction"] },
    ]);
  });

  it("leaves out a game whose handler is not recognised, and says so", () => {
    const got = destinationsFor(games, { rml: false, caseSensitive: false });
    expect(got.skipped).toEqual([
      { game: "Mystery", reason: "unknown-handler" },
    ]);
  });

  it("sends an RmlUi widget to the folder a game reads those from, and skips the rest", () => {
    const got = destinationsFor(games, { rml: true, caseSensitive: false });
    expect(got.destinations).toEqual([
      { folder: "LuaUI/RmlWidgets", games: ["Beyond All Reason"] },
    ]);
    expect(got.skipped.map((s) => [s.game, s.reason])).toEqual([
      ["Metal Factions", "no-rml-folder"],
      ["Splinter Faction", "no-rml-folder"],
      ["Mystery", "unknown-handler"],
    ]);
  });

  it("sends a plain widget to a game's widget folder rather than its RmlUi one", () => {
    const got = destinationsFor([games[2]], {
      rml: false,
      caseSensitive: true,
    });
    expect(got.destinations).toEqual([
      { folder: "LuaUI/Widgets", games: ["Beyond All Reason"] },
    ]);
  });

  it("goes only where the picked game reads", () => {
    const got = destinationsFor(games, {
      rml: false,
      caseSensitive: true,
      only: "Splinter Faction",
    });
    expect(got.destinations).toEqual([
      { folder: "LuaUI/widgets", games: ["Splinter Faction"] },
    ]);
    expect(got.skipped).toEqual([]);
  });
});

describe("nestedWarning", () => {
  const all = destinationsFor(games, { rml: false, caseSensitive: false });

  it("names the games that get a copy and will not load a widget in a subfolder", () => {
    expect(
      nestedWarning(planOf(widget("Pack/gui.lua")), games, all.destinations),
    ).toEqual({
      widgets: [widget("Pack/gui.lua")],
      games: ["Metal Factions", "Splinter Faction"],
    });
  });

  it("says nothing when every widget is at the top", () => {
    expect(
      nestedWarning(planOf(widget("gui.lua")), games, all.destinations),
    ).toBeNull();
  });

  it("says nothing when every game loads subfolders", () => {
    const only = destinationsFor(games, {
      rml: false,
      caseSensitive: false,
      only: "Beyond All Reason",
    });
    expect(
      nestedWarning(planOf(widget("Pack/gui.lua")), games, only.destinations),
    ).toBeNull();
  });
});

describe("namesToSwitch", () => {
  it("leaves out a file with no name and a widget that replaced one", () => {
    expect(
      namesToSwitch(
        [widget("a.lua", "A"), widget("b.lua", null), widget("c.lua", "C")],
        ["C"],
      ),
    ).toEqual(["A"]);
  });
});
