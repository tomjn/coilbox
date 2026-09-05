// @vitest-environment happy-dom
/**
 * Panel fields against a document that changes underneath them (issue #2173).
 *
 * A field keeps its own copy of what is in it so the editor is not saving to
 * disk on every keystroke, which means the copy can disagree with the document.
 * Undo is how that happens: it puts the document back without the field having
 * been touched.
 *
 * The stale box is the visible half. The half that costs work is the next
 * keystroke, which commits the copy and quietly puts the undone edit back, so
 * both are pinned here against the editor's real history.
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
import { NameField, TextField } from "./panels";

afterEach(cleanup);

/** The editor in miniature: one string of document, the real undo stack, and an
 *  Undo button standing in for the shortcut. */
function useEditor(initial: string) {
  const [document, setDocument] = useState(initial);
  const [history, setHistory] = useState<EditHistory<string>>(emptyHistory);

  return {
    document,
    edit(next: string) {
      setHistory(recordEdit(history, document, next));
      setDocument(next);
    },
    undo() {
      const step = undoEdit(history, document);
      if (!step) return;
      setHistory(step.history);
      setDocument(step.document);
    },
  };
}

function UndoButton({ onUndo }: { onUndo: () => void }) {
  return (
    <button type="button" onClick={onUndo}>
      Undo
    </button>
  );
}

function TextHarness({ initial }: { initial: string }) {
  const editor = useEditor(initial);
  return (
    <>
      <TextField
        value={editor.document}
        label="Objective text"
        onCommit={editor.edit}
      />
      <UndoButton onUndo={editor.undo} />
      <output>{editor.document}</output>
    </>
  );
}

/** Names `onRename` refuses outright, the way an already-taken one is. */
function NameHarness({
  initial,
  taken = [],
}: {
  initial: string;
  taken?: string[];
}) {
  const editor = useEditor(initial);
  return (
    <>
      <NameField
        name={editor.document}
        label="Objective name"
        onRename={(wanted) => {
          const trimmed = wanted.trim();
          if (!trimmed) return "An objective needs a name";
          if (taken.includes(trimmed)) {
            return `A name called ${trimmed} already exists`;
          }
          editor.edit(trimmed);
          return null;
        }}
      />
      <UndoButton onUndo={editor.undo} />
      <output>{editor.document}</output>
    </>
  );
}

/** One more character on the end of whatever the box is showing, which is what
 *  somebody carrying on typing produces. */
function typeOneMore(field: HTMLElement) {
  fireEvent.change(field, { target: { value: `${asInput(field).value}!` } });
  fireEvent.blur(field);
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** What the document holds, which the harness puts on screen so a test can read
 *  it the way the rest of the editor would. */
const documentText = () => screen.getByRole("status").textContent;

describe("a panel's text field when the document moves under it", () => {
  it("shows the value an undo put back", () => {
    render(<TextHarness initial="Hold the ridge" />);
    const field = screen.getByLabelText("Objective text");

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(asInput(field).value).toBe("Hold the ridge");
  });

  it("does not write the undone value back on the next keystroke", () => {
    render(<TextHarness initial="Hold the ridge" />);
    const field = screen.getByLabelText("Objective text");

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    typeOneMore(field);

    expect(documentText()).toBe("Hold the ridge!");
  });
});

describe("a panel's name field when the document moves under it", () => {
  it("shows the name an undo put back", () => {
    render(<NameHarness initial="reach-ridge" />);
    const field = screen.getByLabelText("Objective name");

    fireEvent.change(field, { target: { value: "renamed" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(asInput(field).value).toBe("reach-ridge");
  });

  it("does not write the undone name back on the next keystroke", () => {
    render(<NameHarness initial="reach-ridge" />);
    const field = screen.getByLabelText("Objective name");

    fireEvent.change(field, { target: { value: "renamed" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    typeOneMore(field);

    expect(documentText()).toBe("reach-ridge!");
  });
});

/**
 * Why a rename was refused (issue #2275). The field used to answer with
 * silence: the box reverted and nothing on screen said which rule it broke.
 */
describe("a panel's name field when the rename is refused", () => {
  it("shows the reason and puts the old name back for a name already taken", () => {
    render(<NameHarness initial="reach-ridge" taken={["hold-ridge"]} />);
    const field = screen.getByLabelText("Objective name");

    fireEvent.change(field, { target: { value: "hold-ridge" } });
    fireEvent.blur(field);

    expect(asInput(field).value).toBe("reach-ridge");
    const message = screen.getByText("A name called hold-ridge already exists");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("shows the reason for an empty name", () => {
    render(<NameHarness initial="reach-ridge" />);
    const field = screen.getByLabelText("Objective name");

    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);

    expect(asInput(field).value).toBe("reach-ridge");
    expect(screen.getByText("An objective needs a name")).toBeTruthy();
  });

  it("clears the reason as soon as the field is edited again", () => {
    render(<NameHarness initial="reach-ridge" taken={["hold-ridge"]} />);
    const field = screen.getByLabelText("Objective name");

    fireEvent.change(field, { target: { value: "hold-ridge" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "hold-the-line" } });

    expect(
      screen.queryByText("A name called hold-ridge already exists"),
    ).toBeNull();
    expect(field.getAttribute("aria-invalid")).toBe("false");
  });

  it("clears the reason once a valid rename commits", () => {
    render(<NameHarness initial="reach-ridge" taken={["hold-ridge"]} />);
    const field = screen.getByLabelText("Objective name");

    fireEvent.change(field, { target: { value: "hold-ridge" } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: "first-wave" } });
    fireEvent.blur(field);

    expect(documentText()).toBe("first-wave");
    expect(
      screen.queryByText("A name called hold-ridge already exists"),
    ).toBeNull();
    expect(field.getAttribute("aria-invalid")).toBe("false");
  });
});
