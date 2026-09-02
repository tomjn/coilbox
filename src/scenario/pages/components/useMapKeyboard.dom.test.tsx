// @vitest-environment happy-dom
/**
 * The map driven from the keyboard, end to end (issue #2269).
 *
 * The scene itself needs a GPU, so what is mounted here is everything but: the
 * hook, a focusable element to press keys on, and the document it edits. That is
 * the whole keyboard interface. If a press stops selecting, stops moving, stops
 * announcing, or starts swallowing an undo, it fails here.
 *
 * The announcements are asserted as strings rather than as "something was said",
 * because for an author who cannot see the 3D view the string is the interface.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseFootprints, type Placement } from "@/placement/placements";
import type { PlaceKind } from "@/placement/preview";
import { newScenario } from "../../create";
import type { Point, Scenario } from "../../model";
import { addBase } from "./bases";
import { sceneContents } from "./contents";
import { addActor } from "./editing";
import { editedScenario } from "./edits";
import { addGroup, pathKey } from "./groups";
import { scenarioPaths } from "./orderPaths";
import { scenarioPlacements } from "./placements";
import { type MapSelection, primaryKey, selectOne } from "./selection";
import { useMapKeyboard } from "./useMapKeyboard";
import { addZone } from "./zones";

afterEach(cleanup);

/** An actor, a group and a base, which is one of everything the cycle walks
 *  except a zone. */
function laidOut(): Scenario {
  let doc = newScenario("Keys");
  doc = addActor(doc, "a1", {
    unitDef: "armcom",
    team: "player",
    pos: { x: 100, z: 200 },
    facing: 0,
  });
  doc = addGroup(doc, "g1", {
    team: "enemy",
    units: [{ def: "armpw", count: 3 }],
    pos: { x: 500, z: 600 },
    orders: [],
    dormant: false,
  });
  return addBase(doc, "b1", "bp1", {
    team: "enemy",
    origin: { x: 1000, z: 1000 },
    buildings: [
      { id: "u1", def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
    ],
  });
}

/** `laidOut`, plus one zone, for the tests that resize one from the keyboard
 *  (issue #2313). */
function withZone(): Scenario {
  return addZone(laidOut(), {
    id: "z1",
    name: "Landing site",
    shape: "circle",
    center: { x: 2000, z: 2000 },
    radius: 300,
  });
}

/** `laidOut`, with the group given a two-point move order, for the tests that
 *  reach a path's points from the keyboard (issue #2314). */
function withGroupPath(): Scenario {
  const doc = laidOut();
  return {
    ...doc,
    groups: [
      {
        ...doc.groups[0],
        orders: [
          {
            kind: "move",
            waypoints: [
              { x: 550, z: 600 },
              { x: 700, z: 650 },
            ],
          },
        ],
      },
    ],
  };
}

/** The drawn units, as the scene would report them. Only their names are read
 *  by the keys, so flattening the document is enough. */
function drawn(scenario: Scenario): Placement[] {
  return [
    ...scenario.actors.map<Placement>((actor) => ({
      key: `actor:${actor.id}`,
      kind: "actor",
      id: actor.id,
      index: 0,
      def: actor.unitDef,
      team: actor.team,
      pos: actor.pos,
      facing: actor.facing,
    })),
    ...scenario.groups.map<Placement>((group) => ({
      key: `group:${group.id}#0`,
      kind: "group",
      id: group.id,
      index: 0,
      def: group.units[0]?.def ?? "",
      team: group.team,
      pos: group.pos,
      facing: 0,
    })),
    ...scenario.bases.map<Placement>((base) => ({
      key: `base:${base.id}#0`,
      kind: "base",
      id: base.id,
      index: 0,
      def: "armsolar",
      team: base.team,
      pos: base.origin,
      facing: 0,
    })),
  ];
}

/** The map in miniature: the hook, something to press keys on, and everything
 *  it reports written out where a test can read it. */
function Harness({
  initial,
  onPlace,
  placing = { kind: "arm" },
  startSelection = [],
}: {
  initial: Scenario;
  onPlace?: (pos: Point) => void;
  /** What a click would do, the same as `ScenarioMapScene` works out from
   *  `drawingPath`, `moving` and `picking` (issue #2359). Defaults to
   *  whatever is armed, which is what every test but the ones about this
   *  needs. */
  placing?: PlaceKind;
  /** What is selected before a key is pressed, so a test can start from a
   *  selection the pointer would have built (issue #2279). */
  startSelection?: string[];
}) {
  const [scenario, setScenario] = useState(initial);
  const [selection, setSelection] = useState<MapSelection>(startSelection);
  const selected = primaryKey(selection);
  // The camera's target, moved by the pan the keys ask for.
  const view = useRef<Point>({ x: 4096, z: 4096 });
  // No game and no ground read in this harness, so a mark only ever pins the
  // overlap check, which needs neither (issue #2315).
  const footprintsAt = useCallback(
    (doc: Scenario) => baseFootprints(scenarioPlacements(doc), [], null),
    [],
  );

  const keys = useMapKeyboard({
    things: {
      scenario,
      entries: sceneContents(scenario),
      placements: drawn(scenario),
      paths: scenarioPaths(scenario),
    },
    onChange: (edit) => setScenario((doc) => editedScenario(doc, edit)),
    selection,
    onSelect: (key) => setSelection(selectOne(key)),
    onEntry: (entry) => setSelection(selectOne(entry.key)),
    onPlace: onPlace ?? null,
    placing,
    snap: undefined,
    layoutEdit: () => "own",
    cursorAt: () => ({ pos: view.current, height: 128 }),
    panBy: (delta) => {
      view.current = {
        x: view.current.x + delta.x,
        z: view.current.z + delta.z,
      };
    },
    footprintsAt,
  });

  return (
    <>
      <div
        data-testid="map"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the surface's own working area, in miniature (issue #2269).
        tabIndex={0}
        role="application"
        aria-label="Scenario map"
        onKeyDown={keys.onKeyDown}
        onFocus={keys.onFocus}
      >
        <input data-testid="field" aria-label="A field over the map" />
      </div>
      <p data-testid="said">{keys.said.text}</p>
      <p data-testid="cursor">{keys.cursor}</p>
      <p data-testid="selected">{selected ?? "none"}</p>
      <p data-testid="actor">
        {scenario.actors[0]
          ? `${scenario.actors[0].pos.x},${scenario.actors[0].pos.z},${scenario.actors[0].facing}`
          : "gone"}
      </p>
      <p data-testid="zone">
        {scenario.zones[0] && scenario.zones[0].shape === "circle"
          ? scenario.zones[0].radius
          : "gone"}
      </p>
      <p data-testid="path">
        {(() => {
          const order = scenario.groups[0]?.orders[0];
          return order && "waypoints" in order
            ? order.waypoints.map((p) => `${p.x},${p.z}`).join(" ")
            : "gone";
        })()}
      </p>
    </>
  );
}

const map = () => screen.getByTestId("map");
const said = () => screen.getByTestId("said").textContent;
const selected = () => screen.getByTestId("selected").textContent;
const actor = () => screen.getByTestId("actor").textContent;
const zone = () => screen.getByTestId("zone").textContent;
const path = () => screen.getByTestId("path").textContent;

describe("choosing what the keys act on", () => {
  it("selects the first thing on the map and says what it is", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });

    expect(selected()).toBe("actor:a1");
    expect(said()).toBe(
      "actor, armcom, facing south, at x 100, z 200. 1 of 3.",
    );
  });

  it("steps on to the next thing, and back", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });

    expect(selected()).toBe("group:g1#0");

    fireEvent.keyDown(map(), { key: "," });

    expect(selected()).toBe("actor:a1");
  });

  it("says so rather than going quiet when there is nothing to step to", () => {
    render(<Harness initial={newScenario("Empty")} />);
    fireEvent.keyDown(map(), { key: "." });

    expect(said()).toContain("Nothing on the map yet");
  });
});

describe("moving what is selected", () => {
  function withActorSelected() {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
  }

  it("moves one build square east on an arrow", () => {
    withActorSelected();
    fireEvent.keyDown(map(), { key: "ArrowRight" });

    expect(actor()).toBe("116,200,0");
    expect(said()).toBe("Moved 16 east, now at x 116, z 200.");
  });

  it("moves north, which is z running the other way", () => {
    withActorSelected();
    fireEvent.keyDown(map(), { key: "ArrowUp" });

    expect(actor()).toBe("100,184,0");
  });

  it("takes ten squares with Shift and one elmo with Alt", () => {
    withActorSelected();
    fireEvent.keyDown(map(), { key: "ArrowRight", shiftKey: true });

    expect(actor()).toBe("260,200,0");

    fireEvent.keyDown(map(), { key: "ArrowRight", altKey: true });

    expect(actor()).toBe("261,200,0");
  });

  it("turns a quarter turn on R and back on Shift R", () => {
    withActorSelected();
    fireEvent.keyDown(map(), { key: "r" });

    expect(actor()).toBe("100,200,1");
    expect(said()).toBe("Facing east.");

    fireEvent.keyDown(map(), { key: "R", shiftKey: true });

    expect(actor()).toBe("100,200,0");
  });

  it("deletes it and lets go of the selection", () => {
    withActorSelected();
    fireEvent.keyDown(map(), { key: "Delete" });

    expect(actor()).toBe("gone");
    expect(selected()).toBe("none");
    expect(said()).toBe("Deleted actor, armcom. Nothing selected.");
  });

  it("says a group does not turn rather than doing nothing quietly", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "r" });

    expect(said()).toContain("does not turn");
  });
});

describe("Escape", () => {
  it("lets go of the selection", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "Escape" });

    expect(selected()).toBe("none");
    expect(said()).toBe("Nothing selected.");
  });

  // The Bases mode puts down the building it is carrying on Escape, from a
  // listener outside React. One press does one thing, so the map stops the press
  // it used, and the next one, with nothing selected, reaches the mode.
  it("stops the press it used and lets the next one through", () => {
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
    outside.mockClear();

    fireEvent.keyDown(map(), { key: "Escape" });
    expect(outside).not.toHaveBeenCalled();

    fireEvent.keyDown(map(), { key: "Escape" });
    expect(outside).toHaveBeenCalledTimes(1);

    document.removeEventListener("keydown", outside);
  });
});

describe("resizing a zone from the keyboard (issue #2313)", () => {
  /** Cycles onto the zone: actors, groups and bases come first in the
   *  contents list, so the zone `withZone` adds is the fourth thing. */
  function withZoneSelected() {
    render(<Harness initial={withZone()} />);
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });
    expect(selected()).toBe("zone:z1");
  }

  it("moves the zone on an arrow before S is pressed, the same as anything else selected", () => {
    withZoneSelected();
    fireEvent.keyDown(map(), { key: "ArrowRight" });

    expect(zone()).toBe("300");
    expect(said()).toContain("Moved 16 east");
  });

  it("switches what the arrows do on S, and says so with the current size", () => {
    withZoneSelected();
    fireEvent.keyDown(map(), { key: "s" });

    expect(said()).toBe(
      "Resize mode, radius 300 elmos. Arrows change its size instead of its position: " +
        "north and east make it bigger, south and west make it smaller. Press S again for move.",
    );
  });

  it("grows the zone on an arrow once resize mode is on, and leaves its position alone", () => {
    withZoneSelected();
    fireEvent.keyDown(map(), { key: "s" });
    fireEvent.keyDown(map(), { key: "ArrowUp" });

    expect(zone()).toBe("316");
    expect(said()).toBe("Grew 16, now radius 316 elmos.");
  });

  it("shrinks the zone on south or west", () => {
    withZoneSelected();
    fireEvent.keyDown(map(), { key: "s" });
    fireEvent.keyDown(map(), { key: "ArrowDown" });

    expect(zone()).toBe("284");
    expect(said()).toBe("Shrank 16, now radius 284 elmos.");
  });

  it("switches back to move on a second S", () => {
    withZoneSelected();
    fireEvent.keyDown(map(), { key: "s" });
    fireEvent.keyDown(map(), { key: "s" });

    expect(said()).toBe("Move mode. Arrows move it again.");

    fireEvent.keyDown(map(), { key: "ArrowRight" });
    expect(zone()).toBe("300");
    expect(said()).toContain("Moved 16 east");
  });

  it("drops resize mode when the selection changes, so it never resizes something else", () => {
    withZoneSelected();
    fireEvent.keyDown(map(), { key: "s" });
    fireEvent.keyDown(map(), { key: "." }); // wraps round to the actor
    expect(selected()).toBe("actor:a1");

    fireEvent.keyDown(map(), { key: "ArrowRight" });

    expect(actor()).toBe("116,200,0");
    expect(said()).toContain("Moved 16 east");
  });
});

describe("reaching a path's points from a selected group (issue #2314)", () => {
  /** Cycles onto the group's first point: actor, then group, then the point. */
  function withPointSelected() {
    render(<Harness initial={withGroupPath()} />);
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });
    fireEvent.keyDown(map(), { key: "." });
    expect(selected()).toBe(pathKey("g1", 0, 0));
  }

  it("steps from the group onto its first point, naming which point of how many", () => {
    withPointSelected();

    expect(said()).toBe("Group 1, point 1 of 2, at x 550, z 600. 2 of 3.");
  });

  it("steps on to the path's next point, then off it onto the base", () => {
    withPointSelected();
    fireEvent.keyDown(map(), { key: "." });

    expect(selected()).toBe(pathKey("g1", 0, 1));
    expect(said()).toContain("Group 1, point 2 of 2");

    fireEvent.keyDown(map(), { key: "." });

    expect(selected()).toBe("base:b1#0");
  });

  it("steps backwards from the base onto the path's last point, then the group", () => {
    render(<Harness initial={withGroupPath()} />);
    fireEvent.keyDown(map(), { key: "," }); // wraps to the base, the last thing

    expect(selected()).toBe("base:b1#0");

    fireEvent.keyDown(map(), { key: "," });
    expect(selected()).toBe(pathKey("g1", 0, 1));

    fireEvent.keyDown(map(), { key: "," });
    expect(selected()).toBe(pathKey("g1", 0, 0));

    fireEvent.keyDown(map(), { key: "," });
    expect(selected()).toBe("group:g1#0");
  });

  it("moves the point an arrow names, using the move already wired to a point (issue #2314)", () => {
    withPointSelected();
    fireEvent.keyDown(map(), { key: "ArrowRight" });

    expect(path()).toBe("566,600 700,650");
    expect(said()).toContain("Moved 16 east");
  });

  it("deletes the point Delete names and lands on nothing, the same as anything else", () => {
    withPointSelected();
    fireEvent.keyDown(map(), { key: "Delete" });

    expect(path()).toBe("700,650");
    expect(selected()).toBe("none");
  });

  it("lets go of the whole selection on Escape, the same one step as anywhere else on the ring", () => {
    withPointSelected();
    fireEvent.keyDown(map(), { key: "Escape" });

    expect(selected()).toBe("none");
    expect(said()).toBe("Nothing selected.");
  });

  it("does not resize a point on S, since only a zone is resizable", () => {
    withPointSelected();
    fireEvent.keyDown(map(), { key: "s" });
    const before = said();
    fireEvent.keyDown(map(), { key: "ArrowUp" });

    // The arrow still moved the point rather than nothing happening, which is
    // what it would do had S put the point into a resize mode meant for zones.
    expect(said()).not.toBe(before);
    expect(said()).toContain("Moved");
  });
});

describe("the view's own cursor", () => {
  it("moves on an arrow when nothing is selected, and says where it is", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "ArrowRight" });

    expect(said()).toBe(
      "east 16. Cursor at x 4112, z 4096, ground height 128.",
    );
    expect(screen.getByTestId("cursor").textContent).toBe("x 4112, z 4096");
  });

  it("places at the cursor on Enter", () => {
    const placed = vi.fn();
    render(<Harness initial={laidOut()} onPlace={placed} />);
    fireEvent.keyDown(map(), { key: "Enter" });

    expect(placed).toHaveBeenCalledWith({ x: 4096, z: 4096 });
    expect(said()).toBe("Placed at x 4096, z 4096.");
  });

  it("says why Enter did nothing in a mode that places nothing", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "Enter" });

    expect(said()).toContain("places nothing here");
  });

  it("names the path point added and which one of how many, off the document rather than the keypress (issue #2359)", () => {
    const placed = vi.fn();
    render(
      <Harness
        initial={withGroupPath()}
        onPlace={placed}
        placing={{ kind: "path", groupId: "g1", order: 0 }}
      />,
    );
    fireEvent.keyDown(map(), { key: "Enter" });

    expect(placed).toHaveBeenCalledWith({ x: 4096, z: 4096 });
    // withGroupPath starts with 2 points, so the one Enter adds is the 3rd of
    // 3 -- a number this reads off the order, not one the test predicts from
    // nothing (issue #2359).
    expect(said()).toBe("Added Group 1, point 3 of 3.");
  });

  it("says a base's origin moved, at where it actually landed on the build grid (issue #2359)", () => {
    const placed = vi.fn();
    render(
      <Harness
        initial={laidOut()}
        onPlace={placed}
        placing={{ kind: "moving", baseId: "b1" }}
      />,
    );
    fireEvent.keyDown(map(), { key: "Enter" });

    expect(placed).toHaveBeenCalledWith({ x: 4096, z: 4096 });
    expect(said()).toBe("Moved the base's origin, now at x 4104, z 4104.");
  });

  it("says a trigger's question is answered, not that something was placed (issue #2359)", () => {
    const placed = vi.fn();
    render(
      <Harness
        initial={laidOut()}
        onPlace={placed}
        placing={{ kind: "picking" }}
      />,
    );
    fireEvent.keyDown(map(), { key: "Enter" });

    expect(placed).toHaveBeenCalledWith({ x: 4096, z: 4096 });
    expect(said()).toBe("Answered the question at x 4096, z 4096.");
  });
});

describe("keys the map does not take", () => {
  it("leaves an undo alone", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
    const before = said();

    fireEvent.keyDown(map(), { key: "z", metaKey: true });

    expect(said()).toBe(before);
  });

  it("leaves a field over the map to its own keys", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "." });
    const before = said();

    fireEvent.keyDown(screen.getByTestId("field"), { key: "Delete" });

    expect(said()).toBe(before);
    expect(actor()).toBe("100,200,0");
  });

  it("reads the key list out on a question mark", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "?" });

    expect(said()).toContain("Arrow keys move what is selected");
  });
});

describe("reading the whole map's problems on demand (issue #2315)", () => {
  it("reads the tally through the same live region, with nothing selected", () => {
    render(<Harness initial={laidOut()} />);
    fireEvent.keyDown(map(), { key: "p" });

    // No ground and no game units in this harness, so the one building this
    // document holds is unchecked rather than refused.
    expect(said()).toBe(
      "1 building, and it can be built where it stands. It has not been checked against the ground.",
    );
  });

  it("says nothing built yet on an empty map", () => {
    render(<Harness initial={newScenario("Empty")} />);
    fireEvent.keyDown(map(), { key: "p" });

    expect(said()).toBe("Nothing built yet.");
  });
});

/**
 * The keys acting on a selection the pointer built (issue #2279).
 *
 * The selection is handed to the harness rather than made here, because there is
 * no key that builds one: `.` and `,` replace the selection, and a selection is
 * grown with a Shift-click on the map or on a Contents row. What these pin is
 * the other half, that every key which acts on the selection acts on all of it
 * and says so in one sentence rather than three.
 */
describe("a selection of more than one", () => {
  const three = ["actor:a1", "group:g1#0", "base:b1#0"];

  it("moves all of it on an arrow, and counts rather than naming", () => {
    render(<Harness initial={laidOut()} startSelection={three} />);
    fireEvent.keyDown(map(), { key: "ArrowRight" });

    expect(said()).toBe("Moved 3 things 16 east.");
    expect(actor()).toBe("116,200,0");
  });

  it("deletes all of it on Delete, and says what went", () => {
    render(<Harness initial={laidOut()} startSelection={three} />);
    fireEvent.keyDown(map(), { key: "Delete" });

    expect(said()).toBe(
      "Deleted 3: 1 actor, 1 group and 1 base building. Nothing selected.",
    );
    expect(actor()).toBe("gone");
    expect(selected()).toBe("none");
  });

  it("turns what turns and says how much did not", () => {
    render(<Harness initial={laidOut()} startSelection={three} />);
    fireEvent.keyDown(map(), { key: "r" });

    expect(said()).toBe("Turned 2. 1 does not turn.");
    expect(actor()).toBe("100,200,1");
  });

  it("says nothing turned when nothing in the selection can", () => {
    render(<Harness initial={laidOut()} startSelection={["group:g1#0"]} />);
    fireEvent.keyDown(map(), { key: "r" });

    expect(said()).toBe("This does not turn. A group's units all face south.");
  });

  it("lets go of the whole thing on Escape", () => {
    render(<Harness initial={laidOut()} startSelection={three} />);
    fireEvent.keyDown(map(), { key: "Escape" });

    expect(said()).toBe("Nothing selected.");
    expect(selected()).toBe("none");
  });

  it("replaces the selection when the list is stepped through, from the last one chosen", () => {
    render(<Harness initial={laidOut()} startSelection={three} />);
    // The primary is the base, which is the last entry, so stepping on wraps to
    // the first. Nothing of the other two is left selected.
    fireEvent.keyDown(map(), { key: "." });

    expect(selected()).toBe("actor:a1");
    expect(said()).toContain("1 of 3");

    fireEvent.keyDown(map(), { key: "Delete" });
    expect(said()).toBe("Deleted actor, armcom. Nothing selected.");
  });
});
