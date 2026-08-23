import { describe, expect, it } from "vitest";
import type { BlueprintFileIO } from "./gameFile";
import type { StoredBlueprint } from "./library";
import { collectSpool, exportWidgetLibrary } from "./widgetSync";

const record = (id: string, name: string): StoredBlueprint => ({
  id,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: { name, buildings: [], footprints: {} },
});

function fakeFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: { path: string; text: string }[] = [];
  const io: BlueprintFileIO = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, text) => {
      writes.push({ path, text });
      files.set(path, text);
    },
  };
  return { io, files, writes };
}

describe("exporting the library for the widget", () => {
  it("writes the library file under the content root", async () => {
    const { io, writes } = fakeFiles();
    const path = await exportWidgetLibrary(io, "/data/coilbox", [
      record("a", "Eco"),
    ]);
    expect(path).toBe("/data/coilbox/LuaUI/Config/coilbox_blueprints.json");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].text).blueprints[0].id).toBe("a");
  });

  it("spells the path the way the root does", async () => {
    const { io, writes } = fakeFiles();
    await exportWidgetLibrary(io, "C:\\Games\\coilbox\\", []);
    expect(writes[0].path).toBe(
      "C:\\Games\\coilbox\\LuaUI\\Config\\coilbox_blueprints.json",
    );
  });

  it("does not write when the text is what is already there", async () => {
    const { io, writes } = fakeFiles();
    await exportWidgetLibrary(io, "/data", [record("a", "Eco")]);
    await exportWidgetLibrary(io, "/data", [record("a", "Eco")]);
    expect(writes).toHaveLength(1);
  });
});

describe("collecting what the widget saved", () => {
  const spool = JSON.stringify({
    version: 1,
    blueprints: [
      {
        name: "Base on Map 1",
        recordedAt: 100,
        buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
        footprints: {},
      },
      { name: "bad" },
    ],
  });
  const spoolPath = "/engines/2025.04.08/LuaUI/Config/coilbox_blueprints_spool.json";

  it("imports every readable entry, then empties the spool", async () => {
    const { io, files } = fakeFiles({ [spoolPath]: spool });
    const saved: StoredBlueprint[][] = [];
    const result = await collectSpool({
      io,
      engineDir: "/engines/2025.04.08",
      engineName: "2025.04.08",
      gameRunning: false,
      save: async (records) => {
        saved.push(records);
      },
    });
    expect(result).toEqual({ collected: 1, skipped: 1 });
    expect(saved).toHaveLength(1);
    expect(saved[0][0].layout.name).toBe("Base on Map 1");
    expect(saved[0][0].source).toMatchObject({
      kind: "widget",
      engine: "2025.04.08",
    });
    expect(JSON.parse(files.get(spoolPath) ?? "")).toEqual({
      version: 1,
      blueprints: [],
    });
  });

  it("leaves the spool alone while a game is running", async () => {
    const { io, writes } = fakeFiles({ [spoolPath]: spool });
    const result = await collectSpool({
      io,
      engineDir: "/engines/2025.04.08",
      engineName: "2025.04.08",
      gameRunning: true,
      save: async () => {},
    });
    expect(result).toEqual({ collected: 0, skipped: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does nothing and writes nothing when there is no spool", async () => {
    const { io, writes } = fakeFiles();
    const result = await collectSpool({
      io,
      engineDir: "/engines/2025.04.08",
      engineName: "2025.04.08",
      gameRunning: false,
      save: async () => {},
    });
    expect(result).toEqual({ collected: 0, skipped: 0 });
    expect(writes).toHaveLength(0);
  });

  it("does not empty a spool it could not read", async () => {
    const { io, writes } = fakeFiles({ [spoolPath]: "{ nope" });
    await expect(
      collectSpool({
        io,
        engineDir: "/engines/2025.04.08",
        engineName: "2025.04.08",
        gameRunning: false,
        save: async () => {},
      }),
    ).rejects.toThrow(/not JSON/);
    expect(writes).toHaveLength(0);
  });

  it("does not empty a spool whose entries it failed to save", async () => {
    const { io, writes } = fakeFiles({ [spoolPath]: spool });
    await expect(
      collectSpool({
        io,
        engineDir: "/engines/2025.04.08",
        engineName: "2025.04.08",
        gameRunning: false,
        save: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(writes).toHaveLength(0);
  });

  it("empties a spool holding only unreadable entries, since nothing in it can be kept", async () => {
    const { io, files } = fakeFiles({
      [spoolPath]: JSON.stringify({ version: 1, blueprints: [{ name: "bad" }] }),
    });
    const result = await collectSpool({
      io,
      engineDir: "/engines/2025.04.08",
      engineName: undefined,
      gameRunning: false,
      save: async () => {},
    });
    expect(result).toEqual({ collected: 0, skipped: 1 });
    expect(JSON.parse(files.get(spoolPath) ?? "").blueprints).toEqual([]);
  });
});
