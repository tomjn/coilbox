// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RogueliteMeta, RogueliteRun } from "./model";

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

const record = {
  loadouts: [],
  eventPools: [],
  ascensionTier: 0,
  stats: { runs: 0, wins: 0, deepest: 0 },
  seen: [],
};

function metaDoc(over: Partial<RogueliteMeta> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    legacy: record,
    games: {},
    ...over,
  });
}

function stateDoc(runs: Record<string, RogueliteRun>): { json: string } {
  return { json: JSON.stringify({ schemaVersion: 1, runs }) };
}

/** The meta documents written to disk, in order. */
function written(): RogueliteMeta[] {
  return hoisted.metaSave.mock.calls.map(
    (c) => JSON.parse((c[0] as { json: string }).json) as RogueliteMeta,
  );
}

/** Fresh modules per test, since the stores live at module level. */
async function load() {
  vi.resetModules();
  const runs = await import("./runs");
  const award = await import("./useAwardFinishedRuns");
  let saveRun: (id: string, run: RogueliteRun) => Promise<void> =
    async () => {};

  function Page({ id }: { id: string }) {
    const { run: r, loading } = runs.useRun(id);
    award.useAwardFinishedRuns(r ? { [id]: r } : {}, loading);
    return null;
  }
  function List() {
    const api = runs.useRuns();
    saveRun = api.saveRun;
    award.useAwardFinishedRuns(api.runs, api.loading);
    return null;
  }
  return {
    Page,
    List,
    saveRun: (id: string, r: RogueliteRun) => saveRun(id, r),
  };
}

beforeEach(() => {
  hoisted.stateLoad.mockReset();
  hoisted.stateSave.mockReset().mockResolvedValue(undefined);
  hoisted.metaLoad.mockReset();
  hoisted.metaSave.mockReset().mockResolvedValue(undefined);
});

const seededDoc = () => metaDoc({ seenSeeded: true });

describe("a run that finished while its page was closed", () => {
  it("is awarded when the run page next opens", async () => {
    hoisted.stateLoad.mockResolvedValue(stateDoc({ r1: run("won") }));
    hoisted.metaLoad.mockResolvedValue({ json: seededDoc() });
    const { Page } = await load();
    render(<Page id="r1" />);
    await waitFor(() => expect(hoisted.metaSave).toHaveBeenCalledTimes(1));
    const meta = written()[0];
    expect(meta.games.ba.stats).toEqual({ runs: 1, wins: 1, deepest: 4 });
    expect(meta.games.ba.seen).toEqual(["r1"]);
  });

  it("is awarded when the run list next shows it", async () => {
    hoisted.stateLoad.mockResolvedValue(stateDoc({ r1: run("lost") }));
    hoisted.metaLoad.mockResolvedValue({ json: seededDoc() });
    const { List } = await load();
    render(<List />);
    await waitFor(() => expect(hoisted.metaSave).toHaveBeenCalledTimes(1));
    expect(written()[0].games.ba.stats.runs).toBe(1);
  });

  it("is awarded once when the page and the list both show it", async () => {
    hoisted.stateLoad.mockResolvedValue(stateDoc({ r1: run("won") }));
    hoisted.metaLoad.mockResolvedValue({ json: seededDoc() });
    const { Page, List } = await load();
    render(
      <>
        <List />
        <Page id="r1" />
      </>,
    );
    await waitFor(() => expect(hoisted.metaSave).toHaveBeenCalled());
    // Give a second observer every chance to write.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(hoisted.metaSave).toHaveBeenCalledTimes(1);
    expect(written()[0].games.ba.stats.runs).toBe(1);
  });

  it("two runs found by two observers are both kept", async () => {
    hoisted.stateLoad.mockResolvedValue(
      stateDoc({ r1: run("won"), r2: run("lost") }),
    );
    hoisted.metaLoad.mockResolvedValue({ json: seededDoc() });
    const { Page, List } = await load();
    render(
      <>
        <Page id="r1" />
        <List />
      </>,
    );
    await waitFor(() => expect(hoisted.metaSave).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const last = written().at(-1) as RogueliteMeta;
    expect(last.games.ba.stats.runs).toBe(2);
    expect(last.games.ba.seen.sort()).toEqual(["r1", "r2"]);
  });
});

describe("seeding", () => {
  it("never awards runs that finished before the seed, and writes the seed once", async () => {
    hoisted.stateLoad.mockResolvedValue(
      stateDoc({ old: run("won"), older: run("lost") }),
    );
    hoisted.metaLoad.mockResolvedValue({ json: metaDoc() });
    const { Page, List } = await load();
    const first = render(<List />);
    await waitFor(() => expect(hoisted.metaSave).toHaveBeenCalledTimes(1));
    const meta = written()[0];
    expect(meta.seenSeeded).toBe(true);
    expect(meta.legacy.seen.sort()).toEqual(["old", "older"]);
    expect(meta.legacy.stats.runs).toBe(0);
    expect(meta.games).toEqual({});

    // Showing the same runs again, here or on a page, writes nothing more.
    first.unmount();
    render(
      <>
        <List />
        <Page id="old" />
      </>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(hoisted.metaSave).toHaveBeenCalledTimes(1);
  });

  it("counts a run that finishes this session before the meta has loaded", async () => {
    hoisted.stateLoad.mockResolvedValue(
      stateDoc({ old: run("won"), live: run("active") }),
    );
    let resolveMeta: (v: { json: string }) => void = () => {};
    hoisted.metaLoad.mockReturnValue(
      new Promise((r) => {
        resolveMeta = r;
      }),
    );
    const { List, saveRun } = await load();
    render(<List />);
    await waitFor(() => expect(hoisted.stateLoad).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // The battle ends, and its result is saved, while the meta is still loading.
    await act(async () => {
      await saveRun("live", run("won"));
    });
    expect(hoisted.metaSave).not.toHaveBeenCalled();

    await act(async () => {
      resolveMeta({ json: metaDoc() });
    });
    await waitFor(() => expect(hoisted.metaSave).toHaveBeenCalled());
    const last = written().at(-1) as RogueliteMeta;
    expect(last.seenSeeded).toBe(true);
    expect(last.legacy.seen).toEqual(["old"]);
    expect(last.games.ba.seen).toEqual(["live"]);
    expect(last.games.ba.stats.runs).toBe(1);
  });
});

describe("writes", () => {
  it("writes nothing while the meta is loading", async () => {
    hoisted.stateLoad.mockResolvedValue(stateDoc({ r1: run("won") }));
    hoisted.metaLoad.mockReturnValue(new Promise(() => {}));
    const { List } = await load();
    render(<List />);
    await waitFor(() => expect(hoisted.stateLoad).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(hoisted.metaSave).not.toHaveBeenCalled();
  });

  it("writes nothing when the meta failed to load", async () => {
    hoisted.stateLoad.mockResolvedValue(stateDoc({ r1: run("won") }));
    hoisted.metaLoad.mockRejectedValue(new Error("disk unreadable"));
    const { List } = await load();
    render(<List />);
    await waitFor(() => expect(hoisted.metaLoad).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(hoisted.metaSave).not.toHaveBeenCalled();
  });

  it("writes nothing while the runs are loading", async () => {
    hoisted.stateLoad.mockReturnValue(new Promise(() => {}));
    hoisted.metaLoad.mockResolvedValue({ json: metaDoc() });
    const { List } = await load();
    render(<List />);
    await waitFor(() => expect(hoisted.metaLoad).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(hoisted.metaSave).not.toHaveBeenCalled();
  });

  it("never writes a document from a newer version", async () => {
    hoisted.stateLoad.mockResolvedValue(stateDoc({ r1: run("won") }));
    hoisted.metaLoad.mockResolvedValue({
      json: metaDoc({ schemaVersion: 99 }),
    });
    const { List } = await load();
    render(<List />);
    await waitFor(() => expect(hoisted.metaLoad).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(hoisted.metaSave).not.toHaveBeenCalled();
  });
});
