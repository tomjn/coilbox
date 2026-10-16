// @vitest-environment happy-dom

/**
 * Which runtime the panel plays a unit through, and what it says about it.
 *
 * A unit has one of three animations: the presets, its own Lua, or the
 * compiled file its game shipped. The third is the one worth testing, because
 * it looks like the second from outside and is played by different machinery,
 * and because the panel must not offer to edit a file coilbox cannot write.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unitScript } from "../../luaScript";
import { type LegoProject, newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { ScriptOutput, ScriptTimeline } from "../../scriptPlayback";
import { soloProject } from "../../soloPreset";
import { standInAt } from "../../standIn";
import { AnimationPanel } from "./AnimationPanel";

const runLua = vi.fn();
const runCob = vi.fn();
const probe = vi.fn(async (_args: unknown) => ({
  pieces: [],
  probes: [],
  functions: [],
  error: null,
}));
const probeCob = vi.fn(async (_args: unknown) => ({
  pieces: [],
  probes: [],
  functions: [],
  error: null,
}));

vi.mock("../../bindings", () => ({
  legoRunScript: (args: unknown) => runLua(args),
  legoProbeScript: (args: unknown) => probe(args),
}));

vi.mock("../../../animation/bindings", () => ({
  animCobRun: (args: unknown) => runCob(args),
  animCobProbe: (args: unknown) => probeCob(args),
}));

// Reads a stored setting through the app frame, which a panel rendered on its
// own is not inside. Nothing here is about reduced motion.
vi.mock("../../../general/display", () => ({
  useReduceMotion: () => false,
}));

// Reads the test game and its unit definitions through unitsync, which a panel
// rendered on its own has no app for. `MovementSection.dom.test.tsx` covers it.
vi.mock("./MovementSection", () => ({ MovementSection: () => null }));

function timeline(over: Partial<ScriptTimeline> = {}): ScriptTimeline {
  return {
    fps: 30,
    pieces: ["base"],
    frames: [[0, 0, 0, 0, 0, 0]],
    hidden: [],
    error: null,
    warnings: [],
    asked: [],
    functions: [],
    linesRun: [],
    offsetsRun: [],
    events: [],
    ...over,
  };
}

function project(over: Partial<LegoProject> = {}): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "armcom",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-22T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      {
        id: "p0",
        name: "base",
        parentId: null,
        partId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
    ...over,
  };
}

function show(
  value: LegoProject,
  over: Partial<React.ComponentProps<typeof AnimationPanel>> = {},
) {
  return render(
    <AnimationPanel
      project={value}
      playing={false}
      onPlayingChange={vi.fn()}
      onChange={vi.fn()}
      onShowScript={vi.fn()}
      onBuilderChange={vi.fn()}
      onMovementChange={vi.fn()}
      onScriptTimeline={vi.fn()}
      onScriptRun={vi.fn()}
      scriptPaused={false}
      onScriptPausedChange={vi.fn()}
      scriptFrame={0}
      onScriptFrameChange={vi.fn()}
      pack={pack()}
      raw={null}
      onStandIn={vi.fn()}
      {...over}
    />,
  );
}

/** An empty parts library. Nothing here draws, and no piece carries a part, so
 *  measuring this unit gives an empty box and the stand-in its smallest size. */
function pack(): LoadedPack {
  return {
    manifest: {} as LoadedPack["manifest"],
    library: { packs: [], atlases: [], dir: "", problems: [] },
    parts: [],
    byId: new Map(),
    vertices: new Float32Array(),
    indices: new Uint16Array(),
  };
}

const COMPILED = { member: "scripts/armcom.cob", bytes: [4, 0, 0, 0] };

beforeEach(() => {
  runLua.mockReset();
  runCob.mockReset();
  probeCob.mockReset();
  runLua.mockResolvedValue(timeline());
  runCob.mockResolvedValue(timeline());
  probeCob.mockResolvedValue({
    pieces: [],
    probes: [],
    functions: [],
    error: null,
  });
});

afterEach(cleanup);

describe("a unit whose game compiled its animation", () => {
  it("plays it, rather than offering the presets as though it had none", () => {
    show(project({ compiledScript: COMPILED }));

    expect(screen.getByText(/What happens to the unit/)).toBeTruthy();
  });

  it("runs the bytecode through the compiled runtime", async () => {
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runCob).toHaveBeenCalled());
    expect(runCob.mock.calls[0][0]).toMatchObject({
      bytes: [4, 0, 0, 0],
      pieces: ["base"],
    });
    expect(runLua).not.toHaveBeenCalled();
  });

  /** Coilbox writes Lua. Offering to edit a compiled file would promise
   *  something no export can keep. */
  it("does not offer to edit it", () => {
    show(project({ compiledScript: COMPILED }));

    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("says the file is the game's and is not written back", () => {
    show(project({ compiledScript: COMPILED }));

    expect(screen.getByText(/scripts\/armcom\.cob/)).toBeTruthy();
    expect(screen.getByText(/cannot be edited here/)).toBeTruthy();
  });

  /**
   * Taking a script over is a decision, and text somebody owns beats the file
   * they came in with. It is also the only way back from a conversion.
   */
  it("plays the unit's own Lua instead once it has some", async () => {
    show(
      project({
        compiledScript: COMPILED,
        script: "function script.Create() end\n",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runLua).toHaveBeenCalled());
    expect(runCob).not.toHaveBeenCalled();
  });
});

describe("a unit that owns its script", () => {
  it("says the presets no longer write it, and where to edit it", () => {
    show(project({ script: "function script.Create() end\n" }));

    expect(
      screen.getByText(
        /presets no longer write it\. Edit it on the Script tab/,
      ),
    ).toBeTruthy();
  });
});

describe("a unit on the presets", () => {
  it("offers them, and runs no script until played", () => {
    show(project());

    expect(screen.getByText("Idle sway")).toBeTruthy();
    expect(runCob).not.toHaveBeenCalled();
    expect(runLua).not.toHaveBeenCalled();
  });
});

describe("a unit on the presets, once played", () => {
  const withPreset = () =>
    project({
      pieces: [
        {
          id: "p0",
          name: "base",
          parentId: null,
          partId: null,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          role: "base",
        },
      ],
      animations: [{ presetId: "idle.sway", params: {} }],
    });

  /** The preview exists to show what the engine will run, and the engine runs
   *  the generated text, so that text is what the runtime is given. */
  it("runs the script its presets generate", async () => {
    const value = withPreset();
    const onScriptTimeline = vi.fn();
    show(value, { onScriptTimeline });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runLua).toHaveBeenCalled());
    expect(runLua.mock.calls[0][0]).toMatchObject({
      script: unitScript(value),
      pieces: ["base"],
    });
    expect(unitScript(value)).not.toBe("");
    expect(runCob).not.toHaveBeenCalled();
    await waitFor(() => expect(onScriptTimeline).toHaveBeenCalled());
  });

  it("offers the scenario picker beside the presets", () => {
    show(withPreset());

    expect(screen.getByText(/What happens to the unit/)).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    ).toBeTruthy();
    expect(screen.getByText("Idle sway")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Script/ })).toBeTruthy();
  });

  it("does not offer to edit a script it has not been given", () => {
    show(withPreset());

    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("has nothing to play until a preset is applied", () => {
    show(project());

    const play = screen.getByRole("button", { name: /Play/ });
    expect((play as HTMLButtonElement).disabled).toBe(true);
  });

  it("scrubs the run it gets back", async () => {
    runLua.mockResolvedValue(
      timeline({ frames: [[0], [0], [0]] as ScriptTimeline["frames"] }),
    );
    show(withPreset());
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    expect(
      await screen.findByLabelText("Scrub the script preview"),
    ).toBeTruthy();
    expect(screen.getByTitle("Step forward one frame")).toBeTruthy();
  });

  it("says so when the generated script stops", async () => {
    runLua.mockResolvedValue(timeline({ error: "attempt to call nil" }));
    show(withPreset());
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    expect(await screen.findByText(/attempt to call nil/)).toBeTruthy();
  });
});

describe("unit values", () => {
  it("is hidden until a run has asked about the unit", () => {
    show(project({ compiledScript: COMPILED }));

    expect(screen.queryByText("Unit values")).toBeNull();
  });

  it("offers a control for everything the last run asked about", async () => {
    runCob.mockResolvedValue(
      timeline({ asked: [{ id: 4, name: "HEALTH", default: 100 }] }),
    );
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(screen.getByText("Unit values")).toBeTruthy());
    expect(screen.getByText("Health")).toBeTruthy();
    // The frame scrubber is the other slider a playable run shows.
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("reruns with the changed value, and offers a reset once one has changed", async () => {
    runCob.mockResolvedValue(
      timeline({ asked: [{ id: 4, name: "HEALTH", default: 100 }] }),
    );
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    // The frame scrubber is the other slider, so the unit value's is the last.
    const healthSlider = screen.getAllByRole("slider").at(-1) as HTMLElement;
    fireEvent.keyDown(healthSlider, { key: "ArrowLeft" });

    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(2));
    expect(runCob.mock.calls[1][0]).toMatchObject({ values: { 4: 99 } });
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(3));
    expect(runCob.mock.calls[2][0]).toMatchObject({ values: {} });
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});

describe("calling a function", () => {
  it("learns the script's functions from an idle run, then fires the chosen one", async () => {
    runCob.mockResolvedValue(
      timeline({ functions: ["Create", "QueryTurret"] }),
    );
    show(project({ compiledScript: COMPILED }));

    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(await screen.findByText("Call a function"));

    // Nothing was playing yet, so learning the functions took a run of its own.
    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(1));
    expect(runCob.mock.calls[0][0]).toMatchObject({
      events: [
        { frame: 0, callin: "Create" },
        { frame: 1, callin: "setSFXoccupy" },
      ],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Function to call" }));
    fireEvent.click(await screen.findByText("QueryTurret"));

    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(2));
    expect(runCob.mock.calls[1][0]).toMatchObject({
      events: [
        { frame: 0, callin: "Create" },
        { frame: 1, callin: "setSFXoccupy" },
        { frame: 15, callin: "QueryTurret", args: [] },
      ],
    });
  });

  it("does not run text that is not a comma separated list of numbers", async () => {
    runCob.mockResolvedValue(timeline({ functions: ["AimWeapon1"] }));
    show(project({ compiledScript: COMPILED }));

    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(await screen.findByText("Call a function"));
    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("combobox", { name: "Function to call" }));
    fireEvent.click(await screen.findByText("AimWeapon1"));
    await waitFor(() => expect(runCob).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("Arguments"), {
      target: { value: "0.8, not a number" },
    });

    expect(await screen.findByText(/Numbers, comma separated/)).toBeTruthy();
    // The bad text is not silently retried, so no third run ever happens.
    expect(runCob).toHaveBeenCalledTimes(2);
  });
});

describe("the scene a script is told about", () => {
  /** Every run carries at least the unit's own size, so a script asking how
   *  big it is gets an answer rather than a note. */
  it("goes with a scenario that has no stand-in", async () => {
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runCob).toHaveBeenCalled());
    const events = runCob.mock.calls[0][0].events;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.world).toMatchObject({ standIn: null });
      expect(event.world.self).toBeDefined();
    }
  });

  it("puts the stand-in in it for a scenario that has one", async () => {
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(
      await screen.findByText("Loading and unloading a transport"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runCob).toHaveBeenCalled());
    const events = runCob.mock.calls.at(-1)?.[0].events;
    const begin = events.find(
      (event: { callin: string }) => event.callin === "BeginTransport",
    );
    expect(begin.world.standIn).toMatchObject({ id: 2 });
    expect(begin.world.standIn.pos).toHaveLength(3);
  });

  /**
   * A compiled unit's "Aiming and firing" scenario has to know which piece
   * `AimFromWeapon1` names to measure the stand-in from, the same thing the
   * Lua runtime is asked with `legoProbeScript`. Before `animCobProbe`
   * existed there was no way to ask a compiled script this, so the aim was
   * always measured from the unit's origin.
   */
  it("asks the compiled script the same probe a Lua one gets", async () => {
    show(project({ compiledScript: COMPILED }));
    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(await screen.findByText("Aiming and firing"));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(probeCob).toHaveBeenCalled());
    expect(probeCob.mock.calls[0][0]).toMatchObject({
      bytes: [4, 0, 0, 0],
      pieces: ["base"],
      callins: ["AimFromWeapon1", "QueryBuildInfo"],
    });
    expect(probe).not.toHaveBeenCalled();
  });
});

/** happy-dom's ResizeObserver never calls back, so a test that needs the row
 *  measured brings its own, firing once with a fixed width. The same pattern as
 *  `src/workshop/pages/components/UnitList.dom.test.tsx`. */
class FixedWidthResizeObserver {
  #callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe() {
    this.#callback(
      [{ contentRect: { width: 50 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

describe("the missing bitmaps note", () => {
  it("shows for a run whose only event is an sfx", async () => {
    runCob.mockResolvedValue(
      timeline({
        events: [{ frame: 5, kind: "sfx", piece: "base", sfx: 257 }],
      }),
    );
    show(project({ compiledScript: COMPILED }), {
      effectsNote: "The game has no heat cloud bitmap.",
    });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() =>
      expect(
        screen.getByText("The game has no heat cloud bitmap."),
      ).toBeTruthy(),
    );
  });

  it("does not show for a run with no events", async () => {
    runCob.mockResolvedValue(timeline({ events: [] }));
    show(project({ compiledScript: COMPILED }), {
      effectsNote: "The game has no heat cloud bitmap.",
    });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(screen.getByText(`1/1`)).toBeTruthy());
    expect(screen.queryByText("The game has no heat cloud bitmap.")).toBeNull();
  });
});

describe("marks under the scrubber", () => {
  const frames = (count: number) =>
    Array.from({ length: count }, () => [0, 0, 0, 0, 0, 0]);

  async function played(events: ScriptOutput[], count = 100, over = {}) {
    runCob.mockResolvedValue(timeline({ frames: frames(count), events }));
    show(project({ compiledScript: COMPILED }), over);
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    // The frame counter beside the scrubber, which only renders once the run
    // came back with frames to play.
    await waitFor(() => expect(screen.getByText(`1/${count}`)).toBeTruthy());
  }

  it("marks nothing for a run that announced nothing", async () => {
    await played([]);
    expect(
      screen.queryByRole("group", { name: /What the script announced/ }),
    ).toBeNull();
  });

  it("marks each frame that has events, named for what happened", async () => {
    await played([
      { frame: 10, kind: "attach", unit: 2, piece: "link" },
      { frame: 40, kind: "sfx", piece: "flare", sfx: 1025 },
    ]);
    expect(
      screen.getByRole("button", { name: "Frame 11: Attach stand-in to link" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Frame 41: EmitSfx 1025 from flare (CEG 1)",
      }),
    ).toBeTruthy();
  });

  it("seeks to a mark's frame, pausing first", async () => {
    const onScriptFrameChange = vi.fn();
    const onScriptPausedChange = vi.fn();
    await played([{ frame: 10, kind: "drop", unit: 2 }], 100, {
      onScriptFrameChange,
      onScriptPausedChange,
    });
    onScriptFrameChange.mockClear();
    onScriptPausedChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Frame 11/ }));

    expect(onScriptPausedChange).toHaveBeenCalledWith(true);
    expect(onScriptFrameChange).toHaveBeenCalledWith(10);
  });

  it("merges frames that fall on the same pixel", async () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver =
      FixedWidthResizeObserver as unknown as typeof ResizeObserver;
    try {
      await played(
        [
          { frame: 500, kind: "drop", unit: 2 },
          { frame: 501, kind: "sfx", piece: "flare", sfx: 1024 },
        ],
        1000,
      );
      expect(
        screen.getByRole("button", {
          name: "Frame 501: Drop stand-in, and 1 more",
        }),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Frame 502/ })).toBeNull();
    } finally {
      globalThis.ResizeObserver = original;
    }
  });
});

describe("a scenario that moves the unit", () => {
  const lastMotion = (onStandIn: ReturnType<typeof vi.fn>) =>
    onStandIn.mock.calls.at(-1)?.[0]?.motion;

  it("tells the viewport when the unit moves, at the speed the script is told", async () => {
    const onStandIn = vi.fn();
    show(project({ compiledScript: COMPILED }), { onStandIn });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(lastMotion(onStandIn)).toBeTruthy());
    const motion = lastMotion(onStandIn);
    // The engine's CURRENT_SPEED answer, one elmo a frame, from StartMoving
    // on, with no StopMoving in the Moving scenario.
    expect(motion.speed).toBe(1);
    expect(motion.spans).toHaveLength(1);
    expect(motion.spans[0][0]).toBeGreaterThan(0);
    expect(motion.spans[0][1]).toBe(Infinity);
  });

  it("follows the Speed control once it has changed", async () => {
    runCob.mockResolvedValue(
      timeline({ asked: [{ id: 29, name: "CURRENT_SPEED", default: 65536 }] }),
    );
    const onStandIn = vi.fn();
    show(project({ compiledScript: COMPILED }), { onStandIn });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(screen.getByText("Speed")).toBeTruthy());

    const speedSlider = screen.getAllByRole("slider").at(-1) as HTMLElement;
    fireEvent.keyDown(speedSlider, { key: "ArrowLeft" });

    await waitFor(() =>
      expect(lastMotion(onStandIn)?.speed).toBeCloseTo(0.95, 4),
    );
  });
});

describe("a unit driven along a path", () => {
  type Sent = {
    frame: number;
    callin?: string;
    args?: number[];
    world?: {
      drive?: { pos: number[]; heading: number; speed: number };
      ground?: { up: number[] | null };
    };
  };
  const lastPlacement = (onStandIn: ReturnType<typeof vi.fn>) =>
    onStandIn.mock.calls.at(-1)?.[0];
  const sentTo = (runner: ReturnType<typeof vi.fn>): Sent[] =>
    runner.mock.calls.at(-1)?.[0].events ?? [];
  const callins = (events: Sent[]) =>
    events.filter((e) => e.callin && e.callin !== "setSFXoccupy");

  async function pickDriving() {
    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(await screen.findByText("Driving along a path"));
  }
  async function choose(name: string, option: string) {
    fireEvent.click(screen.getByRole("combobox", { name }));
    fireEvent.click(await screen.findByText(option));
  }

  /** A Lua unit that moves at 60 elmos a second and turns 600 a frame. */
  const driver = () =>
    project({
      script: "function script.Create() end",
      movement: { moveClass: "TANK2", speed: 60, turnRate: 600 },
    });

  it("drives the unit at the speed Movement gives it, in the engine's order", async () => {
    const onStandIn = vi.fn();
    show(driver(), { onStandIn });
    await pickDriving();
    expect(screen.getByText(/Ground units only, not aircraft/)).toBeTruthy();
    expect(
      screen.getByText(/Speed 60 elmos\/s, from Movement\. Turn rate 600/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runLua).toHaveBeenCalled());

    const events = sentTo(runLua);
    // Every frame of the preview is told where the unit is.
    expect(new Set(events.map((e) => e.frame)).size).toBe(450);
    expect(events.every((e) => e.world?.drive)).toBe(true);
    expect(callins(events).map((e) => e.callin)).toEqual([
      "Create",
      "StartMoving",
      "StopMoving",
    ]);
    const start = events.find((e) => e.callin === "StartMoving");
    expect(start?.args).toEqual([0]);
    // Two elmos a frame once it is moving, straight ahead.
    const moving = events.find((e) => e.frame === 100)?.world?.drive;
    expect(moving?.speed).toBe(2);
    expect(moving?.heading).toBe(0);
    expect(moving?.pos[2]).toBeCloseTo(2 * (100 - 15));

    const placement = lastPlacement(onStandIn);
    expect(placement.drive.frames).toHaveLength(450);
    expect(placement.drive.path).toEqual([[0, 480]]);
    expect(placement.motion).toBeNull();
    expect(placement.drive.onPick).toBeUndefined();
  });

  it("sends each frame's turn as ChangeHeading once asked to", async () => {
    show(driver());
    await pickDriving();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runLua).toHaveBeenCalled());
    await choose("Path to drive", "Turning right");
    await waitFor(() =>
      expect(sentTo(runLua).some((e) => e.world?.drive?.heading)).toBe(true),
    );
    expect(sentTo(runLua).some((e) => e.callin === "ChangeHeading")).toBe(
      false,
    );

    await choose(
      "When ChangeHeading is sent",
      "ChangeHeading sent on every turning frame",
    );
    await waitFor(() =>
      expect(sentTo(runLua).some((e) => e.callin === "ChangeHeading")).toBe(
        true,
      ),
    );
    const events = sentTo(runLua);
    const turns = events.filter((e) => e.callin === "ChangeHeading");
    // A right turn is negative, and the heading the script reads on that
    // frame already includes it.
    expect(turns[0].args?.[0]).toBeLessThan(0);
    const on = (frame: number) =>
      events.find((e) => e.frame === frame)?.world?.drive?.heading ?? 0;
    expect(on(turns[0].frame)).toBe(
      on(turns[0].frame - 1) + (turns[0].args?.[0] ?? 0),
    );
  });

  /** `CCobInstance::ChangeHeading` does nothing (`CobInstance.h:171`). */
  it("never sends a compiled script ChangeHeading", async () => {
    show(project({ compiledScript: COMPILED }));
    await pickDriving();
    expect(
      screen.queryByRole("combobox", { name: "When ChangeHeading is sent" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runCob).toHaveBeenCalled());
    await choose("Path to drive", "A circle to the left");
    await waitFor(() =>
      expect(sentTo(runCob).some((e) => e.world?.drive?.heading)).toBe(true),
    );
    expect(sentTo(runCob).some((e) => e.callin === "ChangeHeading")).toBe(
      false,
    );
  });

  it("drives through the points clicked on the ground", async () => {
    const onStandIn = vi.fn();
    show(driver(), { onStandIn });
    await pickDriving();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runLua).toHaveBeenCalled());
    await choose("Path to drive", "Your own path");
    await waitFor(() =>
      expect(lastPlacement(onStandIn)?.drive?.onPick).toBeTruthy(),
    );
    expect(screen.getByText("Click the ground to add points.")).toBeTruthy();

    act(() => lastPlacement(onStandIn).drive.onPick([0, 60]));
    await waitFor(() =>
      expect(lastPlacement(onStandIn).drive.path).toEqual([[0, 60]]),
    );
    act(() => lastPlacement(onStandIn).drive.onPick([40, 60]));
    await waitFor(() => expect(screen.getByText("2 points")).toBeTruthy());
    expect(lastPlacement(onStandIn).drive.path).toEqual([
      [0, 60],
      [40, 60],
    ]);
    expect(callins(sentTo(runLua)).some((e) => e.callin === "StopMoving")).toBe(
      true,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(lastPlacement(onStandIn).drive.path).toEqual([]),
    );
  });

  /** A slope under a unit that tilts: the up each frame is the ground's
   *  there, not the one at the origin. */
  it("stands the unit on the ground wherever it has driven to", async () => {
    show(driver(), {
      ground: {
        shape: { kind: "uneven", degrees: 20, width: 64 },
        up: [0, 1, 0],
      },
    });
    await pickDriving();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runLua).toHaveBeenCalled());
    const ups = new Set(
      sentTo(runLua).map((e) => JSON.stringify(e.world?.ground?.up)),
    );
    expect(ups.size).toBeGreaterThan(10);
  });

  /** A control for a value the drive answers itself would do nothing. */
  it("offers no control for the values the drive answers", async () => {
    runLua.mockResolvedValue(
      timeline({
        asked: [
          { id: 29, name: "CURRENT_SPEED", default: 65536 },
          { id: 82, name: "HEADING", default: 0 },
          { id: 4, name: "HEALTH", default: 100 },
        ],
      }),
    );
    show(driver());
    await pickDriving();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(screen.getByText("Unit values")).toBeTruthy());
    expect(screen.queryByText("Speed")).toBeNull();
    expect(screen.queryByText("Heading")).toBeNull();
  });
});

describe("a target the game maker sets moving", () => {
  /** An empty unit's stand-in is the smallest it goes, `MIN_RADIUS`. */
  const RADIUS = 4.2;
  const lastPlacement = (onStandIn: ReturnType<typeof vi.fn>) =>
    onStandIn.mock.calls.at(-1)?.[0];

  async function firing(onStandIn = vi.fn()) {
    show(project({ compiledScript: COMPILED }), { onStandIn });
    await pick();
    return onStandIn;
  }
  async function pick() {
    fireEvent.click(
      screen.getByRole("combobox", { name: "What happens to the unit" }),
    );
    fireEvent.click(await screen.findByText("Aiming and firing"));
  }
  /** Radix names the slider's root, and the thumb inside it is the slider. */
  const speedSlider = () =>
    within(screen.getByLabelText("Target speed")).getByRole("slider");

  it("offers how it moves and how fast for the firing scenario only", async () => {
    show(project({ compiledScript: COMPILED }));
    expect(
      screen.queryByRole("combobox", { name: "How the target moves" }),
    ).toBeNull();
    await pick();
    expect(
      screen.getByRole("combobox", { name: "How the target moves" }),
    ).toBeTruthy();
    expect(speedSlider()).toBeTruthy();
  });

  /** The fixed track this replaces stood still at two spots for most of the
   *  preview. Every aim now finds the target somewhere new. */
  it("keeps the target moving through the run", async () => {
    await firing();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runCob).toHaveBeenCalled());

    const aims = runCob.mock.calls
      .at(-1)?.[0]
      .events.filter(
        (event: { callin?: string }) => event.callin === "AimWeapon1",
      );
    expect(aims.length).toBeGreaterThan(10);
    const spots = aims.map(
      (event: { world: { standIn: { pos: number[] } } }) =>
        event.world.standIn.pos,
    );
    for (let i = 1; i < spots.length; i++) {
      expect(spots[i]).not.toEqual(spots[i - 1]);
    }
  });

  it("runs again with the target where it was let go after a drag", async () => {
    const onStandIn = await firing();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(lastPlacement(onStandIn)?.onDrag).toBeTruthy());
    const runs = runCob.mock.calls.length;

    act(() => lastPlacement(onStandIn).onDrag([20, 30], 120));

    await waitFor(() => expect(runCob.mock.calls.length).toBe(runs + 1));
    const pose = standInAt(lastPlacement(onStandIn).track, 120, RADIUS);
    expect(pose?.pos[0]).toBeCloseTo(20);
    expect(pose?.pos[2]).toBeCloseTo(30);
  });

  it("runs again on a new path", async () => {
    const onStandIn = await firing();
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(runCob).toHaveBeenCalled());
    const crossing = lastPlacement(onStandIn).track;

    fireEvent.click(
      screen.getByRole("combobox", { name: "How the target moves" }),
    );
    fireEvent.click(await screen.findByText("Circling the unit"));

    await waitFor(() =>
      expect(lastPlacement(onStandIn).track).not.toBe(crossing),
    );
    const track = lastPlacement(onStandIn).track;
    for (const frame of [0, 100, 300]) {
      const pos = standInAt(track, frame, RADIUS)?.pos ?? [0, 0, 0];
      expect(Math.hypot(pos[0], pos[2])).toBeCloseTo(10 * RADIUS);
    }
  });

  /** A drag of the slider is a burst of changes, and it runs once for them
   *  rather than once each. */
  it("runs once for a drag of the speed slider, once it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await firing();
      fireEvent.click(screen.getByRole("button", { name: /Play/ }));
      await waitFor(() => expect(runCob).toHaveBeenCalled());
      const runs = runCob.mock.calls.length;

      const slider = speedSlider();
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      fireEvent.keyDown(slider, { key: "ArrowRight" });
      expect(screen.getByText("1.5× the unit's")).toBeTruthy();
      expect(runCob.mock.calls.length).toBe(runs);

      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      await waitFor(() => expect(runCob.mock.calls.length).toBe(runs + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a unit on the presets, edited while it plays", () => {
  const piece = {
    id: "p0",
    name: "base",
    parentId: null,
    partId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    role: "base" as const,
  };
  const idle = (params = {}) =>
    project({
      pieces: [piece],
      animations: [{ presetId: "idle.sway", params }],
    });
  const frames = (n: number) =>
    Array.from({ length: n }, () => [0]) as ScriptTimeline["frames"];

  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  /** Plays the unit and waits for the run to land, then rerenders with `next`. */
  async function played(
    first: LegoProject,
    props: Partial<React.ComponentProps<typeof AnimationPanel>> = {},
  ) {
    const view = show(first, { ...props, playing: false });
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));
    await vi.waitFor(() => expect(runLua).toHaveBeenCalledTimes(1));
    const again = (next: LegoProject, over = {}) =>
      view.rerender(
        <AnimationPanel
          project={next}
          playing={true}
          onPlayingChange={vi.fn()}
          onChange={vi.fn()}
          onShowScript={vi.fn()}
          onBuilderChange={vi.fn()}
          onMovementChange={vi.fn()}
          onScriptTimeline={vi.fn()}
          onScriptRun={vi.fn()}
          scriptPaused={false}
          onScriptPausedChange={vi.fn()}
          scriptFrame={0}
          onScriptFrameChange={vi.fn()}
          pack={pack()}
          raw={null}
          onStandIn={vi.fn()}
          {...props}
          {...over}
        />,
      );
    return again;
  }

  it("runs the new script once the edits settle, and not before", async () => {
    const again = await played(idle(), { playing: true });
    const next = idle({ turn: 20 });
    expect(unitScript(next)).not.toBe(unitScript(idle()));
    again(next);

    await vi.advanceTimersByTimeAsync(399);
    expect(runLua).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runLua).toHaveBeenCalledTimes(2);
    expect(runLua.mock.calls[1][0]).toMatchObject({ script: unitScript(next) });
  });

  it("runs once for a drag of many changes", async () => {
    const again = await played(idle(), { playing: true });
    for (const amplitude of [20, 21, 22]) {
      again(idle({ turn: amplitude }));
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(runLua).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an edit that leaves the script as it was", async () => {
    const value = idle();
    const again = await played(value, { playing: true });
    again({ ...value, name: "renamed" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runLua).toHaveBeenCalledTimes(1);
  });

  it("does not run anything if nothing has been played", async () => {
    const view = show(idle());
    view.rerender(
      <AnimationPanel
        project={idle({ turn: 20 })}
        playing={false}
        onPlayingChange={vi.fn()}
        onChange={vi.fn()}
        onShowScript={vi.fn()}
        onBuilderChange={vi.fn()}
        onMovementChange={vi.fn()}
        onScriptTimeline={vi.fn()}
        onScriptRun={vi.fn()}
        scriptPaused={false}
        onScriptPausedChange={vi.fn()}
        scriptFrame={0}
        onScriptFrameChange={vi.fn()}
        pack={pack()}
        raw={null}
        onStandIn={vi.fn()}
      />,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(runLua).not.toHaveBeenCalled();
  });

  it("keeps the pause and the frame when the new run reaches that far", async () => {
    runLua.mockResolvedValue(timeline({ frames: frames(10) }));
    const onScriptPausedChange = vi.fn();
    const onScriptFrameChange = vi.fn();
    const again = await played(idle(), { playing: true });
    again(idle({ turn: 20 }), {
      scriptPaused: true,
      scriptFrame: 6,
      onScriptPausedChange,
      onScriptFrameChange,
    });
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(runLua).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(onScriptFrameChange).toHaveBeenLastCalledWith(6),
    );
    expect(onScriptPausedChange).toHaveBeenLastCalledWith(true);
  });

  it("goes back to the start when the new run is shorter than the frame", async () => {
    runLua.mockResolvedValue(timeline({ frames: frames(3) }));
    const onScriptFrameChange = vi.fn();
    const again = await played(idle(), { playing: true });
    again(idle({ turn: 20 }), { scriptFrame: 6, onScriptFrameChange });
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(runLua).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(onScriptFrameChange).toHaveBeenLastCalledWith(0),
    );
  });

  it("reads Running while the new run is in flight, with the old poses kept", async () => {
    const onScriptTimeline = vi.fn();
    const again = await played(idle(), { playing: true, onScriptTimeline });
    onScriptTimeline.mockClear();
    let finish: (value: ScriptTimeline) => void = () => {};
    runLua.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    again(idle({ turn: 20 }), { onScriptTimeline });
    await vi.advanceTimersByTimeAsync(400);

    const button = await screen.findByRole("button", { name: /Running/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(onScriptTimeline).not.toHaveBeenCalled();
    finish(timeline());
    await vi.waitFor(() => expect(onScriptTimeline).toHaveBeenCalled());
  });

  it("explains a generated script that will not run, and offers the Script tab", async () => {
    const onShowScript = vi.fn();
    const again = await played(idle(), { playing: true, onShowScript });
    runLua.mockRejectedValue(new Error("load failed"));
    again(idle({ turn: 20 }), { onShowScript });
    await vi.advanceTimersByTimeAsync(400);

    expect(await screen.findByText(/load failed/)).toBeTruthy();
    expect(screen.getByText(/from the presets and the roles/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Open the Script tab/ }),
    );
    expect(onShowScript).toHaveBeenCalled();
  });

  it("still stops when the unit owns its script", async () => {
    const onPlayingChange = vi.fn();
    const owned = project({ pieces: [piece], script: "-- one" });
    const again = await played(owned, { playing: true, onPlayingChange });
    again({ ...owned, script: "-- two" }, { onPlayingChange });
    await vi.advanceTimersByTimeAsync(1000);

    expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    expect(runLua).toHaveBeenCalledTimes(1);
  });
});

describe("playing one preset on its own", () => {
  const piece = {
    id: "p0",
    name: "base",
    parentId: null,
    partId: null,
    position: [0, 0, 0] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    role: "base" as const,
  };
  const two = (sway = {}) =>
    project({
      pieces: [piece],
      animations: [
        { presetId: "idle.sway", params: sway },
        { presetId: "hover.bob", params: {} },
      ],
    });
  const solo = (value: LegoProject) => soloProject(value, "idle.sway");
  const props = (
    value: LegoProject,
    over: Partial<React.ComponentProps<typeof AnimationPanel>> = {},
  ) => (
    <AnimationPanel
      project={value}
      playing={false}
      onPlayingChange={vi.fn()}
      onChange={vi.fn()}
      onShowScript={vi.fn()}
      onBuilderChange={vi.fn()}
      onMovementChange={vi.fn()}
      onScriptTimeline={vi.fn()}
      onScriptRun={vi.fn()}
      scriptPaused={false}
      onScriptPausedChange={vi.fn()}
      scriptFrame={0}
      onScriptFrameChange={vi.fn()}
      pack={pack()}
      raw={null}
      onStandIn={vi.fn()}
      {...over}
    />
  );
  const soloButton = () =>
    screen.getByRole("button", { name: "Preview Idle sway on its own" });

  it("offers it on an applied preset's row and not on one that is not applied", () => {
    show(two());

    expect(soloButton()).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Preview Wheels turning on its own",
      }),
    ).toBeNull();
  });

  it("runs the script of that preset alone, in the scenario that shows it", async () => {
    const value = two();
    const onChange = vi.fn();
    show(value, { onChange });
    fireEvent.click(soloButton());

    await waitFor(() => expect(runLua).toHaveBeenCalled());
    const sent = runLua.mock.calls[0][0] as {
      script: string;
      events: { callin?: string }[];
    };
    expect(sent.script).toBe(unitScript(solo(value)));
    expect(sent.script).not.toBe(unitScript(value));
    expect(sent.events.map((event) => event.callin)).toContain("StopMoving");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves the scenario picker to the one it ran", async () => {
    show(two());
    fireEvent.click(soloButton());
    await waitFor(() => expect(runLua).toHaveBeenCalled());

    expect(
      screen.getByRole("combobox", { name: "What happens to the unit" })
        .textContent,
    ).toContain("Starting and stopping");
  });

  it("is what the row shows as playing, and the main button then plays everything", async () => {
    const value = two();
    const view = show(value);
    fireEvent.click(soloButton());
    await waitFor(() => expect(runLua).toHaveBeenCalledTimes(1));
    view.rerender(props(value, { playing: true }));

    expect(soloButton().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Play all" }));

    await waitFor(() => expect(runLua).toHaveBeenCalledTimes(2));
    expect(runLua.mock.calls[1][0]).toMatchObject({
      script: unitScript(value),
    });
    expect(soloButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("gives the nano row its one line", () => {
    show(
      project({
        pieces: [{ ...piece, role: "buildarm.nano" as const }],
        animations: [{ presetId: "build.nano", params: {} }],
      }),
    );

    expect(screen.getByText(/Moves nothing/)).toBeTruthy();
  });

  describe("edited while it plays", () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    async function soloing(value: LegoProject) {
      const view = show(value);
      fireEvent.click(soloButton());
      await vi.waitFor(() => expect(runLua).toHaveBeenCalledTimes(1));
      view.rerender(props(value, { playing: true }));
      return (next: LegoProject) =>
        view.rerender(props(next, { playing: true }));
    }

    it("runs the changed script of the soloed preset, still alone", async () => {
      const again = await soloing(two());
      const next = two({ turn: 20 });
      again(next);

      await vi.advanceTimersByTimeAsync(400);
      expect(runLua).toHaveBeenCalledTimes(2);
      expect(runLua.mock.calls[1][0]).toMatchObject({
        script: unitScript(solo(next)),
      });
    });

    it("does not run again for an edit to a preset that is not playing", async () => {
      const again = await soloing(two());
      again(
        project({
          pieces: [piece],
          animations: [
            { presetId: "idle.sway", params: {} },
            { presetId: "hover.bob", params: { height: 0.5 } },
          ],
        }),
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(runLua).toHaveBeenCalledTimes(1);
    });

    it("plays everything again once the soloed preset is removed", async () => {
      const again = await soloing(two());
      const next = project({
        pieces: [piece],
        animations: [{ presetId: "hover.bob", params: {} }],
      });
      again(next);

      await vi.advanceTimersByTimeAsync(400);
      expect(runLua).toHaveBeenCalledTimes(2);
      expect(runLua.mock.calls[1][0]).toMatchObject({
        script: unitScript(next),
      });
    });
  });
});
