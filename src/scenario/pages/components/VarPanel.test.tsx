// @vitest-environment happy-dom
/**
 * A variable's starting value against a document that changes underneath it
 * (issue #2185).
 *
 * The same drift `panels.test.tsx` pins for the panel fields, in the box beside
 * the name. It keeps its own copy of the number so the editor is not saving to
 * disk on every keystroke, an undo puts the document back without touching the
 * box, and the next keystroke commits the copy and takes the undo with it.
 *
 * Driven through the whole panel, because the box is mounted keyed by the
 * variable's name. Renaming one therefore reseeds it and changing its value does
 * not, so this only shows after an undo of the value.
 *
 * Its commit rules are pinned alongside, because the resync must not quietly
 * change them: a box holding something that is not a number puts the old value
 * back, since `parseVars` drops a value that is not one and would take the
 * declaration with it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NO_EXTENSIONS } from "../../extensions";
import type { Scenario } from "../../model";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";
import { VarPanel } from "./VarPanel";

afterEach(cleanup);

function scenario(vars: Record<string, number>): Scenario {
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
    vars,
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The editor in miniature: one scenario, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function PanelHarness({ vars }: { vars: Record<string, number> }) {
  const [document, setDocument] = useState(() => scenario(vars));
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);

  return (
    <>
      <VarPanel
        scenario={document}
        onChange={(next) => {
          setHistory(recordEdit(history, document, next));
          setDocument(next);
        }}
        extensions={NO_EXTENSIONS}
      />
      <button
        type="button"
        onClick={() => {
          const step = undoEdit(history, document);
          if (!step) return;
          setHistory(step.history);
          setDocument(step.document);
        }}
      >
        Undo
      </button>
      <output>{JSON.stringify(document.vars)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(vars: Record<string, number>) {
  render(<PanelHarness vars={vars} />);
  fireEvent.click(screen.getByRole("button", { name: /^Variables/ }));
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** The variables the document holds, which the harness puts on screen so a test
 *  can read them the way the rest of the editor would. */
const stored = (): Record<string, number> =>
  JSON.parse(screen.getByRole("status").textContent ?? "{}");

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const valueBox = () => screen.getByLabelText("Starting value of waves");

describe("a variable's starting value when the document moves under it", () => {
  it("shows the value an undo put back", () => {
    openPanel({ waves: 3 });

    commit(valueBox(), "7");
    undo();

    expect(asInput(valueBox()).value).toBe("3");
  });

  it("does not write the undone value back on the next keystroke", () => {
    openPanel({ waves: 3 });

    commit(valueBox(), "7");
    undo();
    // One more digit on the end of whatever the box is showing.
    commit(valueBox(), `${asInput(valueBox()).value}1`);

    expect(stored()).toEqual({ waves: 31 });
  });
});

describe("a variable's starting value commit rules", () => {
  it("puts the value back when the box is emptied", () => {
    openPanel({ waves: 3 });

    commit(valueBox(), "");

    expect(stored()).toEqual({ waves: 3 });
    expect(asInput(valueBox()).value).toBe("3");
  });

  it("takes a negative number, because a mission may count down", () => {
    openPanel({ waves: 3 });

    commit(valueBox(), "-2");

    expect(stored()).toEqual({ waves: -2 });
  });
});
