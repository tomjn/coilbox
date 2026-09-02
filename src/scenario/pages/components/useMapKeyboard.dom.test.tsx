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
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Placement } from "@/placement/placements";
import { newScenario } from "../../create";
import type { Point, Scenario } from "../../model";
import { addBase } from "./bases";
import { sceneContents } from "./contents";
import { addActor } from "./editing";
import { editedScenario } from "./edits";
import { addGroup } from "./groups";
import { useMapKeyboard } from "./useMapKeyboard";

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
}: {
  initial: Scenario;
  onPlace?: (pos: Point) => void;
}) {
  const [scenario, setScenario] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  // The camera's target, moved by the pan the keys ask for.
  const view = useRef<Point>({ x: 4096, z: 4096 });

  const keys = useMapKeyboard({
    things: {
      scenario,
      entries: sceneContents(scenario),
      placements: drawn(scenario),
      paths: [],
    },
    onChange: (edit) => setScenario((doc) => editedScenario(doc, edit)),
    selected,
    onSelect: setSelected,
    onEntry: (entry) => setSelected(entry.key),
    onPlace: onPlace ?? null,
    snap: undefined,
    layoutEdit: () => "own",
    cursorAt: () => ({ pos: view.current, height: 128 }),
    panBy: (delta) => {
      view.current = {
        x: view.current.x + delta.x,
        z: view.current.z + delta.z,
      };
    },
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
    </>
  );
}

const map = () => screen.getByTestId("map");
const said = () => screen.getByTestId("said").textContent;
const selected = () => screen.getByTestId("selected").textContent;
const actor = () => screen.getByTestId("actor").textContent;

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
