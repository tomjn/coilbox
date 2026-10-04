// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyMeta, type RogueliteMeta, type RogueliteRun } from "./model";
import {
  type AwardMetaState,
  useAwardFinishedRun,
} from "./useAwardFinishedRun";

afterEach(cleanup);

function run(
  status: "active" | "won" | "lost",
  shortname = "ba",
): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name: "Test Reach",
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname },
      factionId: "p",
      skin: "galaxy",
    },
    nodes: [
      { id: "start", type: "start", col: 0, row: 0 },
      { id: "n", type: "battle", col: 4, row: 0 },
    ],
    edges: [["start", "n"]],
    progress: {
      currentNodeId: "n",
      visited: ["start", "n"],
      hull: status === "lost" ? 0 : 50,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status,
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

interface Props {
  run: RogueliteRun | null;
  id?: string;
  state: AwardMetaState;
}

function setup(initial: Props) {
  return renderHook(
    ({ run, id = "r1", state }: Props) => useAwardFinishedRun(run, id, state),
    { initialProps: initial },
  );
}

function metaState(
  save: AwardMetaState["save"],
  over: Partial<AwardMetaState> = {},
): AwardMetaState {
  return { meta: emptyMeta, loading: false, error: null, save, ...over };
}

describe("useAwardFinishedRun", () => {
  it("awards a run that finishes while the page is open, once, into its game", () => {
    const save = vi.fn();
    const state = metaState(save);
    const { rerender } = setup({ run: run("active"), state });
    expect(save).not.toHaveBeenCalled();

    rerender({ run: run("won"), state });
    expect(save).toHaveBeenCalledTimes(1);
    const written = save.mock.calls[0][0] as RogueliteMeta;
    expect(written.games.ba.stats).toEqual({ runs: 1, wins: 1, deepest: 4 });
    expect(written.games.ba.seen).toEqual(["r1"]);
    expect(written.legacy.stats.runs).toBe(0);
  });

  it("awards nothing more when the finished run is rendered again", () => {
    const save = vi.fn();
    const first = metaState(save);
    const { rerender } = setup({ run: run("active"), state: first });
    rerender({ run: run("lost"), state: first });
    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0] as RogueliteMeta;

    // The saved meta flows back in, and the run re-renders more than once.
    const second = metaState(save, { meta: saved });
    rerender({ run: run("lost"), state: second });
    rerender({ run: run("lost"), state: second });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("awards nothing when the page opens on a run already finished", () => {
    const save = vi.fn();
    const state = metaState(save);
    const { rerender } = setup({ run: run("won"), state });
    rerender({ run: run("won"), state });
    expect(save).not.toHaveBeenCalled();
  });

  it("writes nothing while the meta is loading, then awards once it has loaded", () => {
    const save = vi.fn();
    const loading = metaState(save, { loading: true });
    const { rerender } = setup({ run: run("active"), state: loading });
    rerender({ run: run("won"), state: loading });
    expect(save).not.toHaveBeenCalled();

    rerender({ run: run("won"), state: metaState(save) });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the meta failed to load", () => {
    const save = vi.fn();
    const failed = metaState(save, { error: "disk unreadable" });
    const { rerender } = setup({ run: run("active"), state: failed });
    rerender({ run: run("won"), state: failed });
    rerender({ run: run("won"), state: failed });
    expect(save).not.toHaveBeenCalled();
  });

  it("puts a run with no game shortname in the legacy record", () => {
    const save = vi.fn();
    const state = metaState(save);
    const { rerender } = setup({ run: run("active", ""), state });
    rerender({ run: run("won", ""), state });
    expect(save).toHaveBeenCalledTimes(1);
    const written = save.mock.calls[0][0] as RogueliteMeta;
    expect(written.legacy.stats.runs).toBe(1);
    expect(written.legacy.seen).toEqual(["r1"]);
    expect(written.games).toEqual({});
  });
});
