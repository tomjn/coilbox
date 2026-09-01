// @vitest-environment happy-dom
/**
 * A trigger's name and its cooldown against a document that changes underneath
 * them (issue #2185).
 *
 * The same drift `panels.test.tsx` and `TriggerSteps.test.tsx` pin, in the two
 * boxes the trigger form has of its own. Each keeps its own copy of what is in
 * it so the editor is not saving to disk on every keystroke, an undo puts the
 * document back without touching the box, and the next keystroke commits the
 * copy and takes the undo with it.
 *
 * Driven through the whole panel rather than through the two fields on their
 * own, because the form is mounted keyed by the trigger's id. That key is the
 * name box's value, so a rename remounts the form and reseeds the name box
 * while leaving every other box in it alone. A test that mounted the name field
 * by itself would be testing an arrangement the editor never puts it in.
 *
 * Their commit rules are pinned alongside, because the resync must not quietly
 * change them: a name that is empty or already taken is refused and the old one
 * put back, and a cooldown that is empty or not a positive number clears the
 * wait rather than storing a nonsense one.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NO_EXTENSIONS } from "../../extensions";
import { NO_GATE } from "../../gating";
import type { Scenario, ScenarioTrigger } from "../../model";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";
import { TriggerPanel } from "./TriggerPanel";

afterEach(cleanup);

function trigger(patch: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  return {
    id: "wave-one",
    enabled: true,
    repeat: false,
    conditions: { op: "all", conditions: [] },
    actions: [],
    ...patch,
  };
}

function scenario(triggers: ScenarioTrigger[]): Scenario {
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
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The editor in miniature: one scenario, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function PanelHarness({ triggers }: { triggers: ScenarioTrigger[] }) {
  const [document, setDocument] = useState(() => scenario(triggers));
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);

  return (
    <>
      <TriggerPanel
        scenario={document}
        onChange={(next) => {
          setHistory(recordEdit(history, document, next));
          setDocument(next);
        }}
        units={[]}
        unitsLoading={false}
        gate={NO_GATE}
        extensions={NO_EXTENSIONS}
        note={null}
        picking={null}
        onPick={() => {}}
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
      <output>{JSON.stringify(document.triggers)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(triggers: ScenarioTrigger[]) {
  render(<PanelHarness triggers={triggers} />);
  fireEvent.click(screen.getByRole("button", { name: /^Triggers/ }));
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** The triggers the document holds, which the harness puts on screen so a test
 *  can read them the way the rest of the editor would. */
const stored = (): ScenarioTrigger[] =>
  JSON.parse(screen.getByRole("status").textContent ?? "[]");

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

/** One more character on the end of whatever the box is showing, which is what
 *  somebody carrying on typing produces. */
function typeOneMore(field: HTMLElement) {
  commit(field, `${asInput(field).value}!`);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const nameBox = () => screen.getByLabelText("Trigger name");
const cooldownBox = () => screen.getByLabelText("Waits");

describe("a trigger's name when the document moves under it", () => {
  it("shows the name an undo put back", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);

    commit(nameBox(), "first-wave");
    undo();

    expect(asInput(nameBox()).value).toBe("wave-one");
  });

  it("does not write the undone name back on the next keystroke", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);

    commit(nameBox(), "first-wave");
    undo();
    typeOneMore(nameBox());

    expect(stored().map((t) => t.id)).toEqual(["wave-one!", "wave-two"]);
  });
});

describe("a trigger's name commit rules", () => {
  it("carries the actions that named it over to the new name", () => {
    openPanel([
      trigger({ id: "wave-one" }),
      trigger({
        id: "opener",
        actions: [{ type: "enable_trigger", params: { trigger: "wave-one" } }],
      }),
    ]);

    commit(nameBox(), "first-wave");

    expect(stored()[1].actions[0].params).toEqual({ trigger: "first-wave" });
  });

  it("puts the name back when the box is emptied", () => {
    openPanel([trigger({ id: "wave-one" })]);

    commit(nameBox(), "   ");

    expect(asInput(nameBox()).value).toBe("wave-one");
    expect(stored().map((t) => t.id)).toEqual(["wave-one"]);
  });

  it("puts the name back when another trigger already has it", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);

    commit(nameBox(), "wave-two");

    expect(asInput(nameBox()).value).toBe("wave-one");
    expect(stored().map((t) => t.id)).toEqual(["wave-one", "wave-two"]);
  });
});

describe("a trigger's cooldown when the document moves under it", () => {
  it("shows the wait an undo put back", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "90");
    undo();

    expect(asInput(cooldownBox()).value).toBe("30");
  });

  it("does not write the undone wait back on the next keystroke", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "90");
    undo();
    // One more digit on the end of whatever the box is showing.
    commit(cooldownBox(), `${asInput(cooldownBox()).value}1`);

    expect(stored()[0].cooldown).toBe(301);
  });

  it("shows an empty box again when an undo takes the wait away", () => {
    openPanel([trigger({ repeat: true })]);

    commit(cooldownBox(), "45");
    undo();

    expect(asInput(cooldownBox()).value).toBe("");
  });
});

describe("a trigger's cooldown commit rules", () => {
  it("clears the wait when the box is emptied", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "");

    expect(stored()[0].cooldown).toBeUndefined();
    expect(asInput(cooldownBox()).value).toBe("");
  });

  it("clears the wait rather than storing a number that is not positive", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "-5");

    expect(stored()[0].cooldown).toBeUndefined();
    expect(asInput(cooldownBox()).value).toBe("");
  });
});
