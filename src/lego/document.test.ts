import { describe, expect, it } from "vitest";

import {
  COALESCE_MS,
  emptyDocument,
  HISTORY_LIMIT,
  type LegoDocument,
  type LegoDocumentAction,
  reduceDocument,
} from "./document";
import { type LegoProject, newProject } from "./model";

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

const opened: LegoDocument = reduceDocument(emptyDocument, {
  type: "open",
  project: project("walker"),
});

/** Rename the unit at a given moment, which is the smallest edit there is. */
function rename(name: string, at: number): LegoDocumentAction {
  return { type: "edit", change: (doc) => ({ ...doc, name }), at };
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

describe("clipboard", () => {
  it("holds a cutting until something else is copied", () => {
    const cutting = project("arm");

    const copied = reduceDocument(opened, { type: "copy", cutting });
    expect(copied.clipboard).toBe(cutting);
    // Copying is not an edit, so it neither dirties the unit nor undoes.
    expect(copied.dirty).toBe(false);
    expect(copied.past).toEqual([]);

    expect(
      reduceDocument(copied, { type: "copy", cutting: null }).clipboard,
    ).toBe(null);
  });

  it("survives an undo, so a lifted subtree outlives the edit it came from", () => {
    const copied = run(opened, { type: "copy", cutting: project("arm") });

    const undone = run(copied, rename("one", 1000), { type: "undo" });

    expect(undone.clipboard?.name).toBe("arm");
  });
});
