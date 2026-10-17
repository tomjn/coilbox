import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  legoDelete: vi.fn().mockResolvedValue(undefined),
  legoList: vi.fn().mockResolvedValue({ projects: [], compounds: [] }),
  legoPictureSave: vi.fn(),
  legoSave: vi.fn().mockResolvedValue(undefined),
  legoThumbSave: vi.fn(),
}));

import { legoDelete, legoSave } from "./bindings";
import { newProject } from "./model";
import { deleteCompound, saveCompound } from "./projects";

const builtIn = {
  ...newProject({
    id: "builtin.wheel",
    rootPieceId: "w",
    name: "Wheel",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00.000Z",
  }),
  category: "Wheel",
};

beforeEach(() => {
  vi.mocked(legoSave).mockClear();
  vi.mocked(legoDelete).mockClear();
});

describe("built in modules in the store", () => {
  it("saves a change to a built in module as the user's own copy", async () => {
    const saved = await saveCompound({ ...builtIn, tags: ["mine"] });
    expect(saved.id).not.toBe("builtin.wheel");
    expect(saved.name).toBe("Wheel copy");
    expect(saved.tags).toEqual(["mine"]);
    const call = vi.mocked(legoSave).mock.calls[0]?.[0];
    expect(call?.kind).toBe("compound");
    expect(call?.id).toBe(saved.id);
  });

  it("saves the user's own module under its own id", async () => {
    const saved = await saveCompound({ ...builtIn, id: "mine" });
    expect(saved.id).toBe("mine");
    expect(saved.name).toBe("Wheel");
  });

  it("refuses to delete a built in module", async () => {
    await expect(deleteCompound("builtin.wheel")).rejects.toThrow(
      "cannot be deleted",
    );
    expect(legoDelete).not.toHaveBeenCalled();
  });
});
