import { describe, expect, it } from "vitest";

import {
  groupProblems,
  mutedSourcesFrom,
  type Problem,
  problem,
  problemTexts,
  visibleProblems,
} from "./problems";

const list: Problem[] = [
  problem("document", "error", "The root piece is missing."),
  problem("balance", "warning", "Looks as if it would tip.", ["a", "b"]),
  problem("overlap", "warning", "b is buried inside a.", ["b", "a"]),
  problem("pack", "warning", "An atlas is missing."),
];

describe("problem", () => {
  it("defaults to no pieces", () => {
    expect(problem("pack", "note", "x").pieceIds).toEqual([]);
  });

  it("keeps a copy of the piece ids", () => {
    const ids = ["a"];
    const made = problem("pack", "note", "x", ids);
    ids.push("b");
    expect(made.pieceIds).toEqual(["a"]);
  });
});

describe("problemTexts", () => {
  it("is the messages, in order", () => {
    expect(problemTexts(list.slice(0, 2))).toEqual([
      "The root piece is missing.",
      "Looks as if it would tip.",
    ]);
  });
});

describe("visibleProblems", () => {
  it("drops a muted source", () => {
    const shown = visibleProblems(list, new Set(["balance", "pack"]));
    expect(shown.map((p) => p.source)).toEqual(["document", "overlap"]);
  });

  it("never drops an error, because it means the unit did not open properly", () => {
    const shown = visibleProblems(list, new Set(["document"]));
    expect(shown[0].message).toBe("The root piece is missing.");
  });
});

describe("groupProblems", () => {
  it("orders groups by severity, errors first, and keeps source order inside", () => {
    const groups = groupProblems(list);
    expect(groups.map((g) => g.severity)).toEqual(["error", "warning"]);
    expect(groups[1].problems.map((p) => p.source)).toEqual([
      "balance",
      "overlap",
      "pack",
    ]);
  });

  it("is empty for no problems", () => {
    expect(groupProblems([])).toEqual([]);
  });
});

describe("mutedSourcesFrom", () => {
  it("reads a stored list of sources", () => {
    expect(mutedSourcesFrom('["balance","overlap"]')).toEqual(
      new Set(["balance", "overlap"]),
    );
  });

  it("ignores junk, unknown sources and a missing value", () => {
    expect(mutedSourcesFrom(null)).toEqual(new Set());
    expect(mutedSourcesFrom("not json")).toEqual(new Set());
    expect(mutedSourcesFrom('["balance","nonsense",3]')).toEqual(
      new Set(["balance"]),
    );
  });
});
