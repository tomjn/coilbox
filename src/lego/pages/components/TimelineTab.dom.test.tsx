// @vitest-environment happy-dom

/**
 * The Timeline tab (#5396): opening an action from the Animation panel, its
 * rows and keys, the refusal on a script the game maker owns, scrubbing by the
 * ruler, and the settings that the action drawer used to hold.
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
import { useReducer, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { action, poseUnits, trackUnits, unit } from "../../actionFixtures";
import type { LegoPoseOffset, LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { emptyDraft, type PoseOffsets, reduceDraft } from "../../pose";
import type { ScriptTimeline } from "../../scriptPlayback";
import { AnimationPanel } from "./AnimationPanel";
import { TimelineTab } from "./TimelineTab";

const runLua = vi.fn();

vi.mock("../../bindings", () => ({
  legoRunScript: (args: unknown) => runLua(args),
  legoProbeScript: vi.fn(async () => ({
    pieces: [],
    probes: [],
    functions: [],
    error: null,
  })),
}));
vi.mock("../../../animation/bindings", () => ({
  animCobRun: vi.fn(),
  animCobProbe: vi.fn(),
}));
vi.mock("../../../general/display", () => ({
  useReduceMotion: () => false,
}));
vi.mock("./BuilderReport", () => ({ BuilderReport: () => null }));
vi.mock("./WorkshopChangeMarks", () => ({
  ProjectWorkshopMarks: () => null,
}));
vi.mock("./WeaponsSection", () => {
  const source = {
    gameName: null,
    weaponDefs: null,
    projects: [],
    unavailable: null,
  };
  return { WeaponsSection: () => null, useWeaponSource: () => source };
});

afterEach(cleanup);

/** What a run of the Animation panel's comes back with. */
const PANEL_RUN: ScriptTimeline = {
  fps: 30,
  pieces: ["arm"],
  frames: [[0, 0, 0, 0, 0, 0]],
  hidden: [],
  error: null,
  warnings: [],
  asked: [],
  functions: [],
  linesRun: [],
  offsetsRun: [],
  events: [],
};

/** An empty parts library. Nothing here draws. */
const EMPTY_PACK: LoadedPack = {
  manifest: {} as LoadedPack["manifest"],
  library: { packs: [], atlases: [], dir: "", problems: [] },
  parts: [],
  byId: new Map(),
  vertices: new Float32Array(),
  indices: new Uint16Array(),
};

/** What the viewport is playing and where, for a test to read back. */
interface Seen {
  project: LegoProject;
  playing: boolean;
  timeline: ScriptTimeline | null;
  paused: boolean;
  frame: number;
  /** Whether the unit is held in a pose, and what the gizmo holds. */
  posing: boolean;
  offsets: PoseOffsets;
  /** What the gizmo does: sets one piece's offset in the held pose. */
  pose: (pieceId: string, offset: LegoPoseOffset) => void;
  /** Edits of the document the tab has made. */
  edits: number;
}

const seen: Seen = {
  project: unit(),
  playing: false,
  timeline: null,
  paused: false,
  frame: 0,
  posing: false,
  offsets: {},
  pose: () => {},
  edits: 0,
};

/**
 * The tab, and optionally the Animation panel beside it, over the state the
 * builder page holds for them.
 */
function Harness({
  initial,
  panel = false,
  open = true,
  onHold,
}: {
  initial: LegoProject;
  panel?: boolean;
  open?: boolean;
  /** Told what the tab asks to be held, as well as the harness holding it. */
  onHold?: (offsets: PoseOffsets | null) => void;
}) {
  const [project, setProject] = useState(initial);
  const [actionId, setActionId] = useState<string | null>(null);
  const [tabOpen, setTabOpen] = useState(open);
  const [playing, setPlaying] = useState(false);
  const [timeline, setTimeline] = useState<ScriptTimeline | null>(null);
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState(0);
  // What the builder page holds for the pose the tab asks to be held.
  const [posing, setPosing] = useState(false);
  const [draft, dispatchPose] = useReducer(reduceDraft, emptyDraft);
  Object.assign(seen, {
    project,
    playing,
    timeline,
    paused,
    frame,
    posing,
    offsets: draft.offsets,
    pose: (pieceId: string, offset: LegoPoseOffset) =>
      act(() => dispatchPose({ type: "set", pieceId, offset })),
  });

  return (
    <>
      {panel ? (
        <AnimationPanel
          project={project}
          playing={playing}
          onPlayingChange={setPlaying}
          onChange={vi.fn()}
          onActionsEdit={(change) => setProject(change)}
          onOpenAction={(id) => {
            setActionId(id);
            setTabOpen(true);
          }}
          timelineRun={timeline?.action !== undefined}
          onShowScript={vi.fn()}
          onBuilderChange={vi.fn()}
          onScriptTimeline={setTimeline}
          onScriptRun={vi.fn()}
          scriptPaused={paused}
          onScriptPausedChange={setPaused}
          scriptFrame={frame}
          onScriptFrameChange={setFrame}
          pack={EMPTY_PACK}
          raw={null}
          onStandIn={vi.fn()}
        />
      ) : null}
      {tabOpen ? (
        <TimelineTab
          project={project}
          actionId={actionId}
          onActionChange={setActionId}
          onEdit={(change) => {
            seen.edits++;
            setProject(change);
          }}
          playing={playing}
          onPlayingChange={setPlaying}
          scriptTimeline={timeline}
          onScriptTimeline={setTimeline}
          scriptPaused={paused}
          onScriptPausedChange={setPaused}
          scriptFrame={frame}
          onScriptFrameChange={setFrame}
          onRunReplaced={vi.fn()}
          pose={{
            offsets: draft.offsets,
            onHold: (offsets) => {
              onHold?.(offsets);
              setPosing(offsets !== null);
              dispatchPose(
                offsets === null
                  ? { type: "clear" }
                  : { type: "hold", offsets },
              );
            },
          }}
        />
      ) : null}
    </>
  );
}

function names(): string[] {
  return screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? "");
}

/** Moves the ruler's thumb by pressing an arrow key on it. */
function nudgeRuler(key: "ArrowRight" | "ArrowLeft" | "End" | "Home") {
  const thumb = screen.getByRole("slider");
  thumb.focus();
  fireEvent.keyDown(thumb, { key });
}

describe("opening an action from the Animation panel", () => {
  it("shows the action's rows in the tab", () => {
    render(<Harness initial={poseUnits().plain} panel open={false} />);
    expect(screen.queryByLabelText("Scrub the action")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit keys for Plant" }),
    );

    expect(screen.getByLabelText("Scrub the action")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Action" }).textContent).toBe(
      "Plant",
    );
    expect(screen.getByText("arm")).toBeTruthy();
    expect(screen.getByText("hatch")).toBeTruthy();
  });

  it("opens a newly made action", () => {
    render(<Harness initial={unit({ actions: [] })} panel open={false} />);
    fireEvent.click(screen.getByRole("button", { name: "New action" }));
    expect(screen.getByLabelText("Scrub the action")).toBeTruthy();
    expect(seen.project.actions).toHaveLength(1);
  });

  it("takes the viewport from the panel's run, and the panel then shows nothing playing", async () => {
    runLua.mockResolvedValue(PANEL_RUN);
    render(<Harness initial={poseUnits().plain} panel />);
    // The panel's Play is the first, the tab's the second.
    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
    await waitFor(() => expect(seen.timeline).toBe(PANEL_RUN));
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1);

    // The panel's button says Pause now, so this Play is the tab's. The viewport
    // is stopped for a tick first, because its clock starts again from nothing.
    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
    await waitFor(() => expect(seen.timeline?.action).toBe("act"));
    // The panel's own button no longer says Pause, and the tab's does.
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(1);
  });

  it("makes the panel let go of its run when the tab holds the viewport, so an edit does not start it again", async () => {
    runLua.mockReset();
    runLua.mockResolvedValue(PANEL_RUN);
    render(<Harness initial={poseUnits().plain} panel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
    await waitFor(() => expect(seen.timeline).toBe(PANEL_RUN));
    expect(runLua).toHaveBeenCalledTimes(1);

    // A key on the tab stops the panel's run and holds the pose.
    fireEvent.click(
      screen.getByRole("button", { name: "Keys of arm on frame 30" }),
    );
    expect(seen.playing).toBe(false);
    fireEvent.click(screen.getAllByRole("switch", { name: "Loop" }).at(-1)!);
    // The panel would run the edited script again once its edits settled.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(runLua).toHaveBeenCalledTimes(1);
    expect(seen.playing).toBe(false);
  });

  it("is replaced by a run of the panel's", async () => {
    runLua.mockResolvedValue(PANEL_RUN);
    render(<Harness initial={poseUnits().plain} panel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[1]);
    expect(seen.timeline?.action).toBe("act");

    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[0]);
    await waitFor(() => expect(seen.timeline).toBe(PANEL_RUN));
    // Nothing of the tab's is playing now, so its button offers to play.
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1);
  });
});

describe("the rows", () => {
  it("has a row for each piece a pose key action moves, with a diamond on each key", () => {
    render(<Harness initial={poseUnits().plain} />);
    expect(screen.getByText("arm")).toBeTruthy();
    expect(screen.getByText("hatch")).toBeTruthy();
    // Raised after one second and Swung two seconds after that.
    expect(names()).toContain("Keys of arm on frame 30");
    expect(names()).toContain("Keys of arm on frame 90");
    expect(names()).toContain("Keys of hatch on frame 30");
  });

  it("opens a piece to one row for each channel with a track", () => {
    render(<Harness initial={poseUnits().plain} />);
    expect(screen.queryByText("Turn x")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Channels of arm" }));
    expect(screen.getByText("Turn x")).toBeTruthy();
    expect(screen.getByText("Turn z")).toBeTruthy();
    expect(names()).toContain("Turn x of arm, frame 30, 57.3 degrees");
    expect(names()).toContain("Turn z of arm, frame 90, 45.8 degrees");
    expect(screen.queryByText("Move y")).toBeNull();
  });

  it("shows a track action on the frames its channels key", () => {
    render(<Harness initial={trackUnits().staggered} />);
    expect(names()).toContain("Keys of arm on frame 10");
    expect(names()).toContain("Keys of arm on frame 20");
    expect(names()).toContain("Keys of hatch on frame 15");
    expect(names()).toContain("Keys of hatch on frame 30");
    fireEvent.click(screen.getByRole("button", { name: "Channels of hatch" }));
    expect(names()).toContain("Move y of hatch, frame 15, 3 elmos");
  });

  it("marks a piece something else also moves, with the clash in its tooltip", () => {
    render(<Harness initial={poseUnits().twoActions} />);
    const marker = screen.getByRole("button", {
      name: /Also moved by Aim\./,
    });
    expect(marker).toBeTruthy();
  });

  it("marks where a looping action's lap ends", () => {
    render(<Harness initial={poseUnits().plain} />);
    expect(screen.getByText("Lap ends")).toBeTruthy();
    cleanup();
    render(<Harness initial={trackUnits().staggered} />);
    expect(screen.queryByText("Lap ends")).toBeNull();
  });

  it("offers a new action when the unit has none", () => {
    render(<Harness initial={unit({ actions: [] })} />);
    expect(screen.queryByLabelText("Scrub the action")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /New action/ }));
    expect(seen.project.actions?.map((a) => a.name)).toEqual(["Action"]);
  });
});

describe("a script that is not the generated one", () => {
  // The builder turns the tab off for these (BuilderPage.dom.test.tsx), so
  // the tab draws nothing rather than actions the unit does not run.
  it("draws nothing for a unit with its own script", () => {
    render(
      <Harness
        initial={{ ...poseUnits().plain, script: "function Create() end" }}
      />,
    );
    expect(screen.queryByLabelText("Scrub the action")).toBeNull();
    expect(screen.queryByRole("button", { name: /New action/ })).toBeNull();
  });

  it("draws nothing for a compiled script", () => {
    render(
      <Harness
        initial={{
          ...poseUnits().plain,
          compiledScript: { member: "scripts/a.cob", bytes: [1, 2] },
        }}
      />,
    );
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.queryByRole("button", { name: /New action/ })).toBeNull();
  });
});

describe("playing and scrubbing", () => {
  it("plays the action alone from the start, and pauses", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(seen.playing).toBe(true);
    expect(seen.paused).toBe(false);
    expect(seen.timeline?.action).toBe("act");
    expect(seen.timeline?.frames.length).toBeGreaterThan(0);

    // Pausing stops the run and holds the unit in the pose it was paused on.
    // The tab's timeline stays the viewport's, so the panel lets go of its own.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(seen.playing).toBe(false);
    expect(seen.timeline?.action).toBe("act");
    expect(seen.posing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(seen.playing).toBe(true);
    expect(seen.paused).toBe(false);
  });

  it("plays a looping action's lap on repeat, and a one shot action once", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    // Three seconds to the last key, then a lap of three seconds.
    expect(seen.timeline?.end).toEqual({ loopFrom: 90 });
    expect(seen.timeline?.frames).toHaveLength(180);

    cleanup();
    render(<Harness initial={poseUnits().oneShot} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(seen.timeline?.end).toBe("hold");
  });

  it("goes on playing the changed action after an edit", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    const before = seen.timeline;
    fireEvent.click(screen.getByRole("switch", { name: "Loop" }));
    expect(seen.project.actions?.[0].loop).toBe(false);
    expect(seen.timeline).not.toBe(before);
    expect(seen.timeline?.end).toBe("hold");
    expect(seen.playing).toBe(true);
  });

  it("seeks when the ruler is dragged, and holds the pose there rather than playing", () => {
    render(<Harness initial={poseUnits().plain} />);
    expect(seen.timeline).toBeNull();
    nudgeRuler("ArrowRight");
    expect(screen.getByText(/^Frame 1 \//)).toBeTruthy();
    expect(seen.playing).toBe(false);
    expect(seen.posing).toBe(true);

    nudgeRuler("ArrowRight");
    expect(screen.getByText(/^Frame 2 \//)).toBeTruthy();
    nudgeRuler("Home");
    expect(screen.getByText(/^Frame 0 \//)).toBeTruthy();
    // The ruler runs a second past the last key, which is frame 90.
    nudgeRuler("End");
    expect(screen.getByText(/^Frame 120 \//)).toBeTruthy();
  });

  it("steps a frame at a time and seeks to a key's frame", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Keys of arm on frame 30" }),
    );
    expect(screen.getByText(/^Frame 30 \/ \d+, 1 s$/)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Step forward one frame" }),
    );
    expect(screen.getByText(/^Frame 31 \//)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Step back one frame" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Step back one frame" }),
    );
    expect(screen.getByText(/^Frame 29 \//)).toBeTruthy();
  });

  it("stops playing an action that is deleted", () => {
    render(<Harness initial={poseUnits().plain} panel />);
    fireEvent.click(screen.getAllByRole("button", { name: "Play" })[1]);
    expect(seen.playing).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete Plant" }));
    expect(seen.playing).toBe(false);
    expect(seen.timeline).toBeNull();
  });
});

describe("keying from the pose", () => {
  const keyButton = () => screen.getByRole("button", { name: "Key" });
  const isDisabled = (button: HTMLElement) => button.hasAttribute("disabled");
  const diamond = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name }));

  it("holds the pose the action has on the playhead while paused, and lets it go while playing", () => {
    render(<Harness initial={poseUnits().plain} />);
    expect(seen.posing).toBe(true);
    diamond("Keys of arm on frame 30");
    expect(seen.offsets.arm?.turn).toEqual([1, 0, 0]);
    expect(seen.offsets.hatch?.move).toEqual([0, 4, 0]);

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(seen.posing).toBe(false);
    expect(seen.offsets).toEqual({});
  });

  it("disables Key until the pose changes, then keys what changed in one edit", () => {
    render(<Harness initial={poseUnits().plain} />);
    diamond("Keys of arm on frame 30");
    expect(isDisabled(keyButton())).toBe(true);

    seen.pose("arm", { turn: [1, 0, 0.5] });
    expect(isDisabled(keyButton())).toBe(false);

    const edits = seen.edits;
    fireEvent.click(keyButton());
    expect(seen.edits).toBe(edits + 1);
    // The first edit of a pose key action turns it into tracks.
    const keyed = seen.project.actions?.[0];
    expect(keyed?.keys).toEqual([]);
    expect(keyed?.tracks).toContainEqual({
      piece: "arm",
      kind: "turn",
      axis: 2,
      keys: [
        { frame: 30, value: 0.5 },
        { frame: 90, value: 0.8 },
      ],
    });
    // What was keyed is the action's pose now, so there is nothing left to key.
    expect(isDisabled(keyButton())).toBe(true);
    expect(seen.offsets.arm?.turn).toEqual([1, 0, 0.5]);
  });

  it("keys a channel the action has no track for", () => {
    render(<Harness initial={trackUnits().staggered} />);
    diamond("Keys of arm on frame 20");
    seen.pose("arm", { move: [2, 0, 0] });
    fireEvent.click(keyButton());
    expect(seen.project.actions?.[0].tracks).toContainEqual({
      piece: "arm",
      kind: "move",
      axis: 0,
      keys: [{ frame: 20, value: 2 }],
    });
  });

  it("drops a change that was not keyed when the playhead moves", () => {
    render(<Harness initial={poseUnits().plain} />);
    diamond("Keys of arm on frame 30");
    seen.pose("arm", { turn: [1, 0, 0.5] });
    expect(isDisabled(keyButton())).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Step forward one frame" }),
    );
    expect(isDisabled(keyButton())).toBe(true);
    expect(seen.offsets.arm?.turn?.[2] ?? 0).not.toBe(0.5);
    expect(seen.project.actions?.[0].tracks).toBeUndefined();
  });

  it("drops a change that was not keyed when something plays", () => {
    render(<Harness initial={poseUnits().plain} />);
    seen.pose("arm", { turn: [0, 0, 0.5] });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(seen.offsets.arm).toBeUndefined();
    expect(isDisabled(keyButton())).toBe(true);
  });

  it("lets the pose go when the tab goes", () => {
    const onHold = vi.fn();
    const { unmount } = render(
      <Harness initial={poseUnits().plain} onHold={onHold} />,
    );
    expect(onHold).toHaveBeenLastCalledWith({});
    unmount();
    expect(onHold).toHaveBeenLastCalledWith(null);
  });
});

describe("typing a key's value", () => {
  const valueField = () =>
    screen.getByLabelText("Key value in degrees") as HTMLInputElement;

  it("shows the value of the key picked, in degrees for a turn", () => {
    render(<Harness initial={trackUnits().staggered} />);
    fireEvent.click(screen.getByRole("button", { name: "Channels of arm" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn x of arm, frame 10, -28.6 degrees",
      }),
    );
    expect(valueField().value).toBe("-28.65");
    expect(screen.getByText(/^Frame 10 \//)).toBeTruthy();
  });

  it("shows a move in elmos", () => {
    render(<Harness initial={trackUnits().staggered} />);
    fireEvent.click(screen.getByRole("button", { name: "Channels of hatch" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Move y of hatch, frame 15, 3 elmos",
      }),
    );
    expect(
      (screen.getByLabelText("Key value in elmos") as HTMLInputElement).value,
    ).toBe("3");
  });

  it("makes typing a value one edit, turning degrees into radians", () => {
    render(<Harness initial={trackUnits().staggered} />);
    fireEvent.click(screen.getByRole("button", { name: "Channels of arm" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn x of arm, frame 10, -28.6 degrees",
      }),
    );
    const edits = seen.edits;
    fireEvent.change(valueField(), { target: { value: "45" } });
    fireEvent.blur(valueField());
    expect(seen.edits).toBe(edits + 1);
    const keys = seen.project.actions?.[0].tracks?.[0].keys;
    expect(keys?.[0].frame).toBe(10);
    expect(keys?.[0].value).toBeCloseTo(Math.PI / 4, 8);
  });

  it("changes nothing for text that is not a number, and puts the old value back", () => {
    render(<Harness initial={trackUnits().staggered} />);
    fireEvent.click(screen.getByRole("button", { name: "Channels of arm" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn x of arm, frame 10, -28.6 degrees",
      }),
    );
    const edits = seen.edits;
    fireEvent.change(valueField(), { target: { value: "" } });
    fireEvent.blur(valueField());
    expect(seen.edits).toBe(edits);
    expect(valueField().value).toBe("-28.65");
  });

  it("turns a pose key action into tracks on its first edit", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(screen.getByRole("button", { name: "Channels of arm" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Turn x of arm, frame 30, 57.3 degrees",
      }),
    );
    const edits = seen.edits;
    fireEvent.change(valueField(), { target: { value: "90" } });
    fireEvent.blur(valueField());
    expect(seen.edits).toBe(edits + 1);
    expect(seen.project.actions?.[0].keys).toEqual([]);
    expect(seen.project.actions?.[0].tracks?.[0].keys[0].value).toBeCloseTo(
      Math.PI / 2,
      8,
    );
  });
});

describe("moving and deleting keys (#5398)", () => {
  const armX = "Turn x of arm, frame 10, -28.6 degrees";
  const keyNamed = (name: string) => screen.getByRole("button", { name });

  const trackOf = (index: number) => seen.project.actions?.[0].tracks?.[index];
  const framesOf = (index: number) => trackOf(index)?.keys.map((k) => k.frame);

  /** Drags a diamond `frames` frames along a row `width` pixels wide that is
   *  `count` frames across, in several moves, and lets go unless told not to. */
  function drag(
    button: HTMLElement,
    frames: number,
    { release = true, count = 61, width = 1000 } = {},
  ) {
    const rail = button.parentElement as HTMLElement;
    vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
      width,
    } as DOMRect);
    const dx = (frames * width) / (count - 1);
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 400 });
    fireEvent.pointerMove(button, {
      pointerId: 1,
      clientX: 400 + dx / 2,
    });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 400 + dx });
    if (release) {
      fireEvent.pointerUp(button, { pointerId: 1, clientX: 400 + dx });
    }
  }

  const openArm = () =>
    fireEvent.click(screen.getByRole("button", { name: "Channels of arm" }));

  it("names each key by its channel, piece, frame and value", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    expect(names()).toContain(armX);
    expect(names()).toContain("Turn x of arm, frame 20, 0 degrees");
    expect(names()).toContain("Keys of arm on frame 10");
    fireEvent.click(screen.getByRole("button", { name: "Channels of hatch" }));
    expect(names()).toContain("Move y of hatch, frame 15, 3 elmos");
  });

  it("moves a key by a drag, and a drag is one edit made on release", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    const before = seen.project;
    const edits = seen.edits;
    drag(keyNamed(armX), 4, { release: false });
    // Held and shown on the way, with nothing in the document yet.
    expect(seen.edits).toBe(edits);
    expect(seen.project).toBe(before);
    expect(within(keyNamed(armX)).getByText("14")).toBeTruthy();
    fireEvent.pointerUp(keyNamed(armX), { pointerId: 1, clientX: 600 });
    expect(seen.edits).toBe(edits + 1);
    expect(framesOf(0)).toEqual([14, 20]);
    expect(trackOf(0)?.keys[0].value).toBe(-0.5);
    expect(names()).toContain("Turn x of arm, frame 14, -28.6 degrees");
  });

  it("does not seek when a drag ends, and seeks on a click", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    drag(keyNamed(armX), 4);
    fireEvent.click(keyNamed("Turn x of arm, frame 14, -28.6 degrees"));
    expect(screen.getByText(/^Frame 0 \//)).toBeTruthy();
    fireEvent.click(keyNamed("Turn x of arm, frame 14, -28.6 degrees"));
    expect(screen.getByText(/^Frame 14 \//)).toBeTruthy();
  });

  it("puts a key back where it was when it is dropped on a frame its channel keys", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    const before = seen.project;
    const edits = seen.edits;
    drag(keyNamed(armX), 10, { release: false });
    // The key is shown as a refusal while it is over the other key.
    expect(keyNamed(armX).querySelector(".bg-destructive")).not.toBeNull();
    fireEvent.pointerUp(keyNamed(armX), { pointerId: 1, clientX: 700 });
    expect(seen.edits).toBe(edits);
    expect(seen.project).toBe(before);
    expect(names()).toContain(armX);
  });

  it("puts a key back where it was when the drag is cancelled", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    const edits = seen.edits;
    drag(keyNamed(armX), 4, { release: false });
    fireEvent.keyDown(keyNamed(armX), { key: "Escape" });
    expect(seen.edits).toBe(edits);
    expect(names()).toContain(armX);
  });

  it("stops a key at frame 0 rather than before it", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    drag(keyNamed(armX), -40);
    expect(framesOf(0)).toEqual([0, 20]);
  });

  it("extends the ruler when a key is dragged past its end", () => {
    render(<Harness initial={trackUnits().staggered} />);
    fireEvent.click(screen.getByRole("button", { name: "Channels of hatch" }));
    const ruler = () =>
      screen.getByRole("slider").getAttribute("aria-valuemax");
    expect(ruler()).toBe("60");
    drag(keyNamed("Move y of hatch, frame 30, 0 elmos"), 45);
    expect(framesOf(1)).toEqual([15, 75]);
    expect(ruler()).toBe("105");
  });

  it("moves every key of a piece on a frame by dragging its diamond", () => {
    const project = trackUnits().staggered;
    const arm = project.actions?.[0];
    if (!arm?.tracks) throw new Error("no tracks");
    render(
      <Harness
        initial={{
          ...project,
          actions: [
            {
              ...arm,
              tracks: [
                ...arm.tracks,
                {
                  piece: "arm",
                  kind: "turn",
                  axis: 2,
                  keys: [
                    { frame: 10, value: 0.5 },
                    { frame: 40, value: 0 },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );
    const edits = seen.edits;
    drag(keyNamed("Keys of arm on frame 10"), 3, { count: 71 });
    expect(seen.edits).toBe(edits + 1);
    expect(framesOf(0)).toEqual([13, 20]);
    expect(trackOf(2)?.keys.map((k) => k.frame)).toEqual([13, 40]);
    expect(framesOf(1)).toEqual([15, 30]);
  });

  it("moves a focused key a frame with the arrow keys, and keeps the focus on it", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    const edits = seen.edits;
    keyNamed(armX).focus();
    fireEvent.keyDown(keyNamed(armX), { key: "ArrowRight" });
    expect(seen.edits).toBe(edits + 1);
    expect(framesOf(0)).toEqual([11, 20]);
    const moved = keyNamed("Turn x of arm, frame 11, -28.6 degrees");
    expect(document.activeElement).toBe(moved);
    fireEvent.keyDown(moved, { key: "ArrowLeft" });
    fireEvent.keyDown(keyNamed("Turn x of arm, frame 10, -28.6 degrees"), {
      key: "ArrowLeft",
    });
    expect(framesOf(0)).toEqual([9, 20]);
    expect(seen.edits).toBe(edits + 3);
  });

  it("does nothing when an arrow key would put a key on its neighbour", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    for (let step = 0; step < 9; step++) {
      const at = 10 + step;
      fireEvent.keyDown(keyNamed(`Turn x of arm, frame ${at}, -28.6 degrees`), {
        key: "ArrowRight",
      });
    }
    const edits = seen.edits;
    fireEvent.keyDown(keyNamed("Turn x of arm, frame 19, -28.6 degrees"), {
      key: "ArrowRight",
    });
    expect(seen.edits).toBe(edits);
    expect(framesOf(0)).toEqual([19, 20]);
  });

  it("deletes a focused key with Delete or Backspace, and focuses its neighbour", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    const edits = seen.edits;
    keyNamed(armX).focus();
    fireEvent.keyDown(keyNamed(armX), { key: "Delete" });
    expect(seen.edits).toBe(edits + 1);
    expect(framesOf(0)).toEqual([20]);
    expect(document.activeElement).toBe(
      keyNamed("Turn x of arm, frame 20, 0 degrees"),
    );
    fireEvent.keyDown(keyNamed("Turn x of arm, frame 20, 0 degrees"), {
      key: "Backspace",
    });
    // The last key of a track takes the track with it.
    expect(trackOf(0)?.piece).toBe("hatch");
    expect(seen.project.actions?.[0].tracks).toHaveLength(1);
  });

  it("deletes every key of a piece on a frame from its diamond, in one edit", () => {
    render(<Harness initial={trackUnits().staggered} />);
    const edits = seen.edits;
    fireEvent.keyDown(keyNamed("Keys of hatch on frame 15"), {
      key: "Delete",
    });
    expect(seen.edits).toBe(edits + 1);
    expect(framesOf(1)).toEqual([30]);
  });

  it("does not let the builder see the key it used", () => {
    const seenByWindow = vi.fn();
    window.addEventListener("keydown", seenByWindow);
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    fireEvent.keyDown(keyNamed(armX), { key: "Delete" });
    window.removeEventListener("keydown", seenByWindow);
    expect(seenByWindow).not.toHaveBeenCalled();
  });

  it("is a step the builder can undo: the document before the edit is untouched", () => {
    render(<Harness initial={poseUnits().plain} />);
    const before = seen.project;
    openArm();
    fireEvent.keyDown(keyNamed("Turn x of arm, frame 30, 57.3 degrees"), {
      key: "ArrowRight",
    });
    expect(before.actions?.[0].keys.length).toBe(2);
    expect(before.actions?.[0].tracks).toBeUndefined();
    expect(seen.project.actions?.[0].keys).toEqual([]);
    expect(
      seen.project.actions?.[0].tracks
        ?.find((t) => t.piece === "arm" && t.axis === 0)
        ?.keys.map((k) => k.frame),
    ).toEqual([31, 90]);
  });

  it("follows a picked key when it moves, so its value stays in the header", () => {
    render(<Harness initial={trackUnits().staggered} />);
    openArm();
    fireEvent.click(keyNamed(armX));
    fireEvent.keyDown(keyNamed(armX), { key: "ArrowRight" });
    expect(
      (screen.getByLabelText("Key value in degrees") as HTMLInputElement).value,
    ).toBe("-28.65");
    expect(screen.getByText(/of arm, frame 11/)).toBeTruthy();
  });
});

describe("the settings", () => {
  function openSettings() {
    fireEvent.click(screen.getByRole("button", { name: "Action settings" }));
    return within(screen.getByRole("dialog", { name: "Action settings" }));
  }

  it("renames the action", () => {
    render(<Harness initial={poseUnits().plain} />);
    const settings = openSettings();
    const name = settings.getByLabelText("Action name");
    fireEvent.change(name, { target: { value: "Plant feet" } });
    fireEvent.blur(name);
    expect(seen.project.actions?.[0].name).toBe("Plant feet");
  });

  it("sets what starts it, and a function of its own", () => {
    render(<Harness initial={poseUnits().plain} />);
    const settings = openSettings();
    fireEvent.click(settings.getByRole("combobox", { name: "Starts on" }));
    fireEvent.click(
      screen.getByRole("option", { name: "A function of its own" }),
    );
    expect(seen.project.actions?.[0].trigger).toBe("RunAction");
    const own = settings.getByLabelText("Function name");
    fireEvent.change(own, { target: { value: "OpenHatch" } });
    fireEvent.blur(own);
    expect(seen.project.actions?.[0].trigger).toBe("OpenHatch");
  });

  it("sets how long it eases in and out, and clears it back to the unit's time", () => {
    render(
      <Harness
        initial={{
          ...poseUnits().plain,
          actionBlend: 0.4,
          actions: [action({ blendOut: 1 })],
        }}
      />,
    );
    const settings = openSettings();
    const blendIn = settings.getByLabelText(
      "Seconds to ease in from where the pieces are",
    );
    expect(blendIn).toHaveProperty("placeholder", "0.4");
    fireEvent.change(blendIn, { target: { value: "0.25" } });
    expect(seen.project.actions?.[0].blendIn).toBe(0.25);

    fireEvent.change(settings.getByLabelText("Seconds to ease back to rest"), {
      target: { value: "" },
    });
    expect(seen.project.actions?.[0]).not.toHaveProperty("blendOut");
  });

  it("turns looping off", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(screen.getByRole("switch", { name: "Loop" }));
    expect(seen.project.actions?.[0].loop).toBe(false);
  });

  it("says in the help popover which call-in stops a loop", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(screen.getByRole("button", { name: "About the timeline" }));
    expect(screen.getByText("It loops and stops on StopMoving.")).toBeTruthy();
  });
});
