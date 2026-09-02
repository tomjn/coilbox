// @vitest-environment happy-dom
/**
 * A dialogue line's words against a document that changes underneath them
 * (issue #2185).
 *
 * The same drift `panels.test.tsx` pins for the panel fields, in the box a line
 * is written in. It keeps its own copy of the words so the editor is not saving
 * to disk on every keystroke, an undo puts the document back without touching
 * the box, and the next keystroke commits the copy and takes the undo with it.
 *
 * Driven through the whole panel, because the form is mounted keyed by the
 * line's id and the words are not the id. Selecting another line remounts the
 * form and reseeds the box, so this only shows with the same line still
 * selected.
 *
 * Its commit rules are pinned alongside, because the resync must not quietly
 * change them: what was typed is written as typed rather than trimmed, since a
 * blank line beneath a portrait is a pause somebody may well have meant, and
 * nothing is written at all when the words have not changed.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Scenario, ScenarioDialogue, ScenarioTrigger } from "../../model";
import { DialoguePanel } from "./DialoguePanel";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";

afterEach(cleanup);

function line(patch: Partial<ScenarioDialogue> = {}): ScenarioDialogue {
  return { id: "opening", speaker: "Control", text: "Move out.", ...patch };
}

/** A trigger that plays the line, so a test can read whether the reference
 *  moved. */
function plays(id: string): ScenarioTrigger {
  return {
    id: "t1",
    name: "t1",
    enabled: true,
    repeat: false,
    conditions: { op: "all", conditions: [] },
    actions: [{ type: "dialogue", params: { line: id } }],
  };
}

function scenario(
  dialogue: ScenarioDialogue[],
  triggers: ScenarioTrigger[] = [],
): Scenario {
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
    triggers,
    objectives: [],
    dialogue,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The editor in miniature: one scenario, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function PanelHarness({
  dialogue,
  triggers,
}: {
  dialogue: ScenarioDialogue[];
  triggers: ScenarioTrigger[];
}) {
  const [document, setDocument] = useState(() => scenario(dialogue, triggers));
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);

  return (
    <>
      <DialoguePanel
        scenario={document}
        onChange={(next) => {
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
      <output>{JSON.stringify(document)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(
  dialogue: ScenarioDialogue[],
  triggers: ScenarioTrigger[] = [],
) {
  render(<PanelHarness dialogue={dialogue} triggers={triggers} />);
  fireEvent.click(screen.getByRole("button", { name: /^Dialogue/ }));
}

function asTextarea(field: HTMLElement): HTMLTextAreaElement {
  return field as HTMLTextAreaElement;
}

/** The document the harness puts on screen, so a test reads what was written
 *  rather than what the panel is showing. */
const storedDoc = (): Scenario =>
  JSON.parse(screen.getByRole("status").textContent ?? "{}");

/** The lines it holds, which is what most of these tests are about. */
const stored = (): ScenarioDialogue[] => storedDoc().dialogue;

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const textBox = () => screen.getByLabelText("What is said");

/**
 * What a line's id is, seen from the panel (issue #2248).
 *
 * The id is what a trigger's `dialogue` action plays and what the compiled
 * mission is addressed by. So nothing here changes it. The author edits the
 * speaker and the words, which is what the list and the trigger picker show.
 *
 * It used to be editable, and editing it rewrote every trigger that played the
 * line. That is the arrangement issue #2205 took away from triggers.
 */
describe("a dialogue line's id", () => {
  it("cannot be edited", () => {
    openPanel([line()]);

    expect(screen.queryByLabelText("Dialogue line name")).toBeNull();
  });

  it("is shown, so a mission problem naming one can be matched to it", () => {
    openPanel([line()]);

    expect(screen.getByText("opening")).toBeTruthy();
  });

  /** The point of issue #2248. Nothing the panel does moves the string a
   *  trigger is holding. */
  it("leaves the trigger that plays it pointing at it", () => {
    openPanel([line()], [plays("opening")]);

    commit(screen.getByLabelText("Speaker"), "HQ");

    expect(stored()[0].id).toBe("opening");
    expect(stored()[0].speaker).toBe("HQ");
    expect(storedDoc().triggers[0].actions[0].params.line).toBe("opening");
  });
});

describe("a dialogue line's words when the document moves under them", () => {
  it("shows the words an undo put back", () => {
    openPanel([line()]);

    commit(textBox(), "Hold position.");
    undo();

    expect(asTextarea(textBox()).value).toBe("Move out.");
  });

  it("does not write the undone words back on the next keystroke", () => {
    openPanel([line()]);

    commit(textBox(), "Hold position.");
    undo();
    commit(textBox(), `${asTextarea(textBox()).value}!`);

    expect(stored()[0].text).toBe("Move out.!");
  });
});

describe("a dialogue line's words commit rules", () => {
  it("writes what was typed rather than a trimmed version of it", () => {
    openPanel([line()]);

    commit(textBox(), "  Hold position.  ");

    expect(stored()[0].text).toBe("  Hold position.  ");
  });

  it("writes an emptied box, because a line with no words is allowed", () => {
    openPanel([line()]);

    commit(textBox(), "");

    expect(stored()[0].text).toBe("");
  });

  it("leaves the document alone when the words have not changed", () => {
    openPanel([line()]);

    commit(textBox(), "Move out.");
    undo();

    // Nothing was recorded, so there is nowhere to step back to and the line
    // still reads as it did.
    expect(stored()[0].text).toBe("Move out.");
  });
});

/** Duplicating a line from the panel (issue #2278). The copy logic itself is
 *  pinned in `registries.test.ts`. This is what only the panel can get wrong:
 *  selection and undo. */
describe("duplicating a dialogue line", () => {
  const duplicate = () =>
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));

  it("adds the copy right after the original and selects it, ready to edit", () => {
    openPanel([line(), line({ id: "closing", speaker: "HQ", text: "Out." })]);

    duplicate();

    expect(stored().map((d) => d.id)).toEqual(["opening", "line-1", "closing"]);
    expect(asTextarea(textBox()).value).toBe("Move out.");
    expect((screen.getByLabelText("Speaker") as HTMLInputElement).value).toBe(
      "Control",
    );
  });

  it("is one undo step", () => {
    openPanel([line()]);

    duplicate();
    undo();

    expect(stored().map((d) => d.id)).toEqual(["opening"]);
  });
});
