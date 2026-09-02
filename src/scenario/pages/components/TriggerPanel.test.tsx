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
 * own, because both the drift and which trigger is under the cursor are
 * properties of the panel around them. A test that mounted the name field by
 * itself would be testing an arrangement the editor never puts it in.
 *
 * Their commit rules are pinned alongside, because the resync must not quietly
 * change them: an empty name is refused and the old one put back, and a cooldown
 * that is empty or not a positive number clears the wait rather than storing a
 * nonsense one.
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
import { NO_EXTENSIONS } from "../../extensions";
import { NO_GATE } from "../../gating";
import type { Scenario, ScenarioTrigger, ScenarioZone } from "../../model";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  redoEdit,
  undoEdit,
} from "./history";
import { TriggerPanel } from "./TriggerPanel";
import { setStepParam } from "./triggers";
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

/**
 * A longer budget than the 5000ms default, and this one is mitigation rather
 * than a fix (issue #2215).
 *
 * Nothing here is slow by accident. A rename that is accepted changes the
 * trigger's id, the id is the form's React key, so the whole form remounts, and
 * mounting it once costs about 160ms under happy-dom because it carries a Radix
 * select and a switch. "follows the rename forward again when it is redone" does
 * four of those remounts and measured 753ms run on its own. Under the full suite
 * in parallel the same test measured 5483ms and failed the default budget.
 *
 * That budget was never a statement about the panel. It was a race against
 * whatever else the machine happened to be doing, and every test in this file is
 * synchronous, so a real hang would block the event loop and never trip a
 * timeout anyway. The number below is 40 times the measured 753ms, which leaves
 * it able to catch a test that has stopped without failing one that is only
 * waiting its turn.
 *
 * What this stands in for is in `TriggerPanel` itself, which remounts the entire
 * form to rename a trigger.
 */
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  cleanup();
  toasted.calls.length = 0;
});

function trigger(patch: Partial<ScenarioTrigger> = {}): ScenarioTrigger {
  const id = patch.id ?? "wave-one";
  return {
    id,
    name: id,
    enabled: true,
    repeat: false,
    conditions: { op: "all", conditions: [] },
    actions: [],
    ...patch,
  };
}

function scenario(
  triggers: ScenarioTrigger[],
  zones: ScenarioZone[] = [],
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
    zones,
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
function PanelHarness({
  triggers,
  zones = [],
}: {
  triggers: ScenarioTrigger[];
  zones?: ScenarioZone[];
}) {
  const [document, setDocument] = useState(() => scenario(triggers, zones));
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

  // The real validator's own answer, not a hand-built issue, so a test that
  // pins the panel against it is pinned against what the drawer would show
  // too (issue #2287). No debounce: `useMissionProblems` only adds one to
  // avoid validating every keystroke, which this harness's synchronous edits
  // have no need of.
  const issues = useMemo(() => {
    const found = missionProblemsIn(document);
    return [...found.blocking, ...found.warnings];
  }, [document]);

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
        issues={issues}
        picking={null}
        onPick={() => {}}
        onUndo={stepBack}
      />
      <button type="button" onClick={stepBack}>
        Undo
      </button>
      <button
        type="button"
        onClick={() => {
          const step = redoEdit(history, document);
          if (!step) return;
          setHistory(step.history);
          setDocument(step.document);
        }}
      >
        Redo
      </button>
      <output>{JSON.stringify(document.triggers)}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(triggers: ScenarioTrigger[], zones: ScenarioZone[] = []) {
  render(<PanelHarness triggers={triggers} zones={zones} />);
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

const redo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));

/** Click a trigger in the list, the way an author picks the one to work on.
 *  The rows read as the author named them, so that is what they are found by. */
const select = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

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

    expect(stored().map((t) => t.name)).toEqual(["wave-one!", "wave-two"]);
  });
});

describe("a trigger's name commit rules", () => {
  /** The point of issue #2205, seen from the panel. A rename is a label change
   *  and nothing else, so nothing else in the document moves. */
  it("leaves the actions that point at it alone", () => {
    openPanel([
      trigger({ id: "wave-one" }),
      trigger({
        id: "opener",
        actions: [{ type: "enable_trigger", params: { trigger: "wave-one" } }],
      }),
    ]);

    commit(nameBox(), "first-wave");

    expect(stored()[0].id).toBe("wave-one");
    expect(stored()[1].actions[0].params).toEqual({ trigger: "wave-one" });
  });

  it("puts the name back when the box is emptied", () => {
    openPanel([trigger({ id: "wave-one" })]);

    commit(nameBox(), "   ");

    expect(asInput(nameBox()).value).toBe("wave-one");
    expect(stored().map((t) => t.name)).toEqual(["wave-one"]);
  });

  it("takes a name another trigger already has", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);

    commit(nameBox(), "wave-two");

    expect(asInput(nameBox()).value).toBe("wave-two");
    expect(stored().map((t) => t.name)).toEqual(["wave-two", "wave-two"]);
    expect(stored().map((t) => t.id)).toEqual(["wave-one", "wave-two"]);
  });
});

/**
 * Why an empty name was refused (issue #2275). The field used to answer with
 * silence: the box reverted and nothing on screen said the row needs a label.
 */
describe("a trigger's name when the rename is refused", () => {
  it("shows the reason next to the field", () => {
    openPanel([trigger({ id: "wave-one" })]);

    commit(nameBox(), "   ");

    const message = screen.getByText("A trigger needs a name");
    expect(nameBox().getAttribute("aria-invalid")).toBe("true");
    expect(nameBox().getAttribute("aria-describedby")).toBe(message.id);
  });

  it("clears the reason as soon as the field is edited again", () => {
    openPanel([trigger({ id: "wave-one" })]);

    commit(nameBox(), "   ");
    fireEvent.change(nameBox(), { target: { value: "first-wave" } });

    expect(screen.queryByText("A trigger needs a name")).toBeNull();
    expect(nameBox().getAttribute("aria-invalid")).toBe("false");
  });

  it("clears the reason once a valid rename commits", () => {
    openPanel([trigger({ id: "wave-one" })]);

    commit(nameBox(), "   ");
    commit(nameBox(), "first-wave");

    expect(stored()[0].name).toBe("first-wave");
    expect(screen.queryByText("A trigger needs a name")).toBeNull();
    expect(nameBox().getAttribute("aria-invalid")).toBe("false");
  });
});

/**
 * Which trigger the panel is on after a rename is stepped over (issue #2202).
 *
 * The selection used to be held by name, and a rename changed the name, so an
 * undo left the panel holding a name the document no longer had. It showed the
 * first trigger in the list instead, and the author carried on typing into a
 * trigger they had not picked. The selection is an id now (issue #2205), and no
 * rename moves an id, so these are the cases that bug was found through rather
 * than a live hazard. They stay because the selection is still resolved
 * somewhere, and this is what the answer has to be.
 */
describe("which trigger the panel is on when a rename is stepped over", () => {
  it("goes back to the trigger that was renamed", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    commit(nameBox(), "second-wave");
    undo();

    expect(asInput(nameBox()).value).toBe("wave-two");
  });

  it("edits the trigger that was renamed, not the first one", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    commit(nameBox(), "second-wave");
    undo();
    typeOneMore(nameBox());

    expect(stored().map((t) => t.name)).toEqual(["wave-one", "wave-two!"]);
  });

  // First in the list is the answer the old fallback gave for every trigger, so
  // this case came out right for the wrong reason. Pinned so a change to how
  // the selection is resolved cannot break it quietly.
  it("stays on the renamed trigger when it is first in the list", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);

    commit(nameBox(), "first-wave");
    undo();
    typeOneMore(nameBox());

    expect(stored().map((t) => t.name)).toEqual(["wave-one!", "wave-two"]);
  });

  it("follows the rename forward again when it is redone", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    commit(nameBox(), "second-wave");
    undo();
    redo();

    expect(asInput(nameBox()).value).toBe("second-wave");
  });

  it("shows no form when an undo takes the selected trigger away", () => {
    openPanel([trigger({ id: "wave-one" })]);

    fireEvent.click(screen.getByRole("button", { name: /New trigger/ }));
    undo();

    expect(screen.queryByLabelText("Trigger name")).toBeNull();
    expect(stored().map((t) => t.name)).toEqual(["wave-one"]);
  });
});

/**
 * What the stable id closes on its own (issue #2205). Deleting a trigger used to
 * clear the selection outright, so undoing the delete put the trigger back and
 * left the author on whichever one happened to be first. The id outlives the
 * delete, so the selection can stay on it and the undo lands where the author
 * was.
 */
describe("which trigger the panel is on when one is deleted", () => {
  const del = () =>
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

  it("shows no form once the trigger it was on has gone", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    del();

    expect(screen.queryByLabelText("Trigger name")).toBeNull();
    expect(stored().map((t) => t.id)).toEqual(["wave-one"]);
  });

  it("goes back to the deleted trigger when the delete is undone", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    del();
    undo();

    expect(asInput(nameBox()).value).toBe("wave-two");
  });
});

/**
 * Deleting a trigger from the panel has no confirm dialog and no undo button
 * of its own nearby (issue #2280). The notice this fires names the trigger,
 * and its own action is the page's real undo, so the trigger comes back
 * whether an author clicks that action or presses Cmd+Z instead.
 */
describe("deleting a trigger's notice", () => {
  const del = () =>
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

  it("names the trigger in the notice", () => {
    openPanel([trigger({ id: "wave-one" })]);

    del();

    expect(toasted.calls).toHaveLength(1);
    expect(toasted.calls[0].message).toBe('Deleted trigger "wave-one".');
  });

  it("is undoable through Cmd+Z alone, with no toast involved", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    del();
    undo();

    expect(asInput(nameBox()).value).toBe("wave-two");
  });

  it("restores the trigger when the notice's own action is used", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-two");

    del();
    act(() => toasted.calls[0].action.onClick());

    expect(asInput(nameBox()).value).toBe("wave-two");
  });

  it("uses one fixed notice id so several deletes in a row replace it rather than stacking", () => {
    openPanel([
      trigger({ id: "wave-one" }),
      trigger({ id: "wave-two" }),
      trigger({ id: "wave-three" }),
    ]);

    del();
    del();

    expect(toasted.calls).toHaveLength(2);
    expect(toasted.calls[0].id).toBe(toasted.calls[1].id);
    expect(toasted.calls[0].message).not.toBe(toasted.calls[1].message);
  });
});

/**
 * Duplicating a trigger from the panel (issue #2278). The logic that builds
 * the copy is pinned in `triggers.test.ts`. This is the part only the panel
 * can get wrong: which trigger ends up selected, and how undo unwinds it.
 */
describe("duplicating a trigger", () => {
  const duplicate = () =>
    fireEvent.click(screen.getByRole("button", { name: /Duplicate/ }));

  it("adds the copy right after the original and selects it, ready to edit", () => {
    openPanel([trigger({ id: "wave-one" }), trigger({ id: "wave-two" })]);
    select("wave-one");

    duplicate();

    expect(stored().map((t) => t.id)).toEqual([
      "wave-one",
      "trigger-1",
      "wave-two",
    ]);
    expect(asInput(nameBox()).value).toBe("Copy of wave-one");
  });

  // Duplicating selects the copy, the same way "New trigger" selects what it
  // just added, so one undo removes it in one step and leaves the selection
  // on an id that no longer resolves. That is the same shape as undoing a new
  // trigger ("shows no form when an undo takes the selected trigger away",
  // above): the panel shows no form rather than guessing an author meant to
  // land back on the trigger the copy was made from.
  it("is one undo step: the copy is gone and the panel shows no form", () => {
    openPanel([trigger({ id: "wave-one" })]);
    select("wave-one");

    duplicate();
    undo();

    expect(stored().map((t) => t.id)).toEqual(["wave-one"]);
    expect(screen.queryByLabelText("Trigger name")).toBeNull();
  });

  it("redoes the duplicate back in when redone", () => {
    openPanel([trigger({ id: "wave-one" })]);
    select("wave-one");

    duplicate();
    undo();
    redo();

    expect(stored().map((t) => t.id)).toEqual(["wave-one", "trigger-1"]);
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

/**
 * Why a wait was refused (issue #2275). Emptying the box is a deliberate
 * clear and stays silent. A number that cannot be a wait, such as one that is
 * not positive, now says so next to the field instead of just vanishing.
 */
describe("a trigger's cooldown when the value is refused", () => {
  it("shows the reason next to the field for a number that is not positive", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "-5");

    const message = screen.getByText("Cooldown is a number of seconds");
    expect(cooldownBox().getAttribute("aria-invalid")).toBe("true");
    expect(cooldownBox().getAttribute("aria-describedby")).toBe(message.id);
  });

  it("says nothing when the box is emptied on purpose", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "");

    expect(screen.queryByText("Cooldown is a number of seconds")).toBeNull();
    expect(cooldownBox().getAttribute("aria-invalid")).toBe("false");
  });

  it("clears the reason as soon as the field is edited again", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "-5");
    fireEvent.change(cooldownBox(), { target: { value: "60" } });

    expect(screen.queryByText("Cooldown is a number of seconds")).toBeNull();
    expect(cooldownBox().getAttribute("aria-invalid")).toBe("false");
  });

  it("clears the reason once a valid wait commits", () => {
    openPanel([trigger({ repeat: true, cooldown: 30 })]);

    commit(cooldownBox(), "-5");
    commit(cooldownBox(), "60");

    expect(stored()[0].cooldown).toBe(60);
    expect(screen.queryByText("Cooldown is a number of seconds")).toBeNull();
    expect(cooldownBox().getAttribute("aria-invalid")).toBe("false");
  });
});

/**
 * A trigger's condition pointing at a zone the document no longer has (issue
 * #2287). The validator caught this before this panel said anything about
 * it: the zone dropdown just showed nothing picked, with no hint that this is
 * why the mission refuses to launch. The issues here come from the real
 * validator (`missionProblemsIn`), not a hand-built one, so this is pinned
 * against what the drawer would say too.
 */
describe("a trigger's condition pointing at a zone the document no longer has", () => {
  function zone(id: string): ScenarioZone {
    return {
      id,
      name: id,
      shape: "box",
      min: { x: 0, z: 0 },
      max: { x: 10, z: 10 },
    };
  }

  const zoneField = "Units in zone zone";

  /** A trigger whose only condition names a zone, and a button standing in
   *  for the panel's own zone picker: driving a Radix `Select` open in
   *  happy-dom is avoided project-wide (see `TriggerStepGroups.test.tsx`), so
   *  fixing the reference is done the way `setStepParam` already is, which is
   *  the same write the picker itself makes. */
  function ZoneHarness({ zones }: { zones: ScenarioZone[] }) {
    const [document, setDocument] = useState<Scenario>(() =>
      scenario(
        [
          trigger({
            id: "wave-one",
            conditions: {
              op: "all",
              conditions: [
                { type: "units_in_zone", params: { zone: "north" } },
              ],
            },
          }),
        ],
        zones,
      ),
    );
    const issues = useMemo(() => {
      const found = missionProblemsIn(document);
      return [...found.blocking, ...found.warnings];
    }, [document]);

    return (
      <>
        <TriggerPanel
          scenario={document}
          onChange={setDocument}
          units={[]}
          unitsLoading={false}
          gate={NO_GATE}
          extensions={NO_EXTENSIONS}
          note={null}
          issues={issues}
          picking={null}
          onPick={() => {}}
          onUndo={() => {}}
        />
        <button
          type="button"
          onClick={() =>
            setDocument((doc) =>
              setStepParam(
                doc,
                { triggerId: "wave-one", list: "conditions", index: 0 },
                "zone",
                "south",
              ),
            )
          }
        >
          Point the condition at south instead
        </button>
        <output>{JSON.stringify(document.triggers)}</output>
      </>
    );
  }

  function openZonePanel(zones: ScenarioZone[]) {
    render(<ZoneHarness zones={zones} />);
    fireEvent.click(screen.getByRole("button", { name: /^Triggers/ }));
  }

  it("shows the validator's reason next to the zone field once the zone is gone", () => {
    // "north" is not among the document's zones, the state a delete leaves
    // the trigger's own condition in.
    openZonePanel([zone("south")]);

    const field = screen.getByLabelText(zoneField);
    const message = screen.getByText('no zone called "north"');

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("says nothing when the zone the condition names still exists", () => {
    openZonePanel([zone("north"), zone("south")]);

    expect(screen.queryByText('no zone called "north"')).toBeNull();
    expect(screen.getByLabelText(zoneField).getAttribute("aria-invalid")).toBe(
      "false",
    );
  });

  it("clears the moment the condition is pointed at a zone that exists", () => {
    openZonePanel([zone("south")]);
    expect(screen.getByText('no zone called "north"')).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Point the condition at south instead",
      }),
    );

    expect(screen.queryByText('no zone called "north"')).toBeNull();
    expect(screen.getByLabelText(zoneField).getAttribute("aria-invalid")).toBe(
      "false",
    );
    expect(stored()[0].conditions.conditions[0].params.zone).toBe("south");
  });
});
