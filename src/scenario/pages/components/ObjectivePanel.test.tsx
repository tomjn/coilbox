// @vitest-environment happy-dom
/**
 * What an objective's id is, seen from the panel (issue #2248).
 *
 * The id is what `complete_objective` and `fail_objective` point at, what the
 * compiled mission is addressed by, and what the mission problems list names an
 * objective by. So nothing here changes it. The author edits the text, which is
 * the line the player reads and the line the list and the trigger picker show.
 *
 * It used to be editable, and editing it rewrote every trigger that pointed at
 * the objective. That is the arrangement issue #2205 took away from triggers,
 * and these are the tests that say it is gone here too.
 *
 * Driven through the whole panel rather than through the fields on their own,
 * because which objective is under the cursor is a property of the panel around
 * them.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NO_EXTENSIONS } from "../../extensions";
import type { Scenario, ScenarioObjective, ScenarioTrigger } from "../../model";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";
import { ObjectivePanel } from "./ObjectivePanel";

afterEach(cleanup);

function objective(patch: Partial<ScenarioObjective> = {}): ScenarioObjective {
  return {
    id: "hold",
    kind: "primary",
    text: "Hold the pad.",
    hidden: false,
    ...patch,
  };
}

/** A trigger that settles the objective, so a test can read whether the
 *  reference moved. */
function completes(id: string): ScenarioTrigger {
  return {
    id: "t1",
    name: "t1",
    enabled: true,
    repeat: false,
    conditions: { op: "all", conditions: [] },
    actions: [{ type: "complete_objective", params: { objective: id } }],
  };
}

function scenario(
  objectives: ScenarioObjective[],
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
    objectives,
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** The editor in miniature: one scenario, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function PanelHarness({
  objectives,
  triggers,
}: {
  objectives: ScenarioObjective[];
  triggers: ScenarioTrigger[];
}) {
  const [document, setDocument] = useState(() =>
    scenario(objectives, triggers),
  );
  const [history, setHistory] = useState<EditHistory<Scenario>>(emptyHistory);

  return (
    <>
      <ObjectivePanel
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
      <output>{JSON.stringify(document)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(
  objectives: ScenarioObjective[],
  triggers: ScenarioTrigger[] = [],
) {
  render(<PanelHarness objectives={objectives} triggers={triggers} />);
  fireEvent.click(screen.getByRole("button", { name: /^Objectives/ }));
}

/** The document the harness puts on screen, so a test reads what was written
 *  rather than what the panel is showing. */
const stored = (): Scenario =>
  JSON.parse(screen.getByRole("status").textContent ?? "{}");

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const textBox = () => screen.getByLabelText("Objective text");

describe("an objective's id", () => {
  it("cannot be edited", () => {
    openPanel([objective()]);

    expect(screen.queryByLabelText("Objective name")).toBeNull();
  });

  it("is shown, so a mission problem naming one can be matched to it", () => {
    openPanel([objective()]);

    expect(screen.getByText("hold")).toBeTruthy();
  });

  it("stays where it is when the text is rewritten", () => {
    openPanel([objective()], [completes("hold")]);

    commit(textBox(), "Hold the landing pad for two minutes.");

    expect(stored().objectives[0].id).toBe("hold");
    expect(stored().objectives[0].text).toBe(
      "Hold the landing pad for two minutes.",
    );
  });

  /** The point of issue #2248. Nothing the panel does moves the string a
   *  trigger is holding. */
  it("leaves the trigger that completes it pointing at it", () => {
    openPanel([objective()], [completes("hold")]);

    commit(textBox(), "Hold the landing pad for two minutes.");

    expect(stored().triggers[0].actions[0].params.objective).toBe("hold");
  });
});

/**
 * Which objective the panel is on after an edit is stepped over. This is the
 * shape of issue #2202, which the trigger panel hit because a rename moved the
 * id the selection was held by. An id nothing renames means an undo puts back
 * an objective the selection still answers to.
 */
describe("which objective the panel is on when an edit is stepped over", () => {
  it("stays on the objective that was edited", () => {
    openPanel([objective(), objective({ id: "escort", text: "Escort them." })]);
    fireEvent.click(screen.getByRole("button", { name: /Escort them\./ }));

    commit(textBox(), "Escort the convoy.");
    undo();

    expect((textBox() as HTMLInputElement).value).toBe("Escort them.");
    expect(stored().objectives.map((o) => o.id)).toEqual(["hold", "escort"]);
  });
});
