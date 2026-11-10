// @vitest-environment happy-dom
/**
 * The Skeletons drawer's button for saved models (#5181, moved to the Models
 * page by #5209): it writes the body plans of the saved models into each
 * game's skeleton file.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROOT = "/home/player/.spring";

const disk = new Map<string, string>();
vi.mock("@/blueprint/fileIO", () => ({
  appFileIO: {
    read: async (path: string) => disk.get(path) ?? null,
    write: async (path: string, text: string) => {
      disk.set(path, text);
    },
  },
}));

const saved: { projects: unknown[] } = { projects: [] };
vi.mock("@/lego/projects", () => ({
  useLegoProjects: () => ({
    projects: saved.projects,
    loading: false,
    error: null,
  }),
}));

const { WriteSkeletons } = await import("./WriteSkeletons");

const walker = {
  id: "u1",
  unitName: "fedwalker",
  game: { name: "Test Game 1.0", archive: "test_1", shortname: "TG" },
  skeleton: { plan: "biped", proportions: {} },
  pieces: [
    { id: "p1", name: "hull", bone: "body", role: "base" },
    { id: "p2", name: "plate" },
  ],
};

function press() {
  render(<WriteSkeletons rootPath={ROOT} busy={false} />);
  fireEvent.click(screen.getByText("Write saved models"));
}

afterEach(() => {
  cleanup();
  disk.clear();
  saved.projects = [];
});

describe("WriteSkeletons", () => {
  it("writes the saved models' skeletons into the game's file", async () => {
    saved.projects = [walker];
    press();
    await screen.findByText("Wrote 1 unit to 1 file.");
    const file = disk.get(`${ROOT}/LuaUI/Config/coilbox_skeletons/TG.json`);
    expect(JSON.parse(file ?? "{}")).toMatchObject({
      version: 1,
      units: {
        fedwalker: {
          evidence: "built",
          pieces: { hull: { bone: "body" } },
        },
      },
    });
    // The piece with no bone is not in the file
    expect(
      Object.keys(JSON.parse(file ?? "{}").units.fedwalker.pieces),
    ).toEqual(["hull"]);
    // A second press has nothing new to write.
    fireEvent.click(screen.getByText("Write saved models"));
    await screen.findByText("No skeleton has changed since the last write.");
  });

  it("says so when no saved model has a skeleton", async () => {
    saved.projects = [{ id: "u1", unitName: "plain", pieces: [] }];
    press();
    await screen.findByText("No saved unit has a skeleton.");
    expect(disk.size).toBe(0);
  });

  it("says why a skeleton file was not written when the file there cannot be read", async () => {
    saved.projects = [walker];
    const path = `${ROOT}/LuaUI/Config/coilbox_skeletons/TG.json`;
    disk.set(path, "{ broken");
    press();
    await screen.findByText(/the skeleton file is not JSON/);
    expect(disk.get(path)).toBe("{ broken");
  });
});
