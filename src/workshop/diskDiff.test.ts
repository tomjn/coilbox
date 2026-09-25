import { describe, expect, it } from "vitest";
import { collapseContext } from "./diskDiff";
import type { DiffLine } from "./inPlace";

function equal(oldLine: number, newLine: number, text: string): DiffLine {
  return { kind: "equal", oldLine, newLine, text };
}

function removed(oldLine: number, text: string): DiffLine {
  return { kind: "removed", oldLine, newLine: null, text };
}

function added(newLine: number, text: string): DiffLine {
  return { kind: "added", oldLine: null, newLine, text };
}

describe("collapsing an in-place diff for display", () => {
  it("keeps a short run of unchanged lines in full", () => {
    const lines = [
      equal(1, 1, "a"),
      equal(2, 2, "b"),
      removed(3, "c"),
      added(3, "C"),
      equal(4, 4, "d"),
    ];
    const items = collapseContext(lines, 3);
    expect(items.map((i) => i.type)).toEqual([
      "line",
      "line",
      "line",
      "line",
      "line",
    ]);
  });

  it("collapses a long run in the middle to a gap with context either side", () => {
    const lines = [
      removed(1, "old"),
      added(1, "new"),
      ...Array.from({ length: 10 }, (_, n) => equal(n + 2, n + 2, `l${n}`)),
      removed(12, "old2"),
      added(12, "new2"),
    ];
    const items = collapseContext(lines, 2);
    expect(items.map((i) => i.type)).toEqual([
      "line", // removed
      "line", // added
      "line", // context before gap
      "line",
      "gap",
      "line", // context after gap
      "line",
      "line", // removed
      "line", // added
    ]);
    const gap = items.find((i) => i.type === "gap");
    expect(gap).toEqual({ type: "gap", id: "gap-4:4", count: 6 });
  });

  it("only keeps the trailing context of a run at the start of the file", () => {
    const lines = [
      ...Array.from({ length: 8 }, (_, n) => equal(n + 1, n + 1, `l${n}`)),
      removed(9, "old"),
      added(9, "new"),
    ];
    const items = collapseContext(lines, 3);
    expect(items[0]).toEqual({ type: "gap", id: "gap-1:1", count: 5 });
    // 3 lines of context, then removed and added.
    expect(items.filter((i) => i.type === "line")).toHaveLength(5);
  });

  it("only keeps the leading context of a run at the end of the file", () => {
    const lines = [
      removed(1, "old"),
      added(1, "new"),
      ...Array.from({ length: 8 }, (_, n) => equal(n + 2, n + 2, `l${n}`)),
    ];
    const items = collapseContext(lines, 3);
    expect(items.at(-1)).toEqual({ type: "gap", id: "gap-5:5", count: 5 });
    expect(items.filter((i) => i.type === "line")).toHaveLength(5);
  });

  it("shows a whole-file addition with no gaps, since none of it is unchanged", () => {
    const lines = [added(1, "a"), added(2, "b"), added(3, "c")];
    const items = collapseContext(lines, 3);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.type === "line")).toBe(true);
  });

  it("gives every line a unique id", () => {
    const lines = [
      equal(1, 1, "a"),
      removed(2, "b"),
      added(2, "B"),
      equal(3, 3, "c"),
    ];
    const ids = collapseContext(lines, 3).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
