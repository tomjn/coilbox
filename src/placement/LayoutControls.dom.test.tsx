// @vitest-environment happy-dom

/**
 * A layout's name field against a document that changes underneath it (issue
 * #2175).
 *
 * The field keeps its own copy of the name so neither editor is saving to disk
 * on every keystroke. Both editors have undo, and an undo puts the document back
 * without touching the box, so the box goes stale and the next keystroke commits
 * the stale copy over the restored name.
 *
 * Re-opening the popover this field sits in hides the problem, because a fresh
 * mount seeds a fresh copy. An undo taken while the popover is open does not, so
 * the field is driven here without ever being unmounted.
 *
 * Its commit rules are pinned alongside, because the resync must not quietly
 * change them: it hands over what was typed rather than a trimmed version of it,
 * and a blank box is a cancelled rename rather than a blank name.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "@/scenario/pages/components/history";
import { LayoutNameField } from "./LayoutControls";

afterEach(cleanup);

/** Either editor in miniature: the layout's name, the real undo stack both of
 *  them use, and an Undo button standing in for the shortcut. */
function NameHarness({ initial }: { initial: string }) {
  const [document, setDocument] = useState(initial);
  const [history, setHistory] = useState<EditHistory<string>>(emptyHistory);

  return (
    <>
      <LayoutNameField
        id="layout-name"
        name={document}
        onRename={(name) => {
          setHistory(recordEdit(history, document, name));
          setDocument(name);
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
      <output>{document}</output>
    </>
  );
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** The name the editor holds, which the harness puts on screen so a test can
 *  read it the way a layout picker would. */
const documentName = () => screen.getByRole("status").textContent;

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

describe("a layout's name field when the document moves under it", () => {
  it("shows the name an undo put back", () => {
    render(<NameHarness initial="Opening base" />);
    const field = screen.getByLabelText("Layout name");

    commit(field, "Front line");
    undo();

    expect(asInput(field).value).toBe("Opening base");
  });

  it("does not write the undone name back on the next keystroke", () => {
    render(<NameHarness initial="Opening base" />);
    const field = screen.getByLabelText("Layout name");

    commit(field, "Front line");
    undo();
    commit(field, `${asInput(field).value}!`);

    expect(documentName()).toBe("Opening base!");
  });
});

describe("a layout's name field commit rules", () => {
  it("hands over what was typed rather than a trimmed version of it", () => {
    render(<NameHarness initial="Opening base" />);

    commit(screen.getByLabelText("Layout name"), "  Front line  ");

    expect(documentName()).toBe("  Front line  ");
  });

  it("puts the name back when the box is emptied, rather than renaming", () => {
    render(<NameHarness initial="Opening base" />);
    const field = screen.getByLabelText("Layout name");

    commit(field, "   ");

    expect(documentName()).toBe("Opening base");
    expect(asInput(field).value).toBe("Opening base");
  });
});
