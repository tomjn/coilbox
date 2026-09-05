import { describe, expect, it } from "vitest";

import type { BaseBlueprint } from "@/blueprint/model";
import type { Scenario } from "@/scenario/model";
import {
  type EditHistory,
  emptyHistory,
  HISTORY_LIMIT,
  isRedoKey,
  isTypingTarget,
  isUndoKey,
  recordEdit,
  redoEdit,
  sameEdit,
  undoEdit,
} from "./history";

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 2,
    id: "s1",
    name: "Test",
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "Game",
      mapName: "Map",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    blueprints: [],
    bases: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** A document with one more actor on it than the last. */
const withName = (name: string) => scenario({ name });

describe("sameEdit", () => {
  it("sees the same document as the same", () => {
    const doc = scenario();
    expect(sameEdit(doc, doc)).toBe(true);
    expect(sameEdit(doc, scenario())).toBe(true);
  });

  it("ignores the stamp a save puts on", () => {
    expect(
      sameEdit(scenario(), scenario({ updatedAt: "2026-06-06T00:00:00.000Z" })),
    ).toBe(true);
  });

  it("sees a real change", () => {
    expect(sameEdit(scenario(), withName("Other"))).toBe(false);
  });
});

describe("recordEdit", () => {
  it("remembers the document the edit replaced", () => {
    const before = scenario();
    const history = recordEdit(emptyHistory, before, withName("Two"));
    expect(history.past).toEqual([before]);
    expect(history.future).toEqual([]);
  });

  it("records nothing when a re-save changed nothing", () => {
    const before = scenario();
    const history = recordEdit(
      emptyHistory,
      before,
      scenario({ updatedAt: "2026-06-06T00:00:00.000Z" }),
    );
    expect(history).toBe(emptyHistory);
  });

  it("drops the future, because an edit after an undo is a new branch", () => {
    const history: EditHistory<Scenario> = {
      past: [],
      future: [withName("Forward")],
    };
    expect(recordEdit(history, scenario(), withName("Two")).future).toEqual([]);
  });

  it("keeps only the last HISTORY_LIMIT steps", () => {
    let history: EditHistory<Scenario> = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 10; i++)
      history = recordEdit(history, withName(`${i}`), withName(`${i + 1}`));
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].name).toBe("10");
  });
});

describe("undoEdit and redoEdit", () => {
  it("has nowhere to go on a fresh document", () => {
    expect(undoEdit(emptyHistory, scenario())).toBeNull();
    expect(redoEdit(emptyHistory, scenario())).toBeNull();
  });

  it("goes back to the document before the edit", () => {
    const one = withName("One");
    const two = withName("Two");
    const history = recordEdit(emptyHistory, one, two);
    const step = undoEdit(history, two);
    expect(step?.document).toEqual(one);
    expect(step?.history.past).toEqual([]);
    expect(step?.history.future).toEqual([two]);
  });

  it("goes forward again to exactly what was undone", () => {
    const one = withName("One");
    const two = withName("Two");
    const back = undoEdit(recordEdit(emptyHistory, one, two), two);
    if (!back) throw new Error("expected a step back");
    const forward = redoEdit(back.history, back.document);
    expect(forward?.document).toEqual(two);
    expect(forward?.history.past).toEqual([one]);
    expect(forward?.history.future).toEqual([]);
  });

  it("walks a run of edits back and forward in order", () => {
    const docs = ["One", "Two", "Three", "Four"].map(withName);
    let history: EditHistory<Scenario> = emptyHistory;
    for (let i = 1; i < docs.length; i++)
      history = recordEdit(history, docs[i - 1], docs[i]);

    let current = docs[3];
    const seen: string[] = [];
    for (;;) {
      const step = undoEdit(history, current);
      if (!step) break;
      history = step.history;
      current = step.document;
      seen.push(current.name);
    }
    expect(seen).toEqual(["Three", "Two", "One"]);

    const forward: string[] = [];
    for (;;) {
      const step = redoEdit(history, current);
      if (!step) break;
      history = step.history;
      current = step.document;
      forward.push(current.name);
    }
    expect(forward).toEqual(["Two", "Three", "Four"]);
  });

  it("undoes a drag as one step, because a drag writes the document once", () => {
    const actor = (pos: { x: number; z: number }): Scenario["actors"] => [
      { id: "a1", unitDef: "armcom", team: "p1", pos, facing: 0 },
    ];
    const before = scenario({ actors: actor({ x: 100, z: 100 }) });
    const after = scenario({ actors: actor({ x: 800, z: 400 }) });
    const history = recordEdit(emptyHistory, before, after);
    expect(history.past).toHaveLength(1);
    expect(undoEdit(history, after)?.document.actors[0].pos).toEqual({
      x: 100,
      z: 100,
    });
  });
});

describe("shortcuts", () => {
  const key = (
    k: string,
    mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey">> = {},
  ) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

  it("undoes on Cmd Z and on Ctrl Z", () => {
    expect(isUndoKey(key("z", { metaKey: true }))).toBe(true);
    expect(isUndoKey(key("z", { ctrlKey: true }))).toBe(true);
    expect(isUndoKey(key("z"))).toBe(false);
    expect(isUndoKey(key("z", { metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("redoes on Cmd Shift Z and on Ctrl Y", () => {
    expect(isRedoKey(key("z", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isRedoKey(key("y", { ctrlKey: true }))).toBe(true);
    expect(isRedoKey(key("z", { metaKey: true }))).toBe(false);
    expect(isRedoKey(key("y"))).toBe(false);
  });

  it("reads a capital Z as the same key, which is what Shift produces", () => {
    expect(isRedoKey(key("Z", { metaKey: true, shiftKey: true }))).toBe(true);
  });
});

/** The blueprint editor holds a layout rather than a scenario (#1442), and the
 *  history is the same one. */
describe("a document that is not a scenario", () => {
  const empty: BaseBlueprint = { id: "bp1", name: "Opening", buildings: [] };
  const built: BaseBlueprint = {
    ...empty,
    buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
  };

  it("goes back to the layout before the edit", () => {
    const history = recordEdit<BaseBlueprint>(emptyHistory, empty, built);
    expect(undoEdit(history, built)?.document).toEqual(empty);
  });

  it("has nothing to record when the layout is unchanged", () => {
    expect(recordEdit<BaseBlueprint>(emptyHistory, empty, { ...empty })).toBe(
      emptyHistory,
    );
  });
});

describe("isTypingTarget", () => {
  it("leaves text boxes their own undo stack", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("takes the key everywhere else", () => {
    expect(isTypingTarget({ tagName: "CANVAS" })).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
