// @vitest-environment happy-dom
/**
 * The edit-in-place route's actions (issue #2635). The write, undo and accept
 * themselves are tested in `inplace.rs`. This is about what the drawer offers
 * and says, with the commands faked.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let status = { backups: 0, created: 0 };
let writeResponse: unknown = null;
const calls: string[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: (_plugin: string, command: string) => async () => {
    calls.push(command);
    if (command === "workshop_in_place_status") return status;
    if (command === "workshop_write_in_place") {
      const outcome = writeResponse as { written: string[] };
      if (outcome.written.length > 0) status = { backups: 1, created: 0 };
      return outcome;
    }
    if (command === "workshop_undo_in_place") {
      status = { backups: 0, created: 0 };
      return { restored: ["units/armcom.lua"], deleted: [] };
    }
    if (command === "workshop_accept_in_place") {
      status = { backups: 0, created: 0 };
      return { kept: ["units/armcom.lua"] };
    }
    throw new Error(`unexpected command ${command}`);
  },
}));

import type { InPlaceDone } from "../../inPlaceProject";
import type { ModProject } from "../../project";
import { InPlaceWrite } from "./InPlaceWrite";

const project: ModProject = {
  id: "p1",
  name: "Dev tweaks",
  gameName: "Dev",
  edits: {
    overrides: { armcom: { metalcost: 2 } },
    clones: {},
    menus: {},
    text: {},
    disabled: [],
  },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  status = { backups: 0, created: 0 };
  writeResponse = null;
  calls.length = 0;
});

function renderWrite(
  p: ModProject | undefined = project,
  onDone: (done: InPlaceDone) => void = vi.fn(),
  reading = false,
) {
  return render(
    <InPlaceWrite
      gameDir="/spring/games/dev.sdd"
      project={p}
      reading={reading}
      onDone={onDone}
    />,
  );
}

describe("the edit-in-place actions", () => {
  it("offers a write and no undo when the game holds no backups", async () => {
    renderWrite();
    await waitFor(() => expect(calls).toContain("workshop_in_place_status"));
    expect(
      screen.getByRole("button", { name: "Write changes into the game" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("offers undo and accept for backups left by an earlier session", async () => {
    status = { backups: 2, created: 0 };
    renderWrite();
    expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByText(/2 files in this game have a change/)).toBeTruthy();
  });

  it("cannot write without field changes", async () => {
    renderWrite({ ...project, edits: { ...project.edits, overrides: {} } });
    const button = screen.getByRole("button", {
      name: "Write changes into the game",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("This project has no field changes to write."),
    ).toBeTruthy();
  });

  /** Issue #2633. A change sent to the mutator route is skipped, so it
   *  neither blocks the write nor goes unmentioned. */
  it("says which changes still need a mutator and writes the rest", async () => {
    renderWrite({
      ...project,
      edits: {
        ...project.edits,
        overrides: { armcom: { metalcost: 2, health: 5 } },
      },
      mutatorOnly: { armcom: ["health"], armpw: ["speed"] },
    });
    expect(screen.getByText(/you still need a mutator for it/)).toBeTruthy();
    expect(screen.getByText("armcom health")).toBeTruthy();
    // A mark with no change under it says nothing.
    expect(screen.queryByText("armpw speed")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Write changes into the game" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("has nothing to write when every change goes to the mutator", () => {
    renderWrite({ ...project, mutatorOnly: { armcom: ["metalcost"] } });
    expect(
      screen
        .getByRole("button", { name: "Write changes into the game" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText(
        "Every field change in this project goes through the mutator route, so there is nothing to write in place.",
      ),
    ).toBeTruthy();
  });

  it("lists every refusal, says nothing was written, and does not ask for a refresh", async () => {
    writeResponse = {
      written: [],
      changed: 0,
      unchanged: 0,
      refused: [
        {
          unit: "armcom",
          field: "health",
          file: "units/armcom.lua",
          kind: "fieldComputed",
          message: "The value is worked out by code.",
          location: {
            start: { line: 12, column: 3, byte: 200 },
            end: { line: 12, column: 9, byte: 206 },
          },
        },
      ],
      notCarried: [],
      carried: [],
    };
    const onWritten = vi.fn();
    renderWrite(project, onWritten);
    fireEvent.click(
      screen.getByRole("button", { name: "Write changes into the game" }),
    );
    expect(await screen.findByText(/Nothing was written/)).toBeTruthy();
    expect(
      screen.getByText(
        "armcom health (units/armcom.lua, line 12): The value is worked out by code.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(onWritten).not.toHaveBeenCalled();
  });

  it("reports what it wrote, offers undo, and asks the caller to refresh", async () => {
    writeResponse = {
      written: ["units/armcom.lua"],
      changed: 1,
      unchanged: 0,
      refused: [],
      notCarried: ["Build menu changes are not written into the game yet."],
      carried: [{ unit: "armcom", field: "metalcost", undoable: true }],
    };
    const onWritten = vi.fn();
    renderWrite(project, onWritten);
    fireEvent.click(
      screen.getByRole("button", { name: "Write changes into the game" }),
    );
    expect(
      await screen.findByText("Wrote 1 change into units/armcom.lua."),
    ).toBeTruthy();
    expect(
      screen.getByText("Build menu changes are not written into the game yet."),
    ).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();
    expect(onWritten).toHaveBeenCalledTimes(1);
    expect(onWritten).toHaveBeenCalledWith({
      kind: "write",
      carried: [{ unit: "armcom", field: "metalcost", undoable: true }],
      changed: true,
    });
  });

  it("tells the caller what the game holds even when every file already held it", async () => {
    writeResponse = {
      written: [],
      changed: 0,
      unchanged: 1,
      refused: [],
      notCarried: [],
      carried: [{ unit: "armcom", field: "metalcost", undoable: false }],
    };
    const onDone = vi.fn();
    renderWrite(project, onDone);
    fireEvent.click(
      screen.getByRole("button", { name: "Write changes into the game" }),
    );
    expect(await screen.findByText(/already hold every change/)).toBeTruthy();
    expect(onDone).toHaveBeenCalledWith({
      kind: "write",
      carried: [{ unit: "armcom", field: "metalcost", undoable: false }],
      changed: false,
    });
  });

  it("holds every action off while the page reads the game again", async () => {
    status = { backups: 1, created: 0 };
    renderWrite(project, vi.fn(), true);
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(undo.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Write changes into the game" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("asks before accepting, since accept deletes the backups, then asks the caller to refresh", async () => {
    status = { backups: 1, created: 0 };
    const onWritten = vi.fn();
    renderWrite(project, onWritten);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(screen.getByText("Keep the changes?")).toBeTruthy();
    expect(calls).not.toContain("workshop_accept_in_place");

    const confirm = screen.getAllByRole("button", { name: "Accept" });
    fireEvent.click(confirm[confirm.length - 1]);
    expect(
      await screen.findByText(
        "Kept the changes to 1 file and deleted the backups.",
      ),
    ).toBeTruthy();
    expect(calls).toContain("workshop_accept_in_place");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull(),
    );
    expect(onWritten).toHaveBeenCalledWith({ kind: "accept", changed: true });
  });

  it("undoes without asking, since the project gets its fields back, then tells the caller", async () => {
    status = { backups: 1, created: 0 };
    const onWritten = vi.fn();
    renderWrite(project, onWritten);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Put 1 file back as it was.")).toBeTruthy();
    expect(onWritten).toHaveBeenCalledWith({ kind: "undo", changed: true });
  });
});
