// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RogueliteRun } from "./model";

const hoisted = vi.hoisted(() => ({
  stateLoad: vi.fn(),
  stateSave: vi.fn(),
  metaLoad: vi.fn(),
  metaSave: vi.fn(),
}));

vi.mock("./bindings", () => ({
  runliteStateLoad: hoisted.stateLoad,
  runliteStateSave: hoisted.stateSave,
  runliteMetaLoad: hoisted.metaLoad,
  runliteMetaSave: hoisted.metaSave,
}));

afterEach(cleanup);

function run(name: string): RogueliteRun {
  return {
    schemaVersion: 1,
    type: "roguelite-run",
    name,
    settings: {
      seed: 1,
      length: "standard",
      difficulty: 2,
      ascension: 0,
      game: { shortname: "ba" },
      factionId: "p",
      skin: "galaxy",
    },
    nodes: [{ id: "start", type: "start", col: 0, row: 0 }],
    edges: [],
    progress: {
      currentNodeId: "start",
      visited: ["start"],
      hull: 50,
      maxHull: 100,
      salvage: 0,
      unlockedUnits: [],
      perks: [],
      status: "active",
    },
    history: [],
    createdAt: "t",
    updatedAt: "t",
  };
}

const goodMeta = JSON.stringify({
  schemaVersion: 2,
  seenSeeded: true,
  legacy: {
    loadouts: [],
    eventPools: [],
    ascensionTier: 0,
    stats: { runs: 0, wins: 0, deepest: 0 },
    seen: [],
  },
  games: {},
});

/** Fresh modules per test, since the stores live at module level. */
async function load() {
  vi.resetModules();
  const runs = await import("./runs");
  let runsApi: ReturnType<typeof runs.useRuns>;
  let metaApi: ReturnType<typeof runs.useRunMeta>;
  function Probe() {
    runsApi = runs.useRuns();
    metaApi = runs.useRunMeta();
    return null;
  }
  render(<Probe />);
  return {
    runsApi: () => runsApi,
    metaApi: () => metaApi,
    refreshRuns: () => act(async () => runsApi.refresh()),
    refreshMeta: () => act(async () => metaApi.refresh()),
  };
}

beforeEach(() => {
  hoisted.stateLoad.mockReset();
  hoisted.stateSave.mockReset().mockResolvedValue(undefined);
  hoisted.metaLoad.mockReset();
  hoisted.metaSave.mockReset().mockResolvedValue(undefined);
});

describe("after the runs failed to load", () => {
  beforeEach(() => {
    hoisted.stateLoad.mockRejectedValue(
      new Error("run.json could not be read"),
    );
    hoisted.metaLoad.mockResolvedValue({ json: goodMeta });
  });

  it("saveRun writes nothing and rejects with the reason", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().error).not.toBeNull());
    await expect(h.runsApi().saveRun("r1", run("new"))).rejects.toThrow(
      /could not be read/,
    );
    expect(hoisted.stateSave).not.toHaveBeenCalled();
  });

  it("deleteRun writes nothing and rejects", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().error).not.toBeNull());
    await expect(h.runsApi().deleteRun("r1")).rejects.toThrow(
      /could not be read/,
    );
    expect(hoisted.stateSave).not.toHaveBeenCalled();
  });

  it("writes normally once a later load succeeds", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().error).not.toBeNull());
    hoisted.stateLoad.mockResolvedValue({
      json: JSON.stringify({ schemaVersion: 1, runs: { old: run("old") } }),
    });
    await h.refreshRuns();
    await act(async () => {
      await h.runsApi().saveRun("r1", run("new"));
    });
    expect(hoisted.stateSave).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(hoisted.stateSave.mock.calls[0][0].json);
    expect(Object.keys(saved.runs).sort()).toEqual(["old", "r1"]);
  });
});

describe("while the runs are still loading", () => {
  it("saveRun writes nothing", async () => {
    hoisted.stateLoad.mockReturnValue(new Promise(() => {}));
    hoisted.metaLoad.mockResolvedValue({ json: goodMeta });
    const h = await load();
    await expect(h.runsApi().saveRun("r1", run("new"))).rejects.toThrow(
      /still loading/,
    );
    expect(hoisted.stateSave).not.toHaveBeenCalled();
  });
});

describe("after the meta failed to load", () => {
  beforeEach(() => {
    hoisted.stateLoad.mockResolvedValue({
      json: JSON.stringify({ schemaVersion: 1, runs: {} }),
    });
    hoisted.metaLoad.mockResolvedValue({ json: '{"schemaVersion":2,"leg' });
  });

  it("the meta save writes nothing and rejects", async () => {
    const h = await load();
    await waitFor(() => expect(h.metaApi().error).not.toBeNull());
    await expect(h.metaApi().save(h.metaApi().meta)).rejects.toThrow(
      /could not be read/,
    );
    expect(hoisted.metaSave).not.toHaveBeenCalled();
  });

  it("the meta save writes once a later load succeeds", async () => {
    const h = await load();
    await waitFor(() => expect(h.metaApi().error).not.toBeNull());
    hoisted.metaLoad.mockResolvedValue({ json: goodMeta });
    await h.refreshMeta();
    await act(async () => {
      await h.metaApi().save(h.metaApi().meta);
    });
    expect(hoisted.metaSave).toHaveBeenCalledTimes(1);
  });
});
