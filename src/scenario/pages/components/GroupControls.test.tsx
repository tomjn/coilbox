// @vitest-environment happy-dom
/**
 * A group's unit count against a document that changes underneath it (issue
 * #2185).
 *
 * The same drift `panels.test.tsx` pins for the panel fields, in the box that
 * says how many of a unit type a group holds. It keeps its own copy of the count
 * so the editor is not saving to disk on every keystroke, an undo puts the
 * document back without touching the box, and the next keystroke commits the
 * copy and takes the undo with it.
 *
 * The row is keyed by the unit type rather than by the count, so nothing
 * remounts it when the count moves. Re-opening the popover it sits in does,
 * which is why the box looks right again as soon as it is shut and opened.
 *
 * Its commit rules are pinned alongside, because the resync must not quietly
 * change them: the count is held to a whole number between 1 and the cap, and
 * anything that is not a number at all reads as 1 rather than emptying the
 * group.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { GroupUnit } from "../../model";
import { UnitRow } from "./GroupControls";
import { MAX_GROUP_COUNT } from "./groups";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";

afterEach(cleanup);

/** The group popover in miniature: one unit entry, the real undo stack, and an
 *  Undo button standing in for the shortcut. */
function CountHarness({ initial }: { initial: number }) {
  const [document, setDocument] = useState<GroupUnit>({
    def: "armpw",
    count: initial,
  });
  const [history, setHistory] = useState<EditHistory<GroupUnit>>(emptyHistory);

  return (
    <>
      <UnitRow
        entry={document}
        onCount={(count) => {
          const next = { ...document, count };
          setHistory(recordEdit(history, document, next));
          setDocument(next);
        }}
        onRemove={() => {}}
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
      <output>{document.count}</output>
    </>
  );
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** The count the document holds, which the harness puts on screen so a test can
 *  read it the way the rest of the editor would. */
const documentCount = () => screen.getByRole("status").textContent;

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const countBox = () => screen.getByLabelText("How many armpw");

describe("a group's unit count when the document moves under it", () => {
  it("shows the count an undo put back", () => {
    render(<CountHarness initial={4} />);

    commit(countBox(), "12");
    undo();

    expect(asInput(countBox()).value).toBe("4");
  });

  it("does not write the undone count back on the next keystroke", () => {
    render(<CountHarness initial={4} />);

    commit(countBox(), "12");
    undo();
    // One more digit on the end of whatever the box is showing.
    commit(countBox(), `${asInput(countBox()).value}1`);

    expect(documentCount()).toBe("41");
  });
});

describe("a group's unit count commit rules", () => {
  it("holds the count to a whole number", () => {
    render(<CountHarness initial={4} />);

    commit(countBox(), "7.9");

    expect(documentCount()).toBe("7");
    expect(asInput(countBox()).value).toBe("7");
  });

  it("reads an empty box as one rather than as an empty group", () => {
    render(<CountHarness initial={4} />);

    commit(countBox(), "");

    expect(documentCount()).toBe("1");
    expect(asInput(countBox()).value).toBe("1");
  });

  it("holds the count to the cap", () => {
    render(<CountHarness initial={4} />);

    commit(countBox(), String(MAX_GROUP_COUNT + 50));

    expect(documentCount()).toBe(String(MAX_GROUP_COUNT));
    expect(asInput(countBox()).value).toBe(String(MAX_GROUP_COUNT));
  });

  it("puts the box right when what was typed clamps to what is already there", () => {
    render(<CountHarness initial={1} />);

    commit(countBox(), "0");

    expect(documentCount()).toBe("1");
    expect(asInput(countBox()).value).toBe("1");
  });
});
