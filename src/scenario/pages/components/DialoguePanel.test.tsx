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
import { NO_EXTENSIONS } from "../../extensions";
import type { Scenario, ScenarioDialogue } from "../../model";
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

function scenario(dialogue: ScenarioDialogue[]): Scenario {
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
    dialogue,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The editor in miniature: one scenario, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function PanelHarness({ dialogue }: { dialogue: ScenarioDialogue[] }) {
  const [document, setDocument] = useState(() => scenario(dialogue));
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);

  return (
    <>
      <DialoguePanel
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
      <output>{JSON.stringify(document.dialogue)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(dialogue: ScenarioDialogue[]) {
  render(<PanelHarness dialogue={dialogue} />);
  fireEvent.click(screen.getByRole("button", { name: /^Dialogue/ }));
}

function asTextarea(field: HTMLElement): HTMLTextAreaElement {
  return field as HTMLTextAreaElement;
}

/** The lines the document holds, which the harness puts on screen so a test can
 *  read them the way the rest of the editor would. */
const stored = (): ScenarioDialogue[] =>
  JSON.parse(screen.getByRole("status").textContent ?? "[]");

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const textBox = () => screen.getByLabelText("What is said");

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
