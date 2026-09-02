// @vitest-environment happy-dom
/**
 * A trigger step's typed parameters against a document that changes underneath
 * them (issue #2175).
 *
 * The same drift `panels.test.tsx` pins for the panel fields, in the two boxes a
 * step's parameters are typed into. Each keeps its own copy of the parameter so
 * the editor is not saving to disk on every keystroke, an undo puts the document
 * back without touching the box, and the next keystroke commits the copy and
 * takes the undo with it.
 *
 * These two have rules of their own that the panel field has not got, so those
 * are pinned here as well: the text box trims what it writes, and either box
 * emptied clears an optional parameter rather than writing a blank one. A
 * required parameter is never cleared, because an empty required parameter is a
 * document that will not load.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NO_EXTENSIONS } from "../../extensions";
import type { Scenario, ScenarioParam } from "../../model";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";
import { StepRow } from "./TriggerSteps";
import type { StepList } from "./triggers";

afterEach(cleanup);

/** What the step is stored as: a bag of parameters by name. */
type Params = Record<string, ScenarioParam>;

function scenario(): Scenario {
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
  };
}

/** The editor in miniature: one step's parameters, the real undo stack, and an
 *  Undo button standing in for the shortcut. */
function StepHarness({
  type,
  params,
  list = "actions",
}: {
  type: string;
  params: Params;
  list?: StepList;
}) {
  const [document, setDocument] = useState<Params>(params);
  const [history, setHistory] = useState<EditHistory<Params>>(emptyHistory);

  const edit = (next: Params) => {
    setHistory(recordEdit(history, document, next));
    setDocument(next);
  };

  return (
    <>
      <StepRow
        step={{ type, params: document }}
        at={{ triggerId: "t1", list, index: 0 }}
        scenario={scenario()}
        extensions={NO_EXTENSIONS}
        unsupported={undefined}
        units={[]}
        unitsLoading={false}
        issues={[]}
        picking={null}
        onPick={() => {}}
        onParam={(name, value) => {
          const next = { ...document };
          if (value === undefined) delete next[name];
          else next[name] = value;
          edit(next);
        }}
        onMove={null}
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
      <output>{JSON.stringify(document)}</output>
    </>
  );
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** What the parameters hold, which the harness puts on screen so a test can
 *  read it the way the rest of the editor would. */
const stored = (): Params =>
  JSON.parse(screen.getByRole("status").textContent ?? "{}");

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

describe("a trigger step's text parameter when the document moves under it", () => {
  it("shows the value an undo put back", () => {
    render(<StepHarness type="play_sound" params={{ sound: "horn" }} />);
    const field = screen.getByLabelText("Play sound sound");

    commit(field, "klaxon");
    undo();

    expect(asInput(field).value).toBe("horn");
  });

  it("does not write the undone value back on the next keystroke", () => {
    render(<StepHarness type="play_sound" params={{ sound: "horn" }} />);
    const field = screen.getByLabelText("Play sound sound");

    commit(field, "klaxon");
    undo();
    typeOneMore(field);

    expect(stored()).toEqual({ sound: "horn!" });
  });

  it("shows an optional parameter an undo put back after it was cleared", () => {
    render(
      <StepHarness
        type="map_marker"
        params={{ pos: { x: 1, z: 2 }, text: "Rally here" }}
      />,
    );
    const field = screen.getByLabelText("Map marker text");

    commit(field, "");
    undo();

    expect(asInput(field).value).toBe("Rally here");
  });
});

describe("a trigger step's text parameter commit rules", () => {
  it("trims what it writes", () => {
    render(<StepHarness type="play_sound" params={{ sound: "horn" }} />);
    const field = screen.getByLabelText("Play sound sound");

    commit(field, "  klaxon  ");

    expect(stored()).toEqual({ sound: "klaxon" });
  });

  it("takes an optional parameter out when the box is emptied", () => {
    render(
      <StepHarness
        type="map_marker"
        params={{ pos: { x: 1, z: 2 }, text: "Rally here" }}
      />,
    );

    commit(screen.getByLabelText("Map marker text"), "   ");

    expect(stored()).toEqual({ pos: { x: 1, z: 2 } });
  });

  it("puts a required parameter back when the box is emptied", () => {
    render(<StepHarness type="play_sound" params={{ sound: "horn" }} />);
    const field = screen.getByLabelText("Play sound sound");

    commit(field, "   ");

    expect(stored()).toEqual({ sound: "horn" });
    expect(asInput(field).value).toBe("horn");
  });
});

describe("a trigger step's number parameter when the document moves under it", () => {
  it("shows the value an undo put back", () => {
    render(
      <StepHarness
        type="time_elapsed"
        params={{ seconds: 30 }}
        list="conditions"
      />,
    );
    const field = screen.getByLabelText("Time elapsed seconds");

    commit(field, "90");
    undo();

    expect(asInput(field).value).toBe("30");
  });

  it("does not write the undone value back on the next keystroke", () => {
    render(
      <StepHarness
        type="time_elapsed"
        params={{ seconds: 30 }}
        list="conditions"
      />,
    );
    const field = screen.getByLabelText("Time elapsed seconds");

    commit(field, "90");
    undo();
    // One more digit on the end of whatever the box is showing.
    commit(field, `${asInput(field).value}1`);

    expect(stored()).toEqual({ seconds: 301 });
  });
});

describe("a trigger step's number parameter commit rules", () => {
  it("takes an optional parameter out when the box is emptied", () => {
    render(
      <StepHarness type="reveal_area" params={{ zone: "z1", seconds: 5 }} />,
    );

    commit(screen.getByLabelText("Reveal area seconds"), "");

    expect(stored()).toEqual({ zone: "z1" });
  });

  it("puts a required parameter back when the box is emptied", () => {
    render(
      <StepHarness
        type="time_elapsed"
        params={{ seconds: 30 }}
        list="conditions"
      />,
    );
    const field = screen.getByLabelText("Time elapsed seconds");

    commit(field, "");

    expect(stored()).toEqual({ seconds: 30 });
    expect(asInput(field).value).toBe("30");
  });
});
