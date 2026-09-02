// @vitest-environment happy-dom
/**
 * Removing a restriction from the panel has no confirm dialog and no undo
 * button of its own nearby (issue #2280, issue #2306).
 *
 * The panel has no single named object to delete: it holds two lists, a
 * buildable rule's units and the commands withheld, and taking an entry off
 * either is a plain list removal rather than the kind of delete the trigger,
 * objective and variable panels have. So the notice here does not say
 * "Deleted X", it says what the list removal actually did, the same words
 * each chip's own remove button already uses ("Take X off the list", "Allow
 * X again"), which is the wording an author has already seen once by the time
 * the toast repeats it.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scenario } from "../../model";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";
import { RestrictionPanel } from "./RestrictionPanel";

// The panel's removal notice has no shell here (issue #2280), the same gap
// `ScenarioBuilderPage.dom.test.tsx` fills for its own toasts. Captured rather
// than rendered, so a test can read the message and fire the action the way a
// click on the toast's own Undo button would.
const toasted = vi.hoisted(() => ({
  calls: [] as {
    message: string;
    id: string;
    action: { onClick: () => void };
  }[],
}));
vi.mock("sonner", () => ({
  toast: (
    message: string,
    opts: { id: string; action: { onClick: () => void } },
  ) => {
    toasted.calls.push({ message, id: opts.id, action: opts.action });
  },
}));

afterEach(() => {
  cleanup();
  toasted.calls.length = 0;
});

function scenario(restrictions: Scenario["restrictions"] = {}): Scenario {
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
    restrictions,
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The editor in miniature: one scenario, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function PanelHarness({
  restrictions,
}: {
  restrictions: Scenario["restrictions"];
}) {
  const [document, setDocument] = useState(() => scenario(restrictions));
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);
  // Read at the moment a step is taken rather than at the last render, the
  // same reason ScenarioEditPage keeps its own copies: a removal's notice
  // binds `onUndo` at the click that fires it, and firing the notice's action
  // later must see the document that removal produced, not whatever this
  // closure held when the button was drawn.
  const documentRef = useRef(document);
  documentRef.current = document;
  const historyRef = useRef(history);
  historyRef.current = history;

  // Shared by the harness's own Undo button and by `onUndo`, so a test that
  // fires a toast's action is exercising the exact function Cmd+Z and the map
  // toolbar call, not a lookalike (issue #2280, issue #2306).
  const stepBack = () => {
    const step = undoEdit(historyRef.current, documentRef.current);
    if (!step) return;
    setHistory(step.history);
    setDocument(step.document);
  };

  return (
    <>
      <RestrictionPanel
        scenario={document}
        onChange={(next) => {
          setHistory(recordEdit(history, document, next));
          setDocument(next);
        }}
        units={[]}
        unitsLoading={false}
        onUndo={stepBack}
      />
      <button type="button" onClick={stepBack}>
        Undo
      </button>
      <output>{JSON.stringify(document.restrictions)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(restrictions: Scenario["restrictions"]) {
  render(<PanelHarness restrictions={restrictions} />);
  fireEvent.click(screen.getByRole("button", { name: /^Restrictions/ }));
}

/** The restrictions the document holds, which the harness puts on screen so a
 *  test can read them the way the rest of the editor would. */
const stored = (): Scenario["restrictions"] =>
  JSON.parse(screen.getByRole("status").textContent ?? "{}");

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

describe("taking a unit off the buildable list", () => {
  const remove = (def: string) =>
    fireEvent.click(
      screen.getByRole("button", { name: `Take ${def} off the list` }),
    );

  it("says what was taken off the list, not that it was deleted", () => {
    openPanel({ buildable: { mode: "allow", units: ["armcom", "armpw"] } });

    remove("armpw");

    expect(toasted.calls).toHaveLength(1);
    expect(toasted.calls[0].message).toBe(
      'Took "armpw" off the buildable list.',
    );
  });

  it("is undoable through Cmd+Z alone, with no toast involved", () => {
    openPanel({ buildable: { mode: "allow", units: ["armcom", "armpw"] } });

    remove("armpw");
    undo();

    expect(stored().buildable?.units).toEqual(["armcom", "armpw"]);
  });

  it("restores the unit when the notice's own action is used", () => {
    openPanel({ buildable: { mode: "allow", units: ["armcom", "armpw"] } });

    remove("armpw");
    act(() => toasted.calls[0].action.onClick());

    expect(stored().buildable?.units).toEqual(["armcom", "armpw"]);
  });

  it("uses one fixed notice id so several removals in a row replace it rather than stacking", () => {
    openPanel({
      buildable: { mode: "allow", units: ["armcom", "armpw", "armflea"] },
    });

    remove("armpw");
    remove("armflea");

    expect(toasted.calls).toHaveLength(2);
    expect(toasted.calls[0].id).toBe(toasted.calls[1].id);
    expect(toasted.calls[0].message).not.toBe(toasted.calls[1].message);
  });
});

describe("taking a command off the withheld list", () => {
  const remove = (name: string) =>
    fireEvent.click(
      screen.getByRole("button", { name: `Allow ${name} again` }),
    );

  it("says what was taken off the list, not that it was deleted", () => {
    openPanel({ commands: ["selfd", "reclaim"] });

    remove("selfd");

    expect(toasted.calls).toHaveLength(1);
    expect(toasted.calls[0].message).toBe(
      'Took "selfd" off the withheld list.',
    );
  });

  it("is undoable through Cmd+Z alone, with no toast involved", () => {
    openPanel({ commands: ["selfd", "reclaim"] });

    remove("selfd");
    undo();

    expect(stored().commands).toEqual(["selfd", "reclaim"]);
  });

  it("restores the command when the notice's own action is used", () => {
    openPanel({ commands: ["selfd", "reclaim"] });

    remove("selfd");
    act(() => toasted.calls[0].action.onClick());

    expect(stored().commands).toEqual(["selfd", "reclaim"]);
  });

  it("uses one fixed notice id so several removals in a row replace it rather than stacking", () => {
    openPanel({ commands: ["selfd", "reclaim", "capture"] });

    remove("selfd");
    remove("reclaim");

    expect(toasted.calls).toHaveLength(2);
    expect(toasted.calls[0].id).toBe(toasted.calls[1].id);
    expect(toasted.calls[0].message).not.toBe(toasted.calls[1].message);
  });
});
