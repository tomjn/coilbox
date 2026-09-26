// @vitest-environment happy-dom
/**
 * Issue #3175. Bulk edit's "Follow game updates" checkbox: offered for
 * "Change by %" and "Add", ticked by default, absent for "Set to" and for
 * Range, which has no relative write of its own yet.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setOverride } from "../../overrides";
import { EMPTY_EDITS } from "../../project";
import { setRelativeEdit } from "../../relativeEdits";
import { unitReferenceRow } from "../../unitReference";
import { ReferenceBulkEdit, type ReferenceEditing } from "./ReferenceBulkEdit";

afterEach(cleanup);

const units = {
  armpw: { health: 260 },
  armrock: { health: 400 },
};

const rows = [
  unitReferenceRow("armpw", "Peewee", units.armpw, {}),
  unitReferenceRow("armrock", "Rocko", units.armrock, {}),
];

function editingOf(over: Partial<ReferenceEditing> = {}): ReferenceEditing {
  return {
    units,
    overrides: {},
    updateOverrides: () => {},
    applyBatch: vi.fn(),
    draftRow: () => undefined,
    rangePlan: () => ({ rows: [], overrides: {}, library: {}, equipped: {} }),
    applyRange: vi.fn(),
    ...over,
  };
}

const changeValue = () =>
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "10" } });

describe("the follow game updates checkbox", () => {
  it("is offered and ticked by default for Change by %", () => {
    render(
      <ReferenceBulkEdit rows={rows} editing={editingOf()} onDone={() => {}} />,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: /Follow game updates/,
    });
    expect(checkbox).toHaveProperty("dataset.state", "checked");
  });

  it("is not offered for Set to", () => {
    render(
      <ReferenceBulkEdit rows={rows} editing={editingOf()} onDone={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("Operation"));
    fireEvent.click(screen.getByRole("option", { name: "Set to" }));
    expect(
      screen.queryByRole("checkbox", { name: /Follow game updates/ }),
    ).toBeNull();
  });

  it("is not offered for Range, and says so", () => {
    render(
      <ReferenceBulkEdit rows={rows} editing={editingOf()} onDone={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText("Column"));
    fireEvent.click(screen.getByRole("option", { name: "Range" }));
    expect(
      screen.queryByRole("checkbox", { name: /Follow game updates/ }),
    ).toBeNull();
  });

  it("applies with follow true by default", () => {
    const editing = editingOf();
    render(
      <ReferenceBulkEdit rows={rows} editing={editing} onDone={() => {}} />,
    );
    changeValue();
    fireEvent.click(screen.getByRole("button", { name: /Apply to/ }));
    expect(editing.applyBatch).toHaveBeenCalledWith(
      ["armpw", "armrock"],
      expect.any(Array),
      { kind: "multiply", factor: 1.1 },
      { kind: "none" },
      true,
    );
  });

  it("applies with follow false once unticked", () => {
    const editing = editingOf();
    render(
      <ReferenceBulkEdit rows={rows} editing={editing} onDone={() => {}} />,
    );
    changeValue();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Follow game updates/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply to/ }));
    expect(editing.applyBatch).toHaveBeenLastCalledWith(
      ["armpw", "armrock"],
      expect.any(Array),
      { kind: "multiply", factor: 1.1 },
      { kind: "none" },
      false,
    );
  });

  it("marks a row already following the game, and a fixed one, in the preview", () => {
    const withFixed = setOverride({}, "armrock", "health", 500, 400);
    const withRelative = setRelativeEdit(
      { ...EMPTY_EDITS, overrides: withFixed },
      "armpw",
      "health",
      { factor: 1, offset: 0, rounding: { kind: "none" } },
      260,
    );
    const editing = editingOf({
      overrides: withRelative.overrides,
      relative: withRelative.relative,
    });
    render(
      <ReferenceBulkEdit rows={rows} editing={editing} onDone={() => {}} />,
    );
    changeValue();
    expect(screen.getByText("(follows)")).toBeTruthy();
    expect(screen.getByText("(fixed)")).toBeTruthy();
  });
});
