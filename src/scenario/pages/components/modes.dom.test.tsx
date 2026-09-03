// @vitest-environment happy-dom
/**
 * Select mode's marquee, without a GPU (issue #2279).
 *
 * A mode is a hook, so what a drag across bare ground does can be driven
 * directly: hand it the drawn units, drag a box over them, and read back both
 * halves of what a marquee is. The rectangle it shows while the pointer is down
 * comes out as `draftZones`, which is the same seam Zones mode shows a
 * half-drawn zone through, and what it caught comes out as `onSelectMany`.
 *
 * The three.js half, turning a pointer into a point on the ground, is
 * `useMapEditing.ts` and needs a GPU. Everything below the ground point is
 * here.
 */

import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Placement } from "@/placement/placements";
import type { GestureKeys, GroundDragPhase } from "@/placement/useMapEditing";
import { newScenario } from "../../create";
import type { Point, Scenario, ScenarioZone } from "../../model";
import { EDITOR_MODES } from "./modes";
import type { PathSource } from "./orderPaths";

afterEach(cleanup);

// By id rather than by position. The editor opens in Pan now, so the marquee is
// no longer the first mode in the list and never was the point of that index.
const selectMode =
  EDITOR_MODES.find((mode) => mode.id === "select") ??
  (() => {
    throw new Error("no select mode to test the marquee on");
  })();

/** Three units in a line, so a box can be drawn round some of them. */
const drawn: Placement[] = [
  {
    key: "actor:a1",
    kind: "actor",
    id: "a1",
    index: 0,
    def: "armpw",
    team: "p0",
    pos: { x: 100, z: 100 },
    facing: 0,
  },
  {
    key: "actor:a2",
    kind: "actor",
    id: "a2",
    index: 0,
    def: "armpw",
    team: "p0",
    pos: { x: 300, z: 100 },
    facing: 0,
  },
  {
    key: "actor:a3",
    kind: "actor",
    id: "a3",
    index: 0,
    def: "armpw",
    team: "p0",
    pos: { x: 9000, z: 9000 },
    facing: 0,
  },
];

/** What one render of the mode gave back, so a test can drag with it and read
 *  what it drew. */
interface Seen {
  draw:
    | ((
        from: Point,
        to: Point,
        phase: GroundDragPhase,
        keys: GestureKeys,
      ) => void)
    | null;
  draftZones: ScenarioZone[] | undefined;
}

/** The mode, resolved, with everything it produced written out where the test
 *  can reach it. `scenario` and `paths` default to nothing to catch beyond
 *  `drawn`, and can be overridden to drive what the box has to test against
 *  (issue #2355). */
function drive(
  onSelectMany: (keys: string[], add: boolean) => void,
  scenario: Scenario = newScenario("Marquee"),
  paths: PathSource[] = [],
): {
  latest: () => Seen;
} {
  const seen: Seen = { draw: null, draftZones: undefined };
  function Harness() {
    const behaviour = selectMode.use({
      scenario,
      onChange: () => {},
      selected: null,
      selectedNow: () => null,
      onSelect: () => {},
      placements: drawn,
      paths,
      onSelectMany,
      layoutEdit: () => "own",
      layout: null,
      onLayout: () => {},
    });
    seen.draw = behaviour.draw ?? null;
    seen.draftZones = behaviour.draftZones;
    return null;
  }
  render(<Harness />);
  return { latest: () => seen };
}

/** Let the frame the marquee is redrawn on actually arrive. */
async function frame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Select mode's marquee", () => {
  it("takes the drag on bare ground, which is what moves the pan to the middle button", () => {
    const { latest } = drive(() => {});
    expect(latest().draw).toBeTypeOf("function");
  });

  it("shows nothing until a box is dragged out", () => {
    const { latest } = drive(() => {});
    expect(latest().draftZones).toBeUndefined();
  });

  it("draws the box between the two corners while the pointer is down", async () => {
    const { latest } = drive(() => {});
    act(() => {
      latest().draw?.({ x: 400, z: 500 }, { x: 100, z: 200 }, "move", {
        add: false,
      });
    });
    await frame();

    expect(latest().draftZones).toEqual([
      {
        id: "marquee",
        name: "Selecting",
        shape: "box",
        min: { x: 100, z: 200 },
        max: { x: 400, z: 500 },
      },
    ]);
  });

  it("draws exactly the box that was dragged, with no minimum size", async () => {
    const { latest } = drive(() => {});
    act(() => {
      latest().draw?.({ x: 100, z: 100 }, { x: 102, z: 101 }, "move", {
        add: false,
      });
    });
    await frame();

    const drafted = latest().draftZones?.[0];
    expect(drafted).toMatchObject({
      min: { x: 100, z: 100 },
      max: { x: 102, z: 101 },
    });
  });

  it("selects what is standing in the box when the pointer comes up, and takes the box away", async () => {
    const caught = vi.fn();
    const { latest } = drive(caught);
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 400, z: 400 }, "move", {
        add: false,
      });
    });
    await frame();
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 400, z: 400 }, "end", {
        add: false,
      });
    });
    await frame();

    expect(caught).toHaveBeenCalledWith(["actor:a1", "actor:a2"], false);
    expect(latest().draftZones).toBeUndefined();
  });

  it("catches a zone fully covered by the box alongside the units in it", async () => {
    const caught = vi.fn();
    const scenario: Scenario = {
      ...newScenario("Marquee"),
      zones: [
        {
          id: "z1",
          name: "Landing",
          shape: "box",
          min: { x: 150, z: 150 },
          max: { x: 250, z: 250 },
        },
      ],
    };
    const { latest } = drive(caught, scenario);
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 400, z: 400 }, "end", {
        add: false,
      });
    });
    await frame();

    expect(caught).toHaveBeenCalledWith(
      ["actor:a1", "actor:a2", "zone:z1"],
      false,
    );
  });

  it("catches only the path points standing in the box, not the rest of the path", async () => {
    const caught = vi.fn();
    const paths: PathSource[] = [
      {
        id: "g1",
        label: "Group 1",
        orders: [
          {
            kind: "move",
            waypoints: [
              { x: 350, z: 350 },
              { x: 9000, z: 9000 },
            ],
          },
        ],
      },
    ];
    const { latest } = drive(caught, newScenario("Marquee"), paths);
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 400, z: 400 }, "end", {
        add: false,
      });
    });
    await frame();

    expect(caught).toHaveBeenCalledWith(
      ["actor:a1", "actor:a2", "path:g1#0@0"],
      false,
    );
  });

  it("says the box was added to rather than instead of, when Shift was held", async () => {
    const caught = vi.fn();
    const { latest } = drive(caught);
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 200, z: 200 }, "end", { add: true });
    });
    await frame();

    expect(caught).toHaveBeenCalledWith(["actor:a1"], true);
  });

  it("selects nothing from a box over empty ground, and still says so", async () => {
    const caught = vi.fn();
    const { latest } = drive(caught);
    act(() => {
      latest().draw?.({ x: 4000, z: 4000 }, { x: 5000, z: 5000 }, "end", {
        add: false,
      });
    });
    await frame();

    expect(caught).toHaveBeenCalledWith([], false);
  });

  it("takes the box away and selects nothing when the browser takes the drag", async () => {
    const caught = vi.fn();
    const { latest } = drive(caught);
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 400, z: 400 }, "move", {
        add: false,
      });
    });
    await frame();
    act(() => {
      latest().draw?.({ x: 0, z: 0 }, { x: 400, z: 400 }, "cancel", {
        add: false,
      });
    });
    await frame();

    expect(latest().draftZones).toBeUndefined();
    expect(caught).not.toHaveBeenCalled();
  });

  it("costs one redraw for a burst of moves between two frames", async () => {
    const { latest } = drive(() => {});
    act(() => {
      for (const to of [100, 200, 300, 400, 500]) {
        latest().draw?.({ x: 0, z: 0 }, { x: to, z: to }, "move", {
          add: false,
        });
      }
    });
    await frame();

    // The last one wins, and the four before it never reached React.
    expect(latest().draftZones?.[0]).toMatchObject({ max: { x: 500, z: 500 } });
  });
});
