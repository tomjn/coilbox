// @vitest-environment happy-dom
/**
 * A base's own team pointing at a participant the setup no longer has (issue
 * #2307, extending #2287's pattern from the Triggers panel). The issue here
 * comes from the real validator (`missionProblemsIn`), not a hand-built one,
 * so this is pinned against what the drawer would say too.
 *
 * The compiled mission spells a base "prefabs" (see `PART` in `validate.ts`),
 * which is what `entryFieldProblem` is asked about in `BaseControls`. This is
 * the one place that spelling is exercised end to end, through the real
 * validator rather than a hand-built issue naming the compiled key directly.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newScenario } from "../../create";
import { baseBuildings, type Scenario } from "../../model";
import { BaseControls } from "./BaseControls";
import { missionProblemsIn } from "./useMissionProblems";

// The drawer is the app shell's, so it is stubbed for the conversion panel
// this pulls in. Nothing here opens it.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

afterEach(cleanup);

function withGhostTeam(): Scenario {
  const base = newScenario("Demo");
  return {
    ...base,
    setup: { ...base.setup, participants: [] },
    blueprints: [
      {
        id: "layout",
        name: "Outpost",
        buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
      },
    ],
    bases: [
      {
        id: "outpost",
        blueprint: "layout",
        team: "ghost",
        origin: { x: 300, z: 300 },
        buildings: [],
      },
    ],
  };
}

function BaseHarness() {
  const [document, setDocument] = useState<Scenario>(withGhostTeam);
  const issues = useMemo(() => {
    const found = missionProblemsIn(document);
    return [...found.blocking, ...found.warnings];
  }, [document]);
  const base = document.bases[0];

  return (
    <BaseControls
      base={base}
      buildings={baseBuildings(document.blueprints, base)}
      index={0}
      layoutName="Outpost"
      ordered={false}
      sharedWith={0}
      sharedEdit={false}
      overlaps={[]}
      unstable={[]}
      tooDeep={[]}
      tooShallow={[]}
      absent={[]}
      onMap=""
      participants={document.setup.participants}
      units={[]}
      unitsLoading={false}
      sides={[]}
      gameArchive={undefined}
      moving={false}
      issues={issues}
      onEdit={(patch) =>
        setDocument((doc) => ({
          ...doc,
          bases: [{ ...doc.bases[0], ...patch }],
        }))
      }
      onRename={() => {}}
      onOrdered={() => {}}
      onMoveBuilding={() => {}}
      onPlay={() => {}}
      onSharedEdit={() => {}}
      onQueue={() => {}}
      onMove={() => {}}
      onSnapToGrid={() => {}}
      onSubstitute={() => {}}
      onDelete={() => {}}
    />
  );
}

describe("a base's own team the validator has flagged", () => {
  it("marks the team field invalid and says why, next to it", () => {
    render(<BaseHarness />);

    const field = screen.getByLabelText("Team");
    const message = screen.getByText('no team called "ghost"');

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });
});

/**
 * A base standing off the map, and its buildings standing off the map or
 * sharing an id with an actor (issue #2343). None of these names a control
 * `aria-invalid` can sit on, so each is a row-level note in the buildings
 * popover, in the validator's own words. A building's id is minted and shown
 * nowhere else in this popover, so a message about it is named "Building N".
 */
describe("a base and its buildings the validator has flagged", () => {
  function withBaseIssues(): Scenario {
    const base = newScenario("Demo");
    const team = base.setup.participants[0]?.id ?? "you";
    return {
      ...base,
      actors: [
        {
          id: "hero",
          unitDef: "armcom",
          team,
          pos: { x: 100, z: 100 },
          facing: 0,
        },
      ],
      blueprints: [
        {
          id: "layout",
          name: "Outpost",
          buildings: [
            { def: "armllt", offset: { x: 0, z: 0 }, facing: 0 },
            { def: "armllt", offset: { x: -500, z: 0 }, facing: 0 },
          ],
        },
      ],
      bases: [
        {
          id: "outpost",
          blueprint: "layout",
          team,
          origin: { x: 300, z: 300 },
          buildings: [{ id: "hero" }, {}],
        },
      ],
    };
  }

  function BaseIssuesHarness() {
    const [document] = useState<Scenario>(withBaseIssues);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document);
      return [...found.blocking, ...found.warnings];
    }, [document]);
    const base = document.bases[0];

    return (
      <BaseControls
        base={base}
        buildings={baseBuildings(document.blueprints, base)}
        index={0}
        layoutName="Outpost"
        ordered={false}
        sharedWith={0}
        sharedEdit={false}
        overlaps={[]}
        unstable={[]}
        tooDeep={[]}
        tooShallow={[]}
        absent={[]}
        onMap=""
        participants={document.setup.participants}
        units={[]}
        unitsLoading={false}
        sides={[]}
        gameArchive={undefined}
        moving={false}
        issues={issues}
        onEdit={() => {}}
        onRename={() => {}}
        onOrdered={() => {}}
        onMoveBuilding={() => {}}
        onPlay={() => {}}
        onSharedEdit={() => {}}
        onQueue={() => {}}
        onMove={() => {}}
        onSnapToGrid={() => {}}
        onSubstitute={() => {}}
        onDelete={() => {}}
      />
    );
  }

  it("names the building whose id collides with the actor's", () => {
    render(<BaseIssuesHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Outpost" }));

    expect(
      screen.getByText(
        'Building 1: "hero" already names an actor or another building, and a trigger naming it would reach only one of them.',
      ),
    ).toBeTruthy();
  });

  it("names the building standing off the map", () => {
    render(<BaseIssuesHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Outpost" }));

    expect(
      screen.getByText(
        "Building 2: -200,300 is off the map. Spring measures a map from its north-west corner, so x and z start at 0.",
      ),
    ).toBeTruthy();
  });
});

/**
 * A building's factory queue naming a unit type the game has not got (issue
 * #2346). The building's own `def` is left out on purpose: `absent` already
 * says that here, read off the same footprint marks the map draws in violet,
 * and this fixture keeps its own def known so only the queue note is under
 * test.
 */
describe("a base building's queue naming a unit the game has not got", () => {
  function withBadQueue(): Scenario {
    const base = newScenario("Demo");
    const team = base.setup.participants[0]?.id ?? "you";
    return {
      ...base,
      blueprints: [
        {
          id: "layout",
          name: "Outpost",
          buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
        },
      ],
      bases: [
        {
          id: "outpost",
          blueprint: "layout",
          team,
          origin: { x: 300, z: 300 },
          buildings: [{ queue: ["notaunit"] }],
        },
      ],
    };
  }

  function BadQueueHarness() {
    const [document] = useState<Scenario>(withBadQueue);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document, undefined, [
        { name: "armllt" },
      ]);
      return [...found.blocking, ...found.warnings];
    }, [document]);
    const base = document.bases[0];

    return (
      <BaseControls
        base={base}
        buildings={baseBuildings(document.blueprints, base)}
        index={0}
        layoutName="Outpost"
        ordered={false}
        sharedWith={0}
        sharedEdit={false}
        overlaps={[]}
        unstable={[]}
        tooDeep={[]}
        tooShallow={[]}
        absent={[]}
        onMap=""
        participants={document.setup.participants}
        units={[]}
        unitsLoading={false}
        sides={[]}
        gameArchive={undefined}
        moving={false}
        issues={issues}
        onEdit={() => {}}
        onRename={() => {}}
        onOrdered={() => {}}
        onMoveBuilding={() => {}}
        onPlay={() => {}}
        onSharedEdit={() => {}}
        onQueue={() => {}}
        onMove={() => {}}
        onSnapToGrid={() => {}}
        onSubstitute={() => {}}
        onDelete={() => {}}
      />
    );
  }

  it("names the building whose queue names the unknown unit", () => {
    render(<BadQueueHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Outpost" }));

    expect(
      screen.getByText(
        'Building 1: no unit type called "notaunit" in the game',
      ),
    ).toBeTruthy();
  });
});

/**
 * A building's own `def` naming a unit the game has not got, deliberately
 * left out of this popover's validator-driven notes (issue #2346). `absent`
 * (issue #1445) already says this, read off the same footprint marks the map
 * draws in violet, so a second sentence in the validator's own words would
 * only repeat it. The validator still flags the field, in the drawer, but
 * `BaseControls` does not say it twice next to the building.
 */
describe("a base building's own unit type the game has not got", () => {
  function withUnknownDef(): Scenario {
    const base = newScenario("Demo");
    const team = base.setup.participants[0]?.id ?? "you";
    return {
      ...base,
      blueprints: [
        {
          id: "layout",
          name: "Outpost",
          buildings: [{ def: "notaunit", offset: { x: 0, z: 0 }, facing: 0 }],
        },
      ],
      bases: [
        {
          id: "outpost",
          blueprint: "layout",
          team,
          origin: { x: 300, z: 300 },
          buildings: [{}],
        },
      ],
    };
  }

  function UnknownDefHarness() {
    const [document] = useState<Scenario>(withUnknownDef);
    const issues = useMemo(() => {
      const found = missionProblemsIn(document, undefined, [
        { name: "armllt" },
      ]);
      return [...found.blocking, ...found.warnings];
    }, [document]);
    const base = document.bases[0];

    return (
      <BaseControls
        base={base}
        buildings={baseBuildings(document.blueprints, base)}
        index={0}
        layoutName="Outpost"
        ordered={false}
        sharedWith={0}
        sharedEdit={false}
        overlaps={[]}
        unstable={[]}
        tooDeep={[]}
        tooShallow={[]}
        absent={[]}
        onMap=""
        participants={document.setup.participants}
        units={[]}
        unitsLoading={false}
        sides={[]}
        gameArchive={undefined}
        moving={false}
        issues={issues}
        onEdit={() => {}}
        onRename={() => {}}
        onOrdered={() => {}}
        onMoveBuilding={() => {}}
        onPlay={() => {}}
        onSharedEdit={() => {}}
        onQueue={() => {}}
        onMove={() => {}}
        onSnapToGrid={() => {}}
        onSubstitute={() => {}}
        onDelete={() => {}}
      />
    );
  }

  it("does not add a second, validator-driven note for the building's own def", () => {
    render(<UnknownDefHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Outpost" }));

    expect(screen.queryByText(/no unit type called "notaunit"/)).toBeNull();
  });
});

/**
 * The Queue button on a building the game says builds nothing.
 *
 * It used to be there and open onto one sentence explaining why there was
 * nothing behind it, which is a control that exists to say it does not work. A
 * storage tank is not a factory and the bar should not suggest it might be.
 *
 * With a queue already on it the button stays, because that is a document
 * written against a game that had those units, the validator complains about it,
 * and hiding the button would hide the only way to read or clear the thing being
 * complained about.
 */
describe("the queue button on a building that builds nothing", () => {
  /** A game with the base's own def in it, and nothing it can build. */
  const storageOnly = [
    { name: "armllt", buildOptions: [] },
  ] as unknown as ComponentProps<typeof BaseControls>["units"];

  function QueueHarness({ queue }: { queue?: string[] }) {
    const document = useMemo(() => {
      const base = withGhostTeam();
      return queue
        ? { ...base, bases: [{ ...base.bases[0], buildings: [{ queue }] }] }
        : base;
    }, [queue]);
    const base = document.bases[0];

    return (
      <BaseControls
        base={base}
        buildings={baseBuildings(document.blueprints, base)}
        index={0}
        layoutName="Outpost"
        ordered={false}
        sharedWith={0}
        sharedEdit={false}
        overlaps={[]}
        unstable={[]}
        tooDeep={[]}
        tooShallow={[]}
        absent={[]}
        onMap=""
        participants={document.setup.participants}
        units={storageOnly}
        unitsLoading={false}
        sides={[]}
        gameArchive={undefined}
        moving={false}
        issues={[]}
        onEdit={() => {}}
        onRename={() => {}}
        onOrdered={() => {}}
        onMoveBuilding={() => {}}
        onPlay={() => {}}
        onSharedEdit={() => {}}
        onQueue={() => {}}
        onMove={() => {}}
        onSnapToGrid={() => {}}
        onSubstitute={() => {}}
        onDelete={() => {}}
      />
    );
  }

  it("is not offered at all", () => {
    render(<QueueHarness />);

    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();
    // The rest of the bar is untouched, so this is the one button that went.
    expect(screen.getByRole("button", { name: /Outpost/ })).toBeTruthy();
  });

  it("is still offered when a queue is already on it, and says why it is wrong", () => {
    render(<QueueHarness queue={["armpw"]} />);

    const button = screen.getByRole("button", { name: /1 queued/ });
    fireEvent.click(button);

    expect(screen.getByText(/builds\s+nothing in this game/)).toBeTruthy();
    // And the queue itself is reachable, or there would be no way to clear it.
    expect(
      screen.getByRole("button", { name: "Take armpw out of the queue" }),
    ).toBeTruthy();
  });
});
