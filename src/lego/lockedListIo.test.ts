import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLoadout } from "./loadouts";
import { setLoadoutLocked } from "./locks";
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

describe("writing the locked list", () => {
  it("writes the list into the game folder when something is locked", async () => {
    const path = await writeLockedList("/games/sf.sdd/", locked);
    expect(path).toBe(
      "/games/sf.sdd/luarules/configs/coilbox_locked_units/armpw.lua",
    );
    expect(write).toHaveBeenCalledWith({
      path,
      text: expect.stringContaining('"armpw_heavy"'),
    });
  });

  it("writes nothing when nothing is locked and no list was written before", async () => {
    read.mockRejectedValue(new Error("no such file"));
    expect(await writeLockedList("/games/sf.sdd", open)).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("empties a list written earlier once nothing is locked", async () => {
    read.mockResolvedValue({ text: "return {}" });
    const path = await writeLockedList("/games/sf.sdd", open);
    expect(path).toContain("armpw.lua");
    expect(write).toHaveBeenCalledWith({
      path,
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
