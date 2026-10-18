import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordExport } from "./exportRecord";
import { addLoadout } from "./loadouts";
import { EMPTY_LOCKED_LIST, setLoadoutLocked } from "./locks";
import { newProject } from "./model";

const write = vi.fn();
const read = vi.fn();
vi.mock("./bindings", () => ({
  legoWriteTextFile: (a: unknown) => write(a),
  legoReadTextFile: (a: unknown) => read(a),
}));

const { writeLockedList } = await import("./lockedListIo");

let n = 0;
const base = newProject({
  id: "p",
  rootPieceId: "root",
  name: "Pawn",
  unitName: "armpw",
  packId: "lego",
  packVersion: "1",
  now: "2026-10-18T00:00:00Z",
});
const open = addLoadout(base, { newId: () => `l${++n}`, name: "Heavy" });
const locked = setLoadoutLocked(open, open.loadouts?.[1].id as string, true);

beforeEach(() => {
  write.mockReset().mockResolvedValue({});
  read.mockReset();
});

const sha = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const EMPTY = EMPTY_LOCKED_LIST;
const OLD = "/games/sf.sdd/luarules/configs/coilbox_locked_units/armpw.lua";
const NEW = "/games/sf.sdd/luarules/configs/coilbox_locked_units/armpw2.lua";
const renamed = { ...locked, unitName: "armpw2" };

describe("writing the locked list", () => {
  it("writes the list into the game folder when something is locked", async () => {
    const done = await writeLockedList("/games/sf.sdd/", locked);
    expect(done.file?.path).toBe(OLD);
    expect(write).toHaveBeenCalledWith({
      path: OLD,
      text: expect.stringContaining('"armpw_heavy"'),
    });
    const text = write.mock.calls[0][0].text as string;
    expect(done.file?.sha256).toBe(await sha(text));
  });

  it("writes nothing when nothing is locked and no list was written before", async () => {
    read.mockRejectedValue(new Error("no such file"));
    const done = await writeLockedList("/games/sf.sdd", open);
    expect(done.file).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("empties a list written earlier once nothing is locked", async () => {
    read.mockResolvedValue({ text: "return {}" });
    const done = await writeLockedList("/games/sf.sdd", open);
    expect(done.file?.path).toContain("armpw.lua");
    expect(write).toHaveBeenCalledWith({
      path: done.file?.path,
      text: expect.stringContaining("return {\n}"),
    });
  });

  it("passes on a write that fails", async () => {
    write.mockRejectedValue(new Error("read only"));
    await expect(writeLockedList("/games/sf.sdd", locked)).rejects.toThrow(
      "read only",
    );
  });
});

describe("renaming the chassis", () => {
  async function firstExport() {
    const done = await writeLockedList("/games/sf.sdd", locked);
    const text = write.mock.calls[0][0].text as string;
    write.mockClear();
    return { file: done.file as NonNullable<typeof done.file>, text };
  }

  it("is recorded in the receipt for the folder", async () => {
    const { file } = await firstExport();
    const record = recordExport(
      locked,
      { dir: "/games/sf.sdd", at: "t1", unitName: "armpw", def: {} },
      [file],
    );
    expect(record.exported.files.map((f) => f.path)).toContain(OLD);
  });

  it("empties the old list when the receipt proves coilbox wrote it", async () => {
    const { file, text } = await firstExport();
    read.mockResolvedValue({ text });
    const done = await writeLockedList("/games/sf.sdd", renamed, [file]);
    expect(done.file?.path).toBe(NEW);
    expect(done.emptied).toEqual([OLD]);
    expect(done.kept).toEqual([]);
    expect(write).toHaveBeenCalledWith({ path: OLD, text: EMPTY });
    expect(write).toHaveBeenCalledWith({
      path: NEW,
      text: expect.stringContaining('"armpw2_heavy"'),
    });
  });

  it("leaves an old list somebody edited, and says so", async () => {
    const { file } = await firstExport();
    read.mockResolvedValue({ text: "return { 'mine' }" });
    const done = await writeLockedList("/games/sf.sdd", renamed, [file]);
    expect(done.emptied).toEqual([]);
    expect(done.kept).toEqual([OLD]);
    expect(write).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: OLD }),
    );
  });

  it("says nothing when the old list is already empty or gone", async () => {
    const { file } = await firstExport();
    read.mockResolvedValue({ text: EMPTY });
    let done = await writeLockedList("/games/sf.sdd", renamed, [file]);
    expect(done.emptied).toEqual([]);
    expect(done.kept).toEqual([]);
    read.mockRejectedValue(new Error("no such file"));
    done = await writeLockedList("/games/sf.sdd", renamed, [file]);
    expect(done.emptied).toEqual([]);
    expect(done.kept).toEqual([]);
  });

  it("touches nothing when the name is the same", async () => {
    const { file, text } = await firstExport();
    read.mockResolvedValue({ text });
    const done = await writeLockedList("/games/sf.sdd", locked, [file]);
    expect(done.emptied).toEqual([]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("ignores receipt files that are not locked lists", async () => {
    const done = await writeLockedList("/games/sf.sdd", renamed, [
      { path: "/games/sf.sdd/units/armpw.lua", sha256: "x" },
    ]);
    expect(done.emptied).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
