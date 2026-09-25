// @vitest-environment happy-dom
/**
 * The drawer that saves, renames, restores and deletes checkpoints (issue
 * #2657). Exercised against the pure functions in `checkpoints.ts` rather
 * than mocked, so a save-then-restore flow proves the whole round trip the
 * way a person would drive it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Checkpoint,
  checkpointsFor,
  type ProjectCheckpoints,
  removeCheckpoint,
  renameCheckpoint,
  saveCheckpoint,
} from "../../checkpoints";
import { setOverride } from "../../overrides";
import { EMPTY_EDITS, editSlot, type GameEdits } from "../../project";
import { CheckpointsDrawer } from "./CheckpointsDrawer";

const PROJECT_ID = "p1";

function edited(health: number): GameEdits {
  return editSlot(EMPTY_EDITS, "overrides", (o) =>
    setOverride(o, "armcom", "health", health, 3000),
  );
}

function draw(
  initial: ProjectCheckpoints = {},
  onRestoreSpy: (edits: GameEdits) => void = () => {},
) {
  let current = initial;

  const onSave = (name: string, description: string | undefined) => {
    current = saveCheckpoint(
      current,
      PROJECT_ID,
      name,
      description,
      edited(4000),
    );
    rerender();
  };
  const onRestore = (checkpoint: Checkpoint) => onRestoreSpy(checkpoint.edits);
  const onRename = (
    id: string,
    name: string,
    description: string | undefined,
  ) => {
    current = renameCheckpoint(current, PROJECT_ID, id, { name, description });
    rerender();
  };
  const onDelete = (id: string) => {
    current = removeCheckpoint(current, PROJECT_ID, id);
    rerender();
  };

  const view = render(
    <CheckpointsDrawer
      open
      onOpenChange={() => {}}
      checkpoints={checkpointsFor(current, PROJECT_ID)}
      onSave={onSave}
      onRestore={onRestore}
      onRename={onRename}
      onDelete={onDelete}
    />,
  );
  function rerender() {
    view.rerender(
      <CheckpointsDrawer
        open
        onOpenChange={() => {}}
        checkpoints={checkpointsFor(current, PROJECT_ID)}
        onSave={onSave}
        onRestore={onRestore}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );
  }
  return view;
}

afterEach(cleanup);

describe("CheckpointsDrawer", () => {
  it("saves a named checkpoint and lists it", () => {
    draw();
    fireEvent.change(
      screen.getByPlaceholderText("Before the health rebalance"),
      {
        target: { value: "Before the health change" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /Save checkpoint/ }));
    expect(screen.getByText("Before the health change")).toBeTruthy();
    expect(screen.getByText(/1 change/)).toBeTruthy();
  });

  it("refuses to save with a blank name", () => {
    draw();
    expect(
      (
        screen.getByRole("button", {
          name: /Save checkpoint/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("restores a checkpoint's edits through onRestore", () => {
    const restored: GameEdits[] = [];
    const initial = saveCheckpoint(
      {},
      PROJECT_ID,
      "Snapshot",
      undefined,
      edited(5000),
    );
    draw(initial, (edits) => restored.push(edits));
    fireEvent.click(screen.getByRole("button", { name: "Restore Snapshot" }));
    expect(restored).toHaveLength(1);
    expect(restored[0].overrides.armcom?.health).toBe(5000);
  });

  it("renames a manual checkpoint in place", () => {
    const initial = saveCheckpoint(
      {},
      PROJECT_ID,
      "Old name",
      undefined,
      edited(4000),
    );
    draw(initial);
    fireEvent.click(screen.getByText("Old name"));
    const nameBox = screen.getByDisplayValue("Old name");
    fireEvent.change(nameBox, { target: { value: "New name" } });
    fireEvent.blur(nameBox);
    expect(screen.getByText("New name")).toBeTruthy();
  });

  it("does not offer to rename an autosave", () => {
    const initial = saveCheckpoint(
      {},
      PROJECT_ID,
      "Autosave one",
      undefined,
      edited(4000),
    );
    // Simulate the shape an autosave has: same helper, different kind, by
    // mutating the stored entry directly since `checkpoints.ts` has no
    // public "take this as an autosave for a test" seam.
    const autosaved: ProjectCheckpoints = {
      [PROJECT_ID]: initial[PROJECT_ID].map((c) => ({
        ...c,
        kind: "autosave" as const,
      })),
    };
    draw(autosaved);
    // The row's own clickable button, not the "Restore" or "Delete" ones
    // that also happen to name the checkpoint in their aria-label.
    const row = screen
      .getAllByRole("button")
      .find(
        (b) =>
          !b.hasAttribute("aria-label") &&
          /Autosave one/.test(b.textContent ?? ""),
      );
    if (!row) throw new Error("row not found");
    fireEvent.click(row);
    expect(screen.queryByDisplayValue("Autosave one")).toBeNull();
  });

  it("deletes a checkpoint", () => {
    const initial = saveCheckpoint(
      {},
      PROJECT_ID,
      "To delete",
      undefined,
      edited(4000),
    );
    draw(initial);
    fireEvent.click(screen.getByRole("button", { name: "Delete To delete" }));
    expect(screen.queryByText("To delete")).toBeNull();
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });
});
