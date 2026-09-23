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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LegoProject, newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import type { ScriptOutput, ScriptTimeline } from "../../scriptPlayback";
import { AnimationPanel } from "./AnimationPanel";

const runLua = vi.fn();
const runCob = vi.fn();
const probe = vi.fn(async (_args: unknown) => ({
  pieces: [],
  probes: [],
  error: null,
}));

vi.mock("../../bindings", () => ({
  legoRunScript: (args: unknown) => runLua(args),
  legoProbeScript: (args: unknown) => probe(args),
}));

vi.mock("../../../animation/bindings", () => ({
  animCobRun: (args: unknown) => runCob(args),
}));

// Reads a stored setting through the app frame, which a panel rendered on its
// own is not inside. Nothing here is about reduced motion.
vi.mock("../../../general/display", () => ({
  useReduceMotion: () => false,
}));

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
  runLua.mockResolvedValue(timeline());
  runCob.mockResolvedValue(timeline());
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

describe("a unit on the presets", () => {
  it("offers them, and runs no script at all", () => {
    show(project());

    expect(screen.queryByText(/What happens to the unit/)).toBeNull();
    expect(runCob).not.toHaveBeenCalled();
    expect(runLua).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByText("Loading a transport"));
    fireEvent.click(screen.getByRole("button", { name: /Play/ }));

    await waitFor(() => expect(runCob).toHaveBeenCalled());
    const events = runCob.mock.calls.at(-1)?.[0].events;
    const begin = events.find(
      (event: { callin: string }) => event.callin === "BeginTransport",
    );
    expect(begin.world.standIn).toMatchObject({ id: 2 });
    expect(begin.world.standIn.pos).toHaveLength(3);
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
