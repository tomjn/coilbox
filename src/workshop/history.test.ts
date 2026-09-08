// @vitest-environment happy-dom
/**
 * Undo and redo, and the two ways they are easy to get wrong: a step that spans
 * more than one store, and a stack that reaches into a project nobody is
 * looking at.
 *
 * The hook holds stacks and nothing else, so these tests carry the present
 * state themselves the way the page does. The stacks are module state, shared
 * by every mount, so each test starts by throwing the last one's away.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setUnitDisabled } from "./disabled";
import { resetEditHistory, useEditHistory } from "./history";
import { setOverride } from "./overrides";
import { EMPTY_EDITS, editSlot, type GameEdits } from "./project";

const withHealth = (edits: GameEdits, value: number) =>
  editSlot(edits, "overrides", (o) =>
    setOverride(o, "armcom", "health", value, 3000),
  );

const withDisabled = (edits: GameEdits, unit: string) =>
  editSlot(edits, "disabled", (d) => setUnitDisabled(d, unit, true));

beforeEach(resetEditHistory);

describe("undo and redo", () => {
  it("walks back and forward through the steps", () => {
    const { result } = renderHook(() => useEditHistory());
    const first = withHealth(EMPTY_EDITS, 4000);
    const second = withHealth(first, 5000);

    expect(result.current.canUndo("p1")).toBe(false);
    act(() => result.current.push("p1", EMPTY_EDITS));
    act(() => result.current.push("p1", first));
    expect(result.current.canUndo("p1")).toBe(true);
    expect(result.current.canRedo("p1")).toBe(false);

    let state: GameEdits = second;
    act(() => {
      state = result.current.undo("p1", state) ?? state;
    });
    expect(state).toBe(first);
    act(() => {
      state = result.current.undo("p1", state) ?? state;
    });
    expect(state).toBe(EMPTY_EDITS);
    expect(result.current.canUndo("p1")).toBe(false);
    expect(result.current.canRedo("p1")).toBe(true);

    act(() => {
      state = result.current.redo("p1", state) ?? state;
    });
    expect(state).toBe(first);
    act(() => {
      state = result.current.redo("p1", state) ?? state;
    });
    expect(state).toBe(second);
    expect(result.current.canRedo("p1")).toBe(false);
  });

  it("answers nothing when there is nothing to go back to", () => {
    const { result } = renderHook(() => useEditHistory());
    expect(result.current.undo("p1", EMPTY_EDITS)).toBeUndefined();
    expect(result.current.redo("p1", EMPTY_EDITS)).toBeUndefined();
  });

  /**
   * The reason there is one stack rather than five. Deleting a copied unit
   * clears its overrides, its text and its disabled mark alongside removing the
   * copy, and all four have to come back together.
   */
  it("takes back a change across several stores in one press", () => {
    const { result } = renderHook(() => useEditHistory());
    const before = withDisabled(withHealth(EMPTY_EDITS, 5000), "armpw");
    const after = editSlot(
      editSlot(before, "overrides", () => ({})),
      "disabled",
      () => [],
    );

    act(() => result.current.push("p1", before));
    let state = after;
    act(() => {
      state = result.current.undo("p1", state) ?? state;
    });

    expect(state.overrides.armcom).toEqual({ health: 5000 });
    expect(state.disabled).toEqual(["armpw"]);
  });

  it("drops the redo stack once a new change is made", () => {
    const { result } = renderHook(() => useEditHistory());
    const first = withHealth(EMPTY_EDITS, 4000);

    act(() => result.current.push("p1", EMPTY_EDITS));
    let state: GameEdits = first;
    act(() => {
      state = result.current.undo("p1", state) ?? state;
    });
    expect(result.current.canRedo("p1")).toBe(true);

    // A different edit from the same point. The road not taken is gone, because
    // redo would otherwise offer a state this edit was never made from.
    act(() => result.current.push("p1", state));
    expect(result.current.canRedo("p1")).toBe(false);
  });

  /**
   * The reason a stack belongs to a project rather than to the app. Every store
   * is scoped to one game and refuses to say anything about another
   * (issue #2664), and an undo that reached across projects would put back an
   * edit to a game the user is not looking at.
   */
  it("keeps each project's history to itself", () => {
    const { result } = renderHook(() => useEditHistory());
    act(() => result.current.push("ba", EMPTY_EDITS));

    expect(result.current.canUndo("ba")).toBe(true);
    expect(result.current.canUndo("bar")).toBe(false);
    expect(result.current.undo("bar", EMPTY_EDITS)).toBeUndefined();
    // Undoing in one leaves the other where it was.
    act(() => {
      result.current.undo("ba", withHealth(EMPTY_EDITS, 4000));
    });
    expect(result.current.canUndo("bar")).toBe(false);
  });

  it("forgets a deleted project, so a new one cannot inherit its steps", () => {
    const { result } = renderHook(() => useEditHistory());
    act(() => result.current.push("p1", EMPTY_EDITS));
    act(() => result.current.forget("p1"));
    expect(result.current.canUndo("p1")).toBe(false);
    expect(result.current.canRedo("p1")).toBe(false);
  });

  /**
   * The reason the stacks are module state (issue #2696). Going back to the
   * project list and opening the same project again unmounts the editor, and a
   * stack held in it would go too.
   */
  it("survives the editor being unmounted and mounted again", () => {
    const first = renderHook(() => useEditHistory());
    act(() => first.result.current.push("p1", EMPTY_EDITS));
    first.unmount();

    const second = renderHook(() => useEditHistory());
    expect(second.result.current.canUndo("p1")).toBe(true);
    expect(second.result.current.undo("p1", withHealth(EMPTY_EDITS, 4000))) //
      .toBe(EMPTY_EDITS);
  });
});
