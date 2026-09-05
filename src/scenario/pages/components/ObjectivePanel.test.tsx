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

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "@/lib/scenarioEditing/history";
import type { Scenario, ScenarioObjective, ScenarioTrigger } from "../../model";
import { ObjectivePanel } from "./ObjectivePanel";
import { missionProblemsIn } from "./useMissionProblems";

// The panel's delete notice has no shell here (issue #2280), the same gap
// `ScenarioBuilderPage.dom.test.tsx` fills for its own toasts. Captured rather
// than rendered, so a test can read the message and fire the action the way a
// click on the toast's own Undo button would.
const toasted = vi.hoisted(() => ({
  calls: [] as {
    message: string;
    id: string;
    action: { onClick: () => void };
  }[],
}));
vi.mock("sonner", () => ({
  toast: (
    message: string,
    opts: { id: string; action: { onClick: () => void } },
  ) => {
    toasted.calls.push({ message, id: opts.id, action: opts.action });
  },
}));

afterEach(() => {
  cleanup();
  toasted.calls.length = 0;
});

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
  // Read at the moment a step is taken rather than at the last render, the
  // same reason ScenarioEditPage keeps its own copies: a delete's notice binds
  // `onUndo` at the click that fires it, and firing the notice's action later
  // must see the document that delete produced, not whatever this closure held
  // when the button was drawn.
  const documentRef = useRef(document);
  documentRef.current = document;
  const historyRef = useRef(history);
  historyRef.current = history;

  // Shared by the harness's own Undo button and by `onUndo`, so a test that
  // fires a toast's action is exercising the exact function Cmd+Z and the map
  // toolbar call, not a lookalike (issue #2280).
  const stepBack = () => {
    const step = undoEdit(historyRef.current, documentRef.current);
    if (!step) return;
    setHistory(step.history);
    setDocument(step.document);
  };

  return (
    <>
      <ObjectivePanel
        scenario={document}
        onChange={(next) => {
          setHistory(recordEdit(history, document, next));
          setDocument(next);
        }}
        onUndo={stepBack}
        issues={[]}
      />
      <button type="button" onClick={stepBack}>
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

/** Duplicating an objective from the panel (issue #2278). The copy logic
 *  itself is pinned in `registries.test.ts`. This is what only the panel can
 *  get wrong: selection and undo. */
describe("duplicating an objective", () => {
  const duplicate = () =>
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));

  it("adds the copy right after the original and selects it, ready to edit", () => {
    openPanel([objective(), objective({ id: "escort", text: "Escort them." })]);

    duplicate();

    expect(stored().objectives.map((o) => o.id)).toEqual([
      "hold",
      "objective-1",
      "escort",
    ]);
    expect((textBox() as HTMLInputElement).value).toBe("Hold the pad.");
  });

  it("is one undo step", () => {
    openPanel([objective()]);

    duplicate();
    undo();

    expect(stored().objectives.map((o) => o.id)).toEqual(["hold"]);
  });
});

/**
 * Deleting an objective from the panel has no confirm dialog and no undo
 * button of its own nearby (issue #2280). The notice this fires names what
 * went, and its own action is the page's real undo, so the objective comes
 * back whether an author clicks that action or presses Cmd+Z instead.
 */
describe("deleting an objective", () => {
  const del = () =>
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

  it("names the objective by its text in the notice", () => {
    openPanel([objective({ text: "Hold the pad." })]);

    del();

    expect(toasted.calls).toHaveLength(1);
    expect(toasted.calls[0].message).toBe('Deleted objective "Hold the pad.".');
  });

  it("falls back to the id when the objective has no text yet", () => {
    openPanel([objective({ id: "hold", text: "" })]);

    del();

    expect(toasted.calls[0].message).toBe('Deleted objective "hold".');
  });

  it("is undoable through Cmd+Z alone, with no toast involved", () => {
    openPanel([objective()]);

    del();
    undo();

    expect(stored().objectives.map((o) => o.id)).toEqual(["hold"]);
  });

  it("restores the objective when the notice's own action is used", () => {
    openPanel([objective()]);

    del();
    act(() => toasted.calls[0].action.onClick());

    expect(stored().objectives.map((o) => o.id)).toEqual(["hold"]);
  });

  it("uses one fixed notice id so several deletes in a row replace it rather than stacking", () => {
    openPanel([
      objective({ id: "hold", text: "Hold the pad." }),
      objective({ id: "escort", text: "Escort them." }),
    ]);

    del();
    fireEvent.click(screen.getByRole("button", { name: /Escort them\./ }));
    del();

    expect(toasted.calls).toHaveLength(2);
    expect(toasted.calls[0].id).toBe(toasted.calls[1].id);
    expect(toasted.calls[0].message).not.toBe(toasted.calls[1].message);
  });
});

/**
 * An objective with no text, which `checkText` in validate.ts reports (issue
 * #2339, extending #2287's pattern to a field the objectives panel already
 * has). The issues here come from the real validator (`missionProblemsIn`),
 * not a hand-built one, so this is pinned against what the drawer would say
 * too.
 */
describe("an objective's text the validator has flagged", () => {
  function ProblemHarness() {
    const [document, setDocument] = useState<Scenario>(() =>
      scenario([objective({ text: "" })]),
    );
    const issues = useMemo(() => {
      const found = missionProblemsIn(document);
      return [...found.blocking, ...found.warnings];
    }, [document]);

    return (
      <ObjectivePanel
        scenario={document}
        onChange={setDocument}
        onUndo={() => {}}
        issues={issues}
      />
    );
  }

  it("shows the warning next to the text field without marking it invalid", () => {
    render(<ProblemHarness />);
    fireEvent.click(screen.getByRole("button", { name: /^Objectives/ }));

    const field = textBox();
    const message = screen.getByText(
      "no text, so the objectives panel shows a blank line",
    );

    expect(field.getAttribute("aria-describedby")).toBe(message.id);
    // checkText only ever reports a warning: the mission still plays with a
    // blank line, so this must not claim the text was refused.
    expect(field.getAttribute("aria-invalid")).toBeNull();
  });
});
