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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "../../model";
import type { ScriptTimeline } from "../../scriptPlayback";
import { AnimationPanel } from "./AnimationPanel";

const runLua = vi.fn();
const runCob = vi.fn();

vi.mock("../../bindings", () => ({
  legoRunScript: (args: unknown) => runLua(args),
}));

vi.mock("../../../animation/bindings", () => ({
  animCobRun: (args: unknown) => runCob(args),
}));

// Reads a stored setting through the app frame, which a panel rendered on its
// own is not inside. Nothing here is about reduced motion.
vi.mock("../../../general/display", () => ({
  useReduceMotion: () => false,
}));

function timeline(): ScriptTimeline {
  return {
    fps: 30,
    pieces: ["base"],
    frames: [[0, 0, 0, 0, 0, 0]],
    hidden: [],
    error: null,
    warnings: [],
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

function show(value: LegoProject) {
  return render(
    <AnimationPanel
      project={value}
      playing={false}
      onPlayingChange={vi.fn()}
      onChange={vi.fn()}
      onScriptChange={vi.fn()}
      onScriptRelease={vi.fn()}
      onBuilderChange={vi.fn()}
      onScriptTimeline={vi.fn()}
      scriptPaused={false}
      onScriptPausedChange={vi.fn()}
      scriptFrame={0}
      onScriptFrameChange={vi.fn()}
    />,
  );
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
