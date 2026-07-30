import { describe, expect, it } from "vitest";

import {
  COALESCE_MS,
  emptyDocument,
  HISTORY_LIMIT,
  type LegoDocument,
  type LegoDocumentAction,
  primarySelection,
  reduceDocument,
} from "./document";
import { type LegoPiece, type LegoProject, newProject } from "./model";

function project(name: string): LegoProject {
  return newProject({
    id: "p",
    rootPieceId: "root",
    name,
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
  });
}

function piece(id: string, parentId: string): LegoPiece {
  return {
    id,
    name: id,
    parentId,
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

const opened: LegoDocument = reduceDocument(emptyDocument, {
  type: "open",
  project: project("walker"),
});

/** Rename the unit at a given moment, which is the smallest edit there is. */
function rename(name: string, at: number): LegoDocumentAction {
  return { type: "edit", change: (doc) => ({ ...doc, name }), at };
}

/** Add a child piece under `parentId`, to build a tree to reseat against. */
function addPiece(
  id: string,
  parentId: string,
  at: number,
): LegoDocumentAction {
  return {
    type: "edit",
    at,
    change: (doc) => ({ ...doc, pieces: [...doc.pieces, piece(id, parentId)] }),
  };
}

function select(...ids: string[]): LegoDocumentAction {
  return { type: "select", ids };
}

function run(
  state: LegoDocument,
  ...actions: LegoDocumentAction[]
): LegoDocument {
  return actions.reduce(reduceDocument, state);
}

describe("open", () => {
  it("takes a copy of the stored document", () => {
    expect(opened.project?.name).toBe("walker");
    expect(opened.dirty).toBe(false);
    expect(opened.past).toEqual([]);
  });

  it("leaves edits in progress alone when the shared list refreshes", () => {
    const edited = run(opened, rename("gunship", 1000));

    const refreshed = reduceDocument(edited, {
      type: "open",
      project: project("walker"),
    });

    expect(refreshed).toBe(edited);
  });
});

describe("edit", () => {
  it("records the previous document and marks the unit unsaved", () => {
    const edited = run(opened, rename("gunship", 1000));

    expect(edited.project?.name).toBe("gunship");
    expect(edited.past.map((doc) => doc.name)).toEqual(["walker"]);
    expect(edited.dirty).toBe(true);
  });

  it("does nothing when the change returns the document it was given", () => {
    const edited = reduceDocument(opened, {
      type: "edit",
      change: (doc) => doc,
      at: 1000,
    });

    expect(edited).toBe(opened);
  });

  it("does nothing before a document has been opened", () => {
    expect(reduceDocument(emptyDocument, rename("gunship", 1000))).toBe(
      emptyDocument,
    );
  });

  it("throws away the redo trail", () => {
    const undone = run(opened, rename("gunship", 1000), { type: "undo" });
    expect(undone.future).toHaveLength(1);

    expect(run(undone, rename("bomber", 5000)).future).toEqual([]);
  });

  it("keeps only the last few steps", () => {
    const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, step) =>
      // Far enough apart that each is a step of its own.
      rename(`step${step}`, step * COALESCE_MS * 2),
    );

    const edited = run(opened, ...many);

    expect(edited.past).toHaveLength(HISTORY_LIMIT);
    // The oldest went, the newest stayed.
    expect(edited.past.at(-1)?.name).toBe(`step${HISTORY_LIMIT + 18}`);
  });
});

describe("coalescing", () => {
  it("folds a drag into one undo step", () => {
    // Sixty frames of a slider, a few milliseconds apart.
    const drag = Array.from({ length: 60 }, (_, frame) =>
      rename(`drag${frame}`, 1000 + frame * 8),
    );

    const dragged = run(opened, ...drag);
    expect(dragged.past).toHaveLength(1);

    const undone = reduceDocument(dragged, { type: "undo" });
    expect(undone.project?.name).toBe("walker");
  });

  it("starts a new step once the hand pauses", () => {
    const edited = run(
      opened,
      rename("one", 1000),
      rename("two", 1000 + COALESCE_MS),
    );

    expect(edited.past.map((doc) => doc.name)).toEqual(["walker", "one"]);
  });

  it("gives the first edit a step of its own", () => {
    // Nothing to fold into, however soon after opening it lands.
    expect(run(opened, rename("one", 1)).past).toHaveLength(1);
  });

  it("does not fold the edit after an undo into the gesture before it", () => {
    const undone = run(opened, rename("one", 1000), rename("two", 1004), {
      type: "undo",
    });

    const edited = reduceDocument(undone, rename("three", 1008));

    expect(edited.past.map((doc) => doc.name)).toEqual(["walker"]);
    expect(reduceDocument(edited, { type: "undo" }).project?.name).toBe(
      "walker",
    );
  });
});

describe("undo and redo", () => {
  it("walks back and forward through the steps", () => {
    const edited = run(opened, rename("one", 1000), rename("two", 5000));

    const back = run(edited, { type: "undo" }, { type: "undo" });
    expect(back.project?.name).toBe("walker");
    expect(back.past).toEqual([]);

    const forward = run(back, { type: "redo" }, { type: "redo" });
    expect(forward.project?.name).toBe("two");
    expect(forward.future).toEqual([]);
  });

  it("leaves the document unsaved, because it no longer matches the disk", () => {
    const saved = run(opened, rename("one", 1000), { type: "saved" });
    expect(saved.dirty).toBe(false);

    expect(reduceDocument(saved, { type: "undo" }).dirty).toBe(true);
  });

  it("does nothing at either end of the history", () => {
    expect(reduceDocument(opened, { type: "undo" })).toBe(opened);
    expect(reduceDocument(opened, { type: "redo" })).toBe(opened);
  });
});

describe("selection", () => {
  it("starts on the root once the document arrives", () => {
    expect(opened.selectedIds).toEqual(["root"]);
  });

  it("moves where it is told", () => {
    expect(reduceDocument(opened, select("root")).selectedIds).toEqual([
      "root",
    ]);
  });

  it("reseats to the parent when undo removes the selected piece", () => {
    const built = run(opened, addPiece("child", "root", 1000), select("child"));
    expect(built.selectedIds).toEqual(["child"]);

    const undone = reduceDocument(built, { type: "undo" });
    expect(undone.project?.pieces.map((p) => p.id)).toEqual(["root"]);
    expect(undone.selectedIds).toEqual(["root"]);
  });

  it("reseats to the parent when a delete removes the selected piece", () => {
    const built = run(opened, addPiece("child", "root", 1000), select("child"));

    const deleted = reduceDocument(built, {
      type: "edit",
      at: 5000,
      change: (doc) => ({
        ...doc,
        pieces: doc.pieces.filter((piece) => piece.id !== "child"),
      }),
    });

    expect(deleted.selectedIds).toEqual(["root"]);
  });

  it("reseats to redo the same way, since it is the same kind of jump", () => {
    const built = run(opened, addPiece("child", "root", 1000), select("child"));
    const undone = reduceDocument(built, { type: "undo" });
    // The selection already settled on root during the undo. Going forward
    // again does not chase the child back down, because root is still there.
    const redone = reduceDocument(undone, { type: "redo" });
    expect(redone.selectedIds).toEqual(["root"]);
  });

  it("walks up to the nearest surviving ancestor, not straight to the root", () => {
    const built = run(
      opened,
      addPiece("mid", "root", 1000),
      addPiece("leaf", "mid", 6000),
      select("leaf"),
    );

    // Only the step that added "leaf" undoes here, so "mid" survives and is
    // where the selection should land: it is where "leaf" hung off, not the
    // furthest thing away.
    const undone = reduceDocument(built, { type: "undo" });
    expect(undone.project?.pieces.map((p) => p.id)).toEqual(["root", "mid"]);
    expect(undone.selectedIds).toEqual(["mid"]);
  });

  it("walks up past a whole removed branch to whatever is left", () => {
    const built = run(
      opened,
      // Both pieces land in the same edit, so undoing it takes both at once.
      {
        type: "edit",
        at: 1000,
        change: (doc) => ({
          ...doc,
          pieces: [...doc.pieces, piece("mid", "root"), piece("leaf", "mid")],
        }),
      },
      select("leaf"),
    );

    const undone = reduceDocument(built, { type: "undo" });
    expect(undone.project?.pieces.map((p) => p.id)).toEqual(["root"]);
    expect(undone.selectedIds).toEqual(["root"]);
  });

  it("clears the selection rather than guess, if even the root has gone", () => {
    const built = run(opened, addPiece("child", "root", 1000), select("child"));

    // Not a shape the app produces, but the reducer takes whatever `change`
    // hands it, so this is the only way to put it in a state with no root to
    // fall back to.
    const broken = reduceDocument(built, {
      type: "edit",
      at: 5000,
      change: (doc) => ({ ...doc, pieces: [] }),
    });

    expect(broken.selectedIds).toEqual([]);
  });

  it("leaves an untouched selection alone", () => {
    const built = run(opened, addPiece("child", "root", 1000), select("root"));

    const edited = reduceDocument(built, rename("gunship", 6000));
    expect(edited.selectedIds).toEqual(["root"]);
  });
});

describe("selecting more than one piece", () => {
  const tree = run(
    opened,
    addPiece("mid", "root", 1000),
    addPiece("leg", "root", 1000),
    addPiece("foot", "mid", 1000),
  );

  it("adds and removes one piece at a time, newest last", () => {
    const both = run(tree, select("mid"), { type: "toggle-select", id: "leg" });
    expect(both.selectedIds).toEqual(["mid", "leg"]);
    expect(primarySelection(both)).toBe("leg");

    const back = reduceDocument(both, { type: "toggle-select", id: "leg" });
    expect(back.selectedIds).toEqual(["mid"]);
  });

  it("takes a plain select as a replacement, not an addition", () => {
    const both = run(tree, select("mid", "leg"), select("foot"));
    expect(both.selectedIds).toEqual(["foot"]);
  });

  it("reseats every selected piece when a delete takes some of them", () => {
    const built = run(tree, select("foot", "leg"));

    const deleted = reduceDocument(built, {
      type: "edit",
      at: 9000,
      change: (doc) => ({
        ...doc,
        pieces: doc.pieces.filter((piece) => piece.id !== "foot"),
      }),
    });

    // "foot" reseats onto the parent it hung off. "leg" is untouched and
    // keeps its place in the order.
    expect(deleted.selectedIds).toEqual(["mid", "leg"]);
  });

  it("does not hold the same piece twice when two of them reseat together", () => {
    const built = run(tree, select("mid", "foot"));

    const deleted = reduceDocument(built, {
      type: "edit",
      at: 9000,
      change: (doc) => ({
        ...doc,
        pieces: doc.pieces.filter((piece) => piece.id !== "foot"),
      }),
    });

    expect(deleted.selectedIds).toEqual(["mid"]);
  });

  it("empties the selection when every selected piece goes", () => {
    const built = run(tree, select("mid", "leg"));

    const broken = reduceDocument(built, {
      type: "edit",
      at: 9000,
      change: (doc) => ({ ...doc, pieces: [] }),
    });

    expect(broken.selectedIds).toEqual([]);
  });
});
