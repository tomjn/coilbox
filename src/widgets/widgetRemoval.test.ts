/**
 * Removing a widget (issue #1288): which files and games a removal covers, the
 * entries it takes out of a game's config files, and the rules those writes
 * follow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import type { WidgetHandler } from "./handlers";
import { returnedTable } from "./widgetConfig";
import type { GameHandler, WidgetRow } from "./widgetList";

const files = new Map<string, string>();
const deleted: { files: string[]; folders: string[]; label: string | null }[] =
  [];

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
    contentWidgetDelete: async (args: {
      files: string[];
      folders: string[];
      label: string | null;
    }) => {
      deleted.push(args);
      return { files: args.files, backup: "/data/widget-backups/1-radar" };
    },
  };
});

const {
  dropEntries,
  entryNames,
  nameOf,
  planEntryRemoval,
  entryTargets,
  removalFor,
  removeEntries,
  removeWidget,
} = await import("./widgetRemoval");
const { readSets, resetSets, updateSets } = await import("./widgetSets");

const nested: WidgetHandler = {
  id: "engine",
  family: "engine",
  folders: ["LuaUI/Widgets"],
  subfolders: true,
  config: { files: ["{short}.lua"], shape: "nested" },
};
const flat: WidgetHandler = {
  id: "ca",
  family: "ca",
  folders: ["LuaUI/Widgets_TAP"],
  subfolders: false,
  config: {
    files: ["{SHORT}_order.lua"],
    shape: "flat",
    dataFiles: ["{SHORT}_data.lua"],
  },
};
const games: GameHandler[] = [
  { game: "Metal Factions v2.58", shortName: "mf", handler: nested },
  { game: "Total Annihilation Prime", shortName: "tap", handler: flat },
  { game: "Mystery 1.0", handler: null },
];

function row(
  path: string,
  name: string | null,
  loadedBy: string[],
  options: { folder?: string; nested?: boolean; previous?: string[] } = {},
): WidgetRow {
  const folder = options.folder ?? "LuaUI/Widgets";
  return {
    path,
    folder,
    nested: options.nested ?? false,
    coilbox: false,
    givesOrders: false,
    info: name
      ? { name, ...(options.previous && { previousNames: options.previous }) }
      : null,
    error: name ? null : "broken",
    loadedBy,
    switch: name
      ? { kind: "ready", name, previousNames: options.previous ?? [] }
      : { kind: "none", reason: "error", error: "broken" },
  };
}

const MF = "Metal Factions v2.58";
const TAP = "Total Annihilation Prime";
const radar = row("LuaUI/Widgets/radar.lua", "Radar", [MF], {
  previous: ["Old Radar"],
});
const radarTap = row("LuaUI/Widgets_TAP/radar.lua", "Radar", [TAP], {
  folder: "LuaUI/Widgets_TAP",
});
const minimap = row("LuaUI/Widgets/minimap.lua", "Minimap", [MF]);

describe("removalFor", () => {
  it("takes the copy in every folder the widget was added to", () => {
    const rows = [radar, radarTap, minimap];
    const removal = removalFor(rows, radar);
    expect(removal.copies).toEqual([radar, radarTap]);
    expect(removal.games).toEqual([MF, TAP]);
    expect(removal.name).toBe("Radar");
    expect(removal.previousNames).toEqual(["Old Radar"]);
    expect(removalFor(rows, radarTap).copies).toEqual([radarTap, radar]);
  });

  it("does not take a widget with another name, or another path, as a copy", () => {
    const other = row("LuaUI/Widgets_TAP/radar_v2.lua", "Radar", [TAP], {
      folder: "LuaUI/Widgets_TAP",
    });
    const removal = removalFor([radar, other, minimap], radar);
    expect(removal.copies).toEqual([radar]);
  });

  it("removes a file that did not run on its own", () => {
    const broken = row("LuaUI/Widgets/broken.lua", null, [MF]);
    const removal = removalFor([broken, radar], broken);
    expect(removal.copies).toEqual([broken]);
    expect(removal.name).toBeNull();
    expect(entryNames(removal, [broken, radar], MF)).toEqual([]);
  });

  it("takes a subfolder with its widget unless another widget is in it", () => {
    const a = row("LuaUI/Widgets/Pack/a.lua", "A", [MF], { nested: true });
    const b = row("LuaUI/Widgets/Pack/b.lua", "B", [MF], { nested: true });
    expect(removalFor([a, b], a).folders).toEqual([]);
    expect(removalFor([a], a).folders).toEqual(["LuaUI/Widgets/Pack"]);
    expect(removalFor([radar], radar).folders).toEqual([]);
  });
});

describe("entryNames", () => {
  it("names the widget and its previous names, not one another widget keeps", () => {
    const removal = removalFor([radar, radarTap], radar);
    expect(entryNames(removal, [radar, radarTap], MF)).toEqual([
      "Radar",
      "Old Radar",
    ]);
    const keeper = row("LuaUI/Widgets/old.lua", "Old Radar", [MF]);
    expect(entryNames(removal, [radar, radarTap, keeper], MF)).toEqual([
      "Radar",
    ]);
  });

  it("keeps a name a staying widget reads its state from as a previous name", () => {
    const removal = removalFor([radar, radarTap], radar);
    const renamed = row("LuaUI/Widgets/radar_new.lua", "Radar Mk2", [MF], {
      previous: ["Radar"],
    });
    expect(entryNames(removal, [radar, radarTap, renamed], MF)).toEqual([
      "Old Radar",
    ]);
  });
});

const nestedFile = [
  "return {",
  "\tdata = {",
  '\t\t["Radar"] = {',
  "\t\t\trange = 10,",
  "\t\t},",
  '\t\t["Other"] = {',
  "\t\t\tx = 1,",
  "\t\t},",
  "\t},",
  "\torder = {",
  '\t\t["Radar"] = 1,',
  '\t\t["Other"] = 2,',
  "\t},",
  "}",
  "",
].join("\n");

describe("dropEntries", () => {
  it("takes the order entry out and nothing else", () => {
    const out = dropEntries(nestedFile, nested.config, "order", ["Radar"]);
    expect(out.removed).toEqual(["Radar"]);
    expect(out.text).toBe(nestedFile.replace('\t\t["Radar"] = 1,\n', ""));
  });

  it("takes the saved settings out of the data table", () => {
    const out = dropEntries(nestedFile, nested.config, "data", ["Radar"]);
    expect(out.removed).toEqual(["Radar"]);
    expect(out.text).toBe(
      nestedFile.replace('\t\t["Radar"] = {\n\t\t\trange = 10,\n\t\t},\n', ""),
    );
  });

  it("leaves the file alone when it holds no entry", () => {
    const out = dropEntries(nestedFile, nested.config, "order", ["Gone"]);
    expect(out.text).toBe(nestedFile);
    expect(out.removed).toEqual([]);
  });

  it("removes entries on one line and leaves a table that still reads", () => {
    const src = "return { order = { A = 1, B = 2, C = 3 } }";
    const out = dropEntries(src, nested.config, "order", ["A", "C"]);
    expect(out.text).toBe("return { order = { B = 2, } }");
    expect(() => returnedTable(out.text)).not.toThrow();
  });

  it("removes every copy of a repeated key", () => {
    const src = "return { order = { A = 1, B = 2, A = 3 } }";
    const out = dropEntries(src, nested.config, "order", ["A"]);
    expect(out.text).toBe("return { order = { B = 2, } }");
  });

  it("never takes the version of a flat file for a widget", () => {
    const src = 'return {\n\t["version"] = 1,\n\t["Radar"] = 1,\n}\n';
    const out = dropEntries(src, flat.config, "order", ["Radar", "version"]);
    expect(out.text).toBe('return {\n\t["version"] = 1,\n}\n');
    expect(out.removed).toEqual(["Radar"]);
  });

  it("refuses a file that is not a table the handler wrote", () => {
    expect(() =>
      dropEntries("return {", nested.config, "order", ["Radar"]),
    ).toThrow();
    expect(() =>
      dropEntries("return { order = 3 }", nested.config, "order", ["Radar"]),
    ).toThrow();
  });
});

const MF_FILE = "/spring/LuaUI/Config/mf.lua";
const TAP_ORDER = "/spring/LuaUI/Config/TAP_order.lua";
const TAP_DATA = "/spring/LuaUI/Config/TAP_data.lua";
const tapOrder = 'return {\n\t["version"] = 1,\n\t["Radar"] = 1,\n}\n';
const tapData =
  'return {\n\t["version"] = 1,\n\t["Radar"] = {\n\t\tx = 1,\n\t},\n}\n';

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  resetSets();
  files.clear();
  deleted.length = 0;
  files.set(MF_FILE, nestedFile);
  files.set(TAP_ORDER, tapOrder);
  files.set(TAP_DATA, tapData);
});

const io = {
  read: async (path: string) => files.get(path) ?? null,
  write: async (path: string, text: string) => {
    files.set(path, text);
  },
};
const rows = [radar, radarTap, minimap];
const targets = () => entryTargets(removalFor(rows, radar), rows, games);

describe("planEntryRemoval", () => {
  it("finds a game's order and data files, and writes nothing", async () => {
    const plan = await planEntryRemoval(io, "/spring", targets());
    expect(plan.failed).toEqual([]);
    expect(plan.files.map((f) => f.path).sort()).toEqual(
      [MF_FILE, TAP_DATA, TAP_ORDER].sort(),
    );
    expect(files.get(MF_FILE)).toBe(nestedFile);
    const mf = plan.files.find((f) => f.path === MF_FILE);
    expect(mf?.games).toEqual([MF]);
    expect(mf?.names).toEqual(["Radar"]);
  });

  it("plans nothing for a game that holds no entry or has no file yet", async () => {
    files.delete(TAP_ORDER);
    files.delete(TAP_DATA);
    files.set(MF_FILE, "return {\n\torder = {},\n}\n");
    const plan = await planEntryRemoval(io, "/spring", targets());
    expect(plan).toEqual({ files: [], failed: [] });
  });

  it("applies a file two games share one after the other", async () => {
    const shared: GameHandler[] = [
      { game: MF, shortName: "mf", handler: nested },
      { game: "Sibling 1.0", shortName: "mf", handler: nested },
    ];
    const both = [
      row("LuaUI/Widgets/radar.lua", "Radar", [MF, "Sibling 1.0"], {
        previous: ["Other"],
      }),
    ];
    const plan = await planEntryRemoval(
      io,
      "/spring",
      entryTargets(removalFor(both, both[0]), both, shared),
    );
    expect(plan.files).toHaveLength(1);
    // The first game's pass took everything out, so the second adds nothing.
    expect(plan.files[0].games).toEqual([MF]);
    expect(plan.files[0].names).toEqual(["Radar", "Other"]);
    expect(plan.files[0].before).toBe(nestedFile);
    expect(plan.files[0].after).not.toContain("Radar");
    expect(plan.files[0].after).not.toContain("Other");
  });
});

describe("removeEntries", () => {
  const now = new Date(2026, 9, 30, 12, 0, 0);

  it("copies each file before it writes it", async () => {
    const out = await removeEntries({
      io,
      writeDir: "/spring",
      targets: targets(),
      gameRunning: false,
      now,
    });
    expect(out.failed).toEqual([]);
    expect(out.backups).toHaveLength(3);
    expect(files.get(MF_FILE)).not.toContain("Radar");
    expect(files.get(TAP_ORDER)).toBe('return {\n\t["version"] = 1,\n}\n');
    expect(files.get(TAP_DATA)).toBe('return {\n\t["version"] = 1,\n}\n');
    const backup = out.backups.find((b) => b.startsWith(MF_FILE));
    expect(files.get(backup ?? "")).toBe(nestedFile);
  });

  it("refuses while a game is running and writes nothing", async () => {
    await expect(
      removeEntries({
        io,
        writeDir: "/spring",
        targets: targets(),
        gameRunning: true,
        now,
      }),
    ).rejects.toThrow(/A game is running/);
    expect(files.get(MF_FILE)).toBe(nestedFile);
    expect([...files.keys()]).toHaveLength(3);
  });

  it("never writes over a file it could not read, and still does the others", async () => {
    files.set(MF_FILE, "return {");
    const out = await removeEntries({
      io,
      writeDir: "/spring",
      targets: targets(),
      gameRunning: false,
      now,
    });
    expect(files.get(MF_FILE)).toBe("return {");
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toContain(MF);
    expect(files.get(TAP_ORDER)).toBe('return {\n\t["version"] = 1,\n}\n');
  });
});

describe("removeWidget", () => {
  const request = {
    io,
    writeDir: "/spring",
    rows,
    games,
    gameRunning: false,
  };

  it("deletes the copies, and forgets the widget in the sets", async () => {
    updateSets((s) => ({
      ...s,
      global: { Radar: true, Minimap: true },
      overrides: { mf: { Radar: false } },
      written: { [MF_FILE]: { Radar: true, Minimap: true } },
    }));
    const out = await removeWidget({
      ...request,
      removal: removalFor(rows, radar),
      entries: false,
    });
    expect(deleted).toEqual([
      {
        writeDir: "/spring",
        files: ["LuaUI/Widgets/radar.lua", "LuaUI/Widgets_TAP/radar.lua"],
        folders: [],
        label: "Radar",
      },
    ]);
    expect(out.backup).toBe("/data/widget-backups/1-radar");
    expect(out.entries).toBeNull();
    expect(out.forgotten).toEqual(["Radar"]);
    expect(readSets()).toEqual({
      global: { Minimap: true },
      overrides: { mf: {} },
      written: { [MF_FILE]: { Minimap: true } },
    });
    // The config files are left as they were.
    expect(files.get(MF_FILE)).toBe(nestedFile);
  });

  it("also takes the entries out of the config files when asked", async () => {
    const out = await removeWidget({
      ...request,
      removal: removalFor(rows, radar),
      entries: true,
    });
    expect(out.entries?.files).toHaveLength(3);
    expect(files.get(MF_FILE)).not.toContain("Radar");
  });

  it("keeps a name another widget still uses in the sets", async () => {
    const twin = row("LuaUI/Widgets/radar2.lua", "Radar", [MF]);
    updateSets((s) => ({ ...s, global: { Radar: true } }));
    await removeWidget({
      ...request,
      rows: [radar, twin],
      removal: removalFor([radar, twin], radar),
      entries: false,
    });
    expect(readSets().global).toEqual({ Radar: true });
  });

  it("refuses while a game is running, before anything is deleted", async () => {
    await expect(
      removeWidget({
        ...request,
        gameRunning: true,
        removal: removalFor(rows, radar),
        entries: true,
      }),
    ).rejects.toThrow(/A game is running/);
    expect(deleted).toEqual([]);
  });

  it("says a config file could not be written without undoing the removal", async () => {
    files.set(MF_FILE, "return {");
    const out = await removeWidget({
      ...request,
      removal: removalFor(rows, radar),
      entries: true,
    });
    expect(deleted).toHaveLength(1);
    expect(out.entries?.failed[0]).toContain(MF);
  });
});

describe("nameOf", () => {
  it("is the declared name, the file name without one, and null for a file that did not run", () => {
    expect(nameOf(radar)).toBe("Radar");
    expect(
      nameOf({ ...radar, info: { name: undefined } } as unknown as WidgetRow),
    ).toBe("radar.lua");
    expect(nameOf(row("LuaUI/Widgets/x.lua", null, []))).toBeNull();
  });
});
