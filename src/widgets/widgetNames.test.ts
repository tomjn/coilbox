import { describe, expect, it } from "vitest";
import type { PlayerWidgetFile } from "@/content/bindings";
import type { WidgetHandler } from "./handlers";
import { savedUnder, type WidgetSwitch, widgetNames } from "./widgetNames";

const engine: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: true,
  config: { files: ["{short}.lua"], shape: "nested" },
};
const games = [
  { game: "E", handler: engine },
  {
    game: "C",
    handler: { ...engine, id: "ca", family: "ca" } as WidgetHandler,
  },
];

function file(
  path: string,
  info: PlayerWidgetFile["info"],
  error: string | null = null,
): PlayerWidgetFile {
  return {
    root: "/data",
    caseSensitive: false,
    path,
    folder: "LuaUI/Widgets",
    nested: path.split("/").length > 3,
    coilbox: false,
    givesOrders: false,
    info,
    error,
  };
}

const kinds = (s: WidgetSwitch[]) => s.map((x) => x.kind);

describe("widgetNames", () => {
  it("keys a widget by the name it gives itself, not its file name", () => {
    const f = file("LuaUI/Widgets/gui_build_watch.lua", { name: "BuildWatch" });
    expect(widgetNames([f], [["E"]], games)).toEqual([
      { kind: "ready", name: "BuildWatch", previousNames: [] },
    ]);
  });

  it("falls back to the file name with its extension when it gives none", () => {
    const f = file("LuaUI/Widgets/pack/gui_x.lua", { desc: "no name" });
    expect(widgetNames([f], [["E"]], games)).toEqual([
      { kind: "ready", name: "gui_x.lua", previousNames: [] },
    ]);
  });

  it("gives no switch to a file that failed to run, and says why", () => {
    const f = file("LuaUI/Widgets/bad.lua", null, "syntax error");
    expect(widgetNames([f], [["E"]], games)).toEqual([
      { kind: "none", reason: "error", error: "syntax error" },
    ]);
  });

  it("gives neither of two files with one name a switch", () => {
    const a = file("LuaUI/Widgets/a.lua", { name: "Same" });
    const b = file("LuaUI/Widgets/pack/b.lua", { name: "Same" });
    const c = file("LuaUI/Widgets/c.lua", { name: "Other" });
    expect(widgetNames([a, b, c], [["E"], ["E"], ["E"]], games)).toEqual([
      { kind: "none", reason: "duplicate", name: "Same", others: [b.path] },
      { kind: "none", reason: "duplicate", name: "Same", others: [a.path] },
      { kind: "ready", name: "Other", previousNames: [] },
    ]);
  });

  it("names a file with the same name in another content root by where it is", () => {
    const a = file("LuaUI/Widgets/a.lua", { name: "Same" });
    const b = { ...a, root: "/second" };
    expect(widgetNames([a, b], [["E"], ["E"]], games)).toEqual([
      {
        kind: "none",
        reason: "duplicate",
        name: "Same",
        others: ["/second/LuaUI/Widgets/a.lua"],
      },
      {
        kind: "none",
        reason: "duplicate",
        name: "Same",
        others: [`${a.root}/LuaUI/Widgets/a.lua`],
      },
    ]);
  });

  it("compares names exactly, as the config file's keys are", () => {
    const a = file("LuaUI/Widgets/a.lua", { name: "Same" });
    const b = file("LuaUI/Widgets/b.lua", { name: "same" });
    expect(kinds(widgetNames([a, b], [["E"], ["E"]], games))).toEqual([
      "ready",
      "ready",
    ]);
  });

  it("pairs files only when one game loads both", () => {
    const a = file("LuaUI/Widgets/a.lua", { name: "Same" });
    const b = file("LuaUI/widgets/b.lua", { name: "Same" });
    expect(kinds(widgetNames([a, b], [["E"], ["C"]], games))).toEqual([
      "ready",
      "ready",
    ]);
    expect(kinds(widgetNames([a, b], [["E", "C"], ["C"]], games))).toEqual([
      "none",
      "none",
    ]);
  });

  it("keeps the previous names a widget declares", () => {
    const f = file("LuaUI/Widgets/a.lua", {
      name: "New",
      previousNames: ["Old", "Older"],
    });
    expect(widgetNames([f], [["E"]], games)).toEqual([
      { kind: "ready", name: "New", previousNames: ["Old", "Older"] },
    ]);
  });

  it("gives an experimental widget no switch where a game renames it", () => {
    const f = file("LuaUI/Widgets/a.lua", { name: "A", experimental: true });
    expect(widgetNames([f], [["C"]], games)).toEqual([
      { kind: "none", reason: "experimental", name: "A" },
    ]);
    expect(kinds(widgetNames([f], [["E"]], games))).toEqual(["ready"]);
  });
});

describe("savedUnder", () => {
  const sw = {
    kind: "ready",
    name: "New",
    previousNames: ["Old", "Older"],
  } as const;

  it("reads the new name when it has saved state", () => {
    expect(savedUnder(sw, (n) => n === "New" || n === "Old")).toBe("New");
  });

  it("reads the first previous name with saved state when the new has none", () => {
    expect(savedUnder(sw, (n) => n === "Older" || n === "Old")).toBe("Old");
    expect(savedUnder(sw, (n) => n === "Older")).toBe("Older");
  });

  it("treats a renamed widget as new when none has saved state", () => {
    expect(savedUnder(sw, () => false)).toBeNull();
  });
});
