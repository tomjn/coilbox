import { describe, expect, it } from "vitest";
import { barFormat } from "./bar";
import { type BlueprintFileIO, mergeIntoGameFile } from "./gameFile";
import type { BaseBlueprint } from "./model";

const LAYOUT: BaseBlueprint = {
  id: "l1",
  name: "Opening solars",
  buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
};

const PATH = "/games/bar/LuaUI/Config/blueprints.json";
const NOW = new Date(Date.UTC(2026, 7, 13, 9, 5, 30));

/** A filesystem in a map, so the order of reads and writes is checkable. */
function fakeIO(files: Record<string, string> = {}) {
  const written: string[] = [];
  const io: BlueprintFileIO = {
    read: async (path) => files[path] ?? null,
    write: async (path, text) => {
      written.push(path);
      files[path] = text;
    },
  };
  return { io, files, written };
}

const request = (io: BlueprintFileIO, patch = {}) => ({
  io,
  format: barFormat,
  path: PATH,
  layouts: [LAYOUT],
  gameRunning: false,
  now: NOW,
  ...patch,
});

describe("mergeIntoGameFile", () => {
  it("refuses while a game is running, and writes nothing at all", async () => {
    const { io, written } = fakeIO({ [PATH]: '{"savedBlueprints":[]}' });
    await expect(
      mergeIntoGameFile(request(io, { gameRunning: true })),
    ).rejects.toThrow(/game is running/i);
    expect(written).toEqual([]);
  });

  it("writes the file the game has not got, with nothing to back up", async () => {
    const { io, files, written } = fakeIO();
    const done = await mergeIntoGameFile(request(io));
    expect(written).toEqual([PATH]);
    expect(done.backup).toBeUndefined();
    expect(done.added).toEqual(["Opening solars"]);
    expect(JSON.parse(files[PATH]).savedBlueprints).toHaveLength(1);
  });

  it("copies the file it is about to change before it changes it", async () => {
    const before = '{"savedBlueprints":[{"name":"Mine","units":[]}]}';
    const { io, files, written } = fakeIO({ [PATH]: before });
    const done = await mergeIntoGameFile(request(io));

    expect(done.backup).toBe(`${PATH}.20260813-090530.bak`);
    // The copy is written first, so a failure part way through never leaves the
    // player with neither their file nor a copy of it.
    expect(written).toEqual([done.backup, PATH]);
    expect(files[done.backup as string]).toBe(before);
  });

  it("leaves the file alone when the copy of it could not be written", async () => {
    const { io, files } = fakeIO({ [PATH]: '{"savedBlueprints":[]}' });
    const failing: BlueprintFileIO = {
      read: io.read,
      write: async (path, text) => {
        if (path.endsWith(".bak")) throw new Error("disk full");
        return io.write(path, text);
      },
    };
    await expect(mergeIntoGameFile(request(failing))).rejects.toThrow(
      /disk full/,
    );
    expect(files[PATH]).toBe('{"savedBlueprints":[]}');
  });

  it("leaves a file it cannot read alone rather than replacing it", async () => {
    const { io, files, written } = fakeIO({ [PATH]: "half a file {" });
    await expect(mergeIntoGameFile(request(io))).rejects.toThrow(
      /could not be read/i,
    );
    expect(written).toEqual([]);
    expect(files[PATH]).toBe("half a file {");
  });

  it("says what it replaced and what it carried through", async () => {
    const before = JSON.stringify({
      savedBlueprints: [
        { name: "Opening solars", units: [] },
        { name: "Something new", shape: "arc" },
      ],
    });
    const { io } = fakeIO({ [PATH]: before });
    const done = await mergeIntoGameFile(request(io));
    expect(done.replaced).toEqual(["Opening solars"]);
    expect(done.added).toEqual([]);
    // The arc entry is one coilbox cannot read, and it is still in the file.
    expect(done.kept).toBe(1);
  });
});
