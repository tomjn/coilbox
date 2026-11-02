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
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "@/lib/scenarioEditing/history";
import type { Participant } from "@/play/config";
import { newScenario } from "../../create";
import type { GroupUnit, Scenario, ScenarioOrder } from "../../model";
import { GroupControls, OrderRow, UnitRow } from "./GroupControls";
import { MAX_GROUP_COUNT } from "./groups";
import { missionProblemsIn } from "./useMissionProblems";

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

/**
 * A group's own team, and one of its own orders, pointing at something the
 * document no longer has (issue #2307, extending #2287's pattern from the
 * Triggers panel). The issues here come from the real validator
 * (`missionProblemsIn`), not a hand-built one, so this is pinned against what
 * the drawer would say too.
 */
describe("a group's own fields the validator has flagged", () => {
  function withGhosts(): Scenario {
    const base = newScenario("Demo");
    return {
      ...base,
      setup: { ...base.setup, participants: [] },
      groups: [
        {
          id: "wave",
          team: "ghost",
          units: [{ def: "armpw", count: 2 }],
          pos: { x: 200, z: 200 },
          orders: [{ kind: "guard", target: "boss" }],
          dormant: false,
        },
      ],
    };
  }

  function GroupHarness() {
    const [document, setDocument] = useState<Scenario>(withGhosts);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document);
      return [...found.blocking, ...found.warnings];
    }, [document]);

    return (
      <GroupControls
        group={document.groups[0]}
        participants={document.setup.participants}
        units={[]}
        unitsLoading={false}
        targets={[]}
        issues={issues}
        onEdit={(patch) =>
          setDocument((doc) => ({
            ...doc,
            groups: [{ ...doc.groups[0], ...patch }],
          }))
        }
        onDelete={() => {}}
        drawing={null}
        onDraw={() => {}}
      />
    );
  }

  it("marks the team field invalid and says why, next to it", () => {
    render(<GroupHarness />);

    const field = screen.getByLabelText("Team");
    const message = screen.getByText('no team called "ghost"');

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("marks an order's target invalid and says why, next to it", () => {
    render(<GroupHarness />);
    fireEvent.click(screen.getByRole("button", { name: /order/i }));

    const field = screen.getByLabelText("Order target");
    const message = screen.getByText(
      'nothing called "boss" for an order to aim at',
    );

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });
});

/**
 * A group standing off the map (issue #2343). Its position is dragged on the
 * map rather than typed here, so there is no field for `aria-invalid` to sit
 * on: this is a row-level note in the units popover instead, in the
 * validator's own words.
 */
describe("a group standing off the map", () => {
  function withOffMapGroup(): Scenario {
    const base = newScenario("Demo");
    return {
      ...base,
      groups: [
        {
          id: "wave",
          team: base.setup.participants[0]?.id ?? "you",
          units: [{ def: "armpw", count: 2 }],
          pos: { x: -50, z: 100 },
          orders: [],
          dormant: false,
        },
      ],
    };
  }

  function OffMapHarness() {
    const [document] = useState<Scenario>(withOffMapGroup);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document);
      return [...found.blocking, ...found.warnings];
    }, [document]);

    return (
      <GroupControls
        group={document.groups[0]}
        participants={document.setup.participants}
        units={[]}
        unitsLoading={false}
        targets={[]}
        issues={issues}
        onEdit={() => {}}
        onDelete={() => {}}
        drawing={null}
        onDraw={() => {}}
      />
    );
  }

  it("says so in the units popover, in the validator's own words", () => {
    render(<OffMapHarness />);
    fireEvent.click(screen.getByRole("button", { name: /unit/i }));

    expect(
      screen.getByText(
        "-50,100 is off the map. Spring measures a map from its north-west corner, so x and z start at 0.",
      ),
    ).toBeTruthy();
  });
});

/**
 * Issue #900. Holding at the start is a choice about a group on the map, so a
 * dormant group does not offer it.
 */
describe("a group that holds position until woken", () => {
  function open(group: Partial<Scenario["groups"][number]>) {
    const edits: unknown[] = [];
    render(
      <GroupControls
        group={{
          id: "post",
          team: "you",
          units: [{ def: "armpw", count: 2 }],
          pos: { x: 100, z: 100 },
          orders: [],
          dormant: false,
          ...group,
        }}
        participants={[]}
        units={[]}
        unitsLoading={false}
        targets={[]}
        issues={[]}
        onEdit={(patch) => edits.push(patch)}
        onDelete={() => {}}
        drawing={null}
        onDraw={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unit/i }));
    return edits;
  }
  const hold = () =>
    screen.queryByRole("switch", { name: "Holds position until woken" });

  it("sets the flag when it is switched on", () => {
    const edits = open({});
    fireEvent.click(hold() as HTMLElement);
    expect(edits).toEqual([{ startsAsleep: true }]);
  });

  it("takes the flag away when it is switched off", () => {
    const edits = open({ startsAsleep: true });
    fireEvent.click(hold() as HTMLElement);
    expect(edits).toEqual([{ startsAsleep: undefined }]);
  });

  it("is not offered on a dormant group", () => {
    open({ dormant: true });
    expect(hold()).toBeNull();
  });
});

/**
 * Issue #903. A hunt names a participant rather than a target, out of everybody
 * playing but the group's own side.
 */
describe("an order to hunt a participant", () => {
  const participants = [
    { id: "you", name: "Commander", color: [0, 0, 1], spectator: false },
    { id: "raiders", name: "Raiders", color: [1, 0, 0], spectator: false },
  ] as Participant[];

  function open(orders: ScenarioOrder[]) {
    const edits: { orders?: ScenarioOrder[] }[] = [];
    render(
      <GroupControls
        group={{
          id: "hunters",
          team: "raiders",
          units: [{ def: "armpw", count: 2 }],
          pos: { x: 100, z: 100 },
          orders,
          dormant: false,
        }}
        participants={participants}
        units={[]}
        unitsLoading={false}
        targets={[]}
        issues={[]}
        onEdit={(patch) => edits.push(patch)}
        onDelete={() => {}}
        drawing={null}
        onDraw={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /order/i }));
    return edits;
  }

  it("names the team it hunts and has no map drawing", () => {
    open([{ kind: "hunt", team: "you" }]);
    expect(
      screen.getByRole("combobox", { name: "Team to hunt" }).textContent,
    ).toContain("Commander");
    expect(screen.queryByRole("button", { name: "Draw" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Order target" })).toBeNull();
  });

  it("offers everybody but the group's own side", () => {
    const edits = open([{ kind: "hunt", team: "" }]);
    fireEvent.click(screen.getByRole("combobox", { name: "Team to hunt" }));
    expect(screen.queryByRole("option", { name: "Raiders" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Commander" }));
    expect(edits).toEqual([{ orders: [{ kind: "hunt", team: "you" }] }]);
  });

  it("shows what the validator says about the team", () => {
    render(
      <OrderRow
        order={{ kind: "hunt", team: "gone" }}
        targets={[]}
        teams={[]}
        drawing={false}
        problem={'no team called "gone"'}
        onDraw={() => {}}
        onChange={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('no team called "gone"')).toBeTruthy();
  });
});

/**
 * One of a group's own unit rows naming a def the game has not got (issue
 * #2346). The picker sets the def once and adds a row rather than editing
 * one, so this is a row-level note under that row too, in the validator's own
 * words.
 */
describe("a group unit whose type the game has not got", () => {
  function withUnknownUnit(): Scenario {
    const base = newScenario("Demo");
    return {
      ...base,
      groups: [
        {
          id: "wave",
          team: base.setup.participants[0]?.id ?? "you",
          units: [{ def: "notaunit", count: 2 }],
          pos: { x: 200, z: 200 },
          orders: [],
          dormant: false,
        },
      ],
    };
  }

  function UnknownUnitHarness() {
    const [document] = useState<Scenario>(withUnknownUnit);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document, undefined, [
        { name: "armcom" },
      ]);
      return [...found.blocking, ...found.warnings];
    }, [document]);

    return (
      <GroupControls
        group={document.groups[0]}
        participants={document.setup.participants}
        units={[]}
        unitsLoading={false}
        targets={[]}
        issues={issues}
        onEdit={() => {}}
        onDelete={() => {}}
        drawing={null}
        onDraw={() => {}}
      />
    );
  }

  it("says so under the unit row, in the validator's own words", () => {
    render(<UnknownUnitHarness />);
    fireEvent.click(screen.getByRole("button", { name: /unit/i }));

    expect(
      screen.getByText('no unit type called "notaunit" in the game'),
    ).toBeTruthy();
  });
});
