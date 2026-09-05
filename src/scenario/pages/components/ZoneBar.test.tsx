// @vitest-environment happy-dom
/**
 * The zone bar's name box against a document that changes underneath it (issue
 * #2185).
 *
 * The same drift `panels.test.tsx` pins for the panel fields, in the one box
 * that is typed on the map rather than in a panel. It keeps its own copy of the
 * name so the editor is not saving to disk on every keystroke, an undo puts the
 * document back without touching the box, and the next keystroke commits the
 * copy and takes the undo with it.
 *
 * The bar is mounted keyed by the zone's id, which is not its name, so nothing
 * remounts it when the name moves. Selecting another zone does, which is why the
 * box looks right until an undo is taken with the same zone still selected.
 *
 * Its commit rules are pinned alongside, because the resync must not quietly
 * change them: the name is trimmed on the way in, and a blank box is a cancelled
 * rename rather than a zone with no name. A zone with no name is a zone no
 * trigger can point at.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "@/lib/scenarioEditing/history";
import type { ScenarioZone } from "../../model";
import { ZoneBar } from "./ScenarioMapBars";

afterEach(cleanup);

function zone(name: string): ScenarioZone {
  return {
    id: "z1",
    name,
    shape: "circle",
    center: { x: 100, z: 100 },
    radius: 50,
  };
}

/** The map in miniature: one zone, the real undo stack, and an Undo button
 *  standing in for the shortcut. */
function ZoneHarness({ initial }: { initial: string }) {
  const [document, setDocument] = useState(() => zone(initial));
  const [history, setHistory] =
    useState<EditHistory<ScenarioZone>>(emptyHistory);

  return (
    <>
      <ZoneBar
        zone={document}
        onRename={(name) => {
          // What `renameZone` does with what the bar hands it.
          const trimmed = name.trim();
          if (!trimmed) return;
          const next = { ...document, name: trimmed };
          setHistory(recordEdit(history, document, next));
          setDocument(next);
        }}
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
      <output>{document.name}</output>
    </>
  );
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** The name the document holds, which the harness puts on screen so a test can
 *  read it the way a trigger picking a zone would. */
const documentName = () => screen.getByRole("status").textContent;

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const nameBox = () => screen.getByLabelText("Zone name");

describe("a zone's name box when the document moves under it", () => {
  it("shows the name an undo put back", () => {
    render(<ZoneHarness initial="North pass" />);

    commit(nameBox(), "South pass");
    undo();

    expect(asInput(nameBox()).value).toBe("North pass");
  });

  it("does not write the undone name back on the next keystroke", () => {
    render(<ZoneHarness initial="North pass" />);

    commit(nameBox(), "South pass");
    undo();
    commit(nameBox(), `${asInput(nameBox()).value}!`);

    expect(documentName()).toBe("North pass!");
  });
});

describe("a zone's name box commit rules", () => {
  it("trims what it writes", () => {
    render(<ZoneHarness initial="North pass" />);

    commit(nameBox(), "  South pass  ");

    expect(documentName()).toBe("South pass");
  });

  it("puts the name back when the box is emptied, rather than renaming", () => {
    render(<ZoneHarness initial="North pass" />);

    commit(nameBox(), "   ");

    expect(documentName()).toBe("North pass");
    expect(asInput(nameBox()).value).toBe("North pass");
  });
});
