// @vitest-environment happy-dom

/**
 * The Timeline tab (#5396): opening an action from the Animation panel, its
 * rows and keys, the refusal on a script the game maker owns, scrubbing by the
 * ruler, and the settings that the action drawer used to hold.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { action, poseUnits, trackUnits, unit } from "../../actionFixtures";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";
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
  shownScript: number;
}

const seen: Seen = {
  project: unit(),
  playing: false,
  timeline: null,
  paused: false,
  frame: 0,
  shownScript: 0,
};

/**
 * The tab, and optionally the Animation panel beside it, over the state the
 * builder page holds for them.
 */
function Harness({
  initial,
  panel = false,
  open = true,
}: {
  initial: LegoProject;
  panel?: boolean;
  open?: boolean;
}) {
  const [project, setProject] = useState(initial);
  const [actionId, setActionId] = useState<string | null>(null);
  const [tabOpen, setTabOpen] = useState(open);
  const [playing, setPlaying] = useState(false);
  const [timeline, setTimeline] = useState<ScriptTimeline | null>(null);
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState(0);
  Object.assign(seen, { project, playing, timeline, paused, frame });

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
          onEdit={(change) => setProject(change)}
          playing={playing}
          onPlayingChange={setPlaying}
          scriptTimeline={timeline}
          onScriptTimeline={setTimeline}
          scriptPaused={paused}
          onScriptPausedChange={setPaused}
          scriptFrame={frame}
          onScriptFrameChange={setFrame}
          onRunReplaced={vi.fn()}
          onShowScript={() => {
            seen.shownScript++;
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
  it("says the unit runs its own script, and opens the Script tab", () => {
    seen.shownScript = 0;
    render(
      <Harness
        initial={{ ...poseUnits().plain, script: "function Create() end" }}
      />,
    );
    expect(screen.getByText("This unit runs its own script.")).toBeTruthy();
    expect(screen.queryByLabelText("Scrub the action")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Open the Script tab" }),
    );
    expect(seen.shownScript).toBe(1);
  });

  it("says the same for a compiled script", () => {
    render(
      <Harness
        initial={{
          ...poseUnits().plain,
          compiledScript: { member: "scripts/a.cob", bytes: [1, 2] },
        }}
      />,
    );
    expect(screen.getByText("This unit runs its own script.")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
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

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(seen.paused).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
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

  it("goes on playing the changed action after an edit, from the frame it was on", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Keys of arm on frame 30" }),
    );
    const before = seen.timeline;
    expect(seen.frame).toBe(30);
    fireEvent.click(screen.getByRole("switch", { name: "Loop" }));
    expect(seen.project.actions?.[0].loop).toBe(false);
    expect(seen.timeline).not.toBe(before);
    expect(seen.timeline?.end).toBe("hold");
    expect(seen.playing).toBe(true);
    expect(seen.frame).toBe(30);
  });

  it("pauses and seeks when the ruler is dragged, starting the run if there is none", () => {
    render(<Harness initial={poseUnits().plain} />);
    expect(seen.timeline).toBeNull();
    nudgeRuler("ArrowRight");
    expect(seen.playing).toBe(true);
    expect(seen.paused).toBe(true);
    expect(seen.frame).toBe(1);
    expect(seen.timeline?.action).toBe("act");

    nudgeRuler("ArrowRight");
    expect(seen.frame).toBe(2);
    nudgeRuler("Home");
    expect(seen.frame).toBe(0);
    // The ruler runs a second past the last key, which is frame 90.
    nudgeRuler("End");
    expect(seen.frame).toBe(120);
  });

  it("steps a frame at a time and seeks to a key's frame", () => {
    render(<Harness initial={poseUnits().plain} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Keys of arm on frame 30" }),
    );
    expect(seen.paused).toBe(true);
    expect(seen.frame).toBe(30);
    expect(screen.getByText("Frame 30, 1 s")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Step forward one frame" }),
    );
    expect(seen.frame).toBe(31);
    fireEvent.click(
      screen.getByRole("button", { name: "Step back one frame" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Step back one frame" }),
    );
    expect(seen.frame).toBe(29);
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
