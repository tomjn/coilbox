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

describe("a damaged run file", () => {
  beforeEach(() => {
    hoisted.metaLoad.mockResolvedValue({ json: goodMeta });
  });

  const damaged: [string, string, RegExp][] = [
    [
      "text that is not JSON",
      '{"schemaVersion":1,"runs":{"a":',
      /not valid JSON/,
    ],
    ["JSON of the wrong shape", "[]", /not a JSON object/],
    ["a runs entry that is not an object", '{"runs":[]}', /not an object/],
    [
      "a file made by a newer coilbox",
      JSON.stringify({ schemaVersion: 2, runs: { old: run("old") } }),
      /newer version of coilbox/,
    ],
  ];

  for (const [name, json, reason] of damaged) {
    it(`reads ${name} as a failed load and a save writes nothing`, async () => {
      hoisted.stateLoad.mockResolvedValue({ json });
      const h = await load();
      await waitFor(() => expect(h.runsApi().error).toMatch(reason));
      await expect(h.runsApi().saveRun("r1", run("new"))).rejects.toThrow(
        reason,
      );
      await expect(h.runsApi().deleteRun("good")).rejects.toThrow(reason);
      expect(hoisted.stateSave).not.toHaveBeenCalled();
    });
  }

  const empty: [string, string][] = [
    ["an empty string", ""],
    ["the plugin default", '{"schemaVersion":1,"runs":{}}'],
  ];

  for (const [name, json] of empty) {
    it(`reads ${name} as no runs and a save writes`, async () => {
      hoisted.stateLoad.mockResolvedValue({ json });
      const h = await load();
      await waitFor(() => expect(h.runsApi().loading).toBe(false));
      expect(h.runsApi().error).toBeNull();
      await act(async () => {
        await h.runsApi().saveRun("r1", run("new"));
      });
      expect(hoisted.stateSave).toHaveBeenCalledTimes(1);
    });
  }
});

describe("a run file with one unreadable run among good ones", () => {
  const bad = { type: "roguelite-run", note: "made by something else" };
  const file = {
    schemaVersion: 1,
    runs: { a: run("a"), b: run("b"), bad },
  };

  beforeEach(() => {
    hoisted.metaLoad.mockResolvedValue({ json: goodMeta });
    hoisted.stateLoad.mockResolvedValue({ json: JSON.stringify(file) });
  });

  function written() {
    return JSON.parse(hoisted.stateSave.mock.calls[0][0].json);
  }

  it("loads the good runs with no error and does not list the bad one", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().loading).toBe(false));
    expect(h.runsApi().error).toBeNull();
    expect(Object.keys(h.runsApi().runs).sort()).toEqual(["a", "b"]);
    expect(h.runsApi().unreadableCount).toBe(1);
  });

  it("writes the bad entry back unchanged on a save", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().loading).toBe(false));
    await act(async () => {
      await h.runsApi().saveRun("a", run("changed"));
    });
    expect(written().runs.bad).toEqual(bad);
    expect(written().runs.a.name).toBe("changed");
  });

  it("writes the bad entry back unchanged on a delete", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().loading).toBe(false));
    await act(async () => {
      await h.runsApi().deleteRun("a");
    });
    expect(Object.keys(written().runs).sort()).toEqual(["b", "bad"]);
    expect(written().runs.bad).toEqual(bad);
  });

  it("writes the bad entry back unchanged when a new run is added", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().loading).toBe(false));
    await act(async () => {
      await h.runsApi().saveRun("fresh", run("fresh"));
    });
    expect(Object.keys(written().runs).sort()).toEqual([
      "a",
      "b",
      "bad",
      "fresh",
    ]);
    expect(written().runs.bad).toEqual(bad);
  });

  it("refuses a new run under the bad entry's key and writes nothing", async () => {
    const h = await load();
    await waitFor(() => expect(h.runsApi().loading).toBe(false));
    await expect(h.runsApi().saveRun("bad", run("clash"))).rejects.toThrow(
      /could not be read/,
    );
    expect(hoisted.stateSave).not.toHaveBeenCalled();
  });

  it("does not award the bad run or count it in the seed baseline", async () => {
    const finishedBad = {
      ...bad,
      progress: { status: "won", hull: 10, maxHull: 10 },
    };
    hoisted.stateLoad.mockResolvedValue({
      json: JSON.stringify({
        schemaVersion: 1,
        runs: { a: run("a"), bad: finishedBad },
      }),
    });
    const h = await load();
    await waitFor(() => expect(h.runsApi().loading).toBe(false));
    await waitFor(() => expect(h.metaApi().loading).toBe(false));
    const { observeFinishedRuns } = await import("./runs");
    await act(async () => {
      observeFinishedRuns(h.runsApi().runs);
    });
    expect(Object.keys(h.runsApi().runs)).toEqual(["a"]);
    expect(hoisted.metaSave).not.toHaveBeenCalled();
  });
});
