// @vitest-environment happy-dom
/**
 * The disk diff drawer (issue #2636). The diff algorithm is tested in
 * `diff.rs` and the collapsing in `diskDiff.test.ts`. This is about what the
 * drawer shows and does with the commands faked: the files it lists, the gap
 * it collapses a long unchanged run to, the whole-file addition for a created
 * file, and undo/accept reusing the same confirm popover `InPlaceWrite` uses.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../inPlace";

let diffsResponse: FileDiff[] = [];
const calls: string[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: (_plugin: string, command: string) => async () => {
    calls.push(command);
    if (command === "workshop_in_place_diffs") return diffsResponse;
    if (command === "workshop_undo_in_place") {
      diffsResponse = [];
      return { restored: ["units/armcom.lua"], deleted: [] };
    }
    if (command === "workshop_accept_in_place") {
      diffsResponse = [];
      return { kept: ["units/armcom.lua"] };
    }
    throw new Error(`unexpected command ${command}`);
  },
}));

import type { InPlaceDone } from "../../inPlaceProject";
import { DiskDiffDrawer } from "./DiskDiffDrawer";

afterEach(() => {
  cleanup();
  diffsResponse = [];
  calls.length = 0;
});

function draw(onDone: (done: InPlaceDone) => void = vi.fn(), reading = false) {
  return render(
    <DiskDiffDrawer
      open
      onOpenChange={() => {}}
      gameDir="/spring/games/dev.sdd"
      reading={reading}
      onDone={onDone}
    />,
  );
}

describe("the disk diff drawer", () => {
  it("says there is nothing to review when no file has a change", async () => {
    draw();
    expect(
      await screen.findByText(
        "Nothing to review: no file here holds a change from coilbox.",
      ),
    ).toBeTruthy();
  });

  it("shows a changed line and marks a created file as a new file", async () => {
    diffsResponse = [
      {
        file: "units/armcom.lua",
        created: false,
        lines: [
          { kind: "equal", oldLine: 1, newLine: 1, text: "return {" },
          {
            kind: "removed",
            oldLine: 2,
            newLine: null,
            text: "  metalcost = 1,",
          },
          {
            kind: "added",
            oldLine: null,
            newLine: 2,
            text: "  metalcost = 2,",
          },
          { kind: "equal", oldLine: 3, newLine: 3, text: "}" },
        ],
      },
      {
        file: "units/newunit.lua",
        created: true,
        lines: [
          { kind: "added", oldLine: null, newLine: 1, text: "return {}" },
        ],
      },
    ];
    draw();
    expect(await screen.findByText("units/armcom.lua")).toBeTruthy();
    expect(screen.getByText(/metalcost = 1,/)).toBeTruthy();
    expect(screen.getByText(/metalcost = 2,/)).toBeTruthy();
    expect(screen.getByText("units/newunit.lua")).toBeTruthy();
    expect(screen.getByText("New file")).toBeTruthy();
  });

  it("collapses a long unchanged run to a gap", async () => {
    const context = Array.from({ length: 20 }, (_, n) => ({
      kind: "equal" as const,
      oldLine: n + 2,
      newLine: n + 2,
      text: `line ${n}`,
    }));
    diffsResponse = [
      {
        file: "units/armcom.lua",
        created: false,
        lines: [
          {
            kind: "removed" as const,
            oldLine: 1,
            newLine: null,
            text: "old",
          },
          { kind: "added" as const, oldLine: null, newLine: 1, text: "new" },
          ...context,
        ],
      },
    ];
    draw();
    expect(await screen.findByText(/unchanged lines/)).toBeTruthy();
    expect(screen.queryByText("line 10")).toBeNull();
  });

  it("undoes without asking and refreshes the diff list", async () => {
    diffsResponse = [
      {
        file: "units/armcom.lua",
        created: false,
        lines: [
          { kind: "removed", oldLine: 1, newLine: null, text: "old" },
          { kind: "added", oldLine: null, newLine: 1, text: "new" },
        ],
      },
    ];
    const onDone = vi.fn();
    draw(onDone);
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Put 1 file back as it was.")).toBeTruthy();
    expect(onDone).toHaveBeenCalledWith({ kind: "undo", changed: true });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Nothing to review: no file here holds a change from coilbox.",
        ),
      ).toBeTruthy(),
    );
  });

  it("asks before accepting, since accept deletes the backups", async () => {
    diffsResponse = [
      {
        file: "units/armcom.lua",
        created: false,
        lines: [
          { kind: "removed", oldLine: 1, newLine: null, text: "old" },
          { kind: "added", oldLine: null, newLine: 1, text: "new" },
        ],
      },
    ];
    const onDone = vi.fn();
    draw(onDone);
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
    expect(onDone).toHaveBeenCalledWith({ kind: "accept", changed: true });
  });

  it("holds undo and accept off while the page is reading again", async () => {
    diffsResponse = [
      {
        file: "units/armcom.lua",
        created: false,
        lines: [
          { kind: "removed", oldLine: 1, newLine: null, text: "old" },
          { kind: "added", oldLine: null, newLine: 1, text: "new" },
        ],
      },
    ];
    draw(vi.fn(), true);
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(undo.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
