// @vitest-environment happy-dom
/**
 * When a project's relative changes are worked out again (issue #3174): once
 * per read of its game, as one undo step, with what moved kept for the
 * session.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetFollowGameSession, useFollowGame } from "./followGame";
import { EMPTY_EDITS, type GameEdits, type ModProject } from "./project";
import { setRelativeEdit } from "./relativeEdits";

const edits = setRelativeEdit(
  EMPTY_EDITS,
  "armpw",
  "health",
  { factor: 1.15, offset: 0, rounding: { kind: "integer" } },
  260,
);

const project: ModProject = {
  id: "p1",
  name: "Tougher peewees",
  gameName: "BA",
  edits,
  createdAt: "",
  updatedAt: "",
};

/** `useModProjects().applyEdits`, over one project held here. */
function store() {
  let current: GameEdits = project.edits;
  const applyEdits = vi.fn(
    (_id: string, update: (e: GameEdits) => GameEdits) => {
      const after = update(current);
      if (after === current) return null;
      const before = current;
      current = after;
      return { before, after };
    },
  );
  return { applyEdits, edits: () => current };
}

const units = { armpw: { health: 280 } };

afterEach(resetFollowGameSession);

describe("following the game on open", () => {
  it("works the numbers out once, as one undo step, and lists what moved", () => {
    const { applyEdits, edits: now } = store();
    const onStep = vi.fn();
    const { result, rerender } = renderHook(() =>
      useFollowGame({ project, units, checksum: "c2", applyEdits, onStep }),
    );
    rerender();
    rerender();
    expect(applyEdits).toHaveBeenCalledTimes(1);
    expect(now().overrides).toEqual({ armpw: { health: 322 } });
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenCalledWith("p1", edits);
    expect(result.current.map((f) => f.detail)).toEqual([
      "armpw health follows the game: game 260 to 280, project 299 to 322.",
    ]);
    expect(result.current[0]).toMatchObject({
      store: "overrides",
      severity: "review",
      subject: "armpw.health",
    });
  });

  it("waits for a read of the project's own game", () => {
    const { applyEdits } = store();
    renderHook(() =>
      useFollowGame({
        project,
        units: undefined,
        checksum: undefined,
        applyEdits,
        onStep: () => {},
      }),
    );
    expect(applyEdits).not.toHaveBeenCalled();
  });

  it("keeps what it found for another page opening the same project", () => {
    const { applyEdits } = store();
    renderHook(() =>
      useFollowGame({
        project,
        units,
        checksum: "c2",
        applyEdits,
        onStep() {},
      }),
    );
    const again = store();
    const { result } = renderHook(() =>
      useFollowGame({
        project,
        units,
        checksum: "c2",
        applyEdits: again.applyEdits,
        onStep() {},
      }),
    );
    expect(again.applyEdits).not.toHaveBeenCalled();
    expect(result.current).toHaveLength(1);
  });

  it("costs no undo step when nothing moved", () => {
    const { applyEdits } = store();
    const onStep = vi.fn();
    const { result } = renderHook(() =>
      useFollowGame({
        project,
        units: { armpw: { health: 260 } },
        checksum: "c1",
        applyEdits,
        onStep,
      }),
    );
    expect(onStep).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });
});
