/**
 * Issue #3147: `mapsTheHubWants` and `publishMapFacts` used to hand back only a
 * final answer, so a sweep watching them had nothing to show while a batch of
 * requests was in flight. Both now build a `Channel` and wire a caller's
 * `onProgress` to it, and this is what checks that wiring rather than trusting
 * it by inspection.
 *
 * A real `Channel` registers a callback with the Tauri IPC bridge, which is not
 * here, so it is stubbed the same way `Convert3doDrawer.dom.test.tsx` stubs it:
 * a plain class whose `onmessage` a caller can assign and this test can invoke
 * directly.
 */
import { describe, expect, it, vi } from "vitest";
import type { MapCatalogEntry } from "../../content/bindings";

interface RecordedCall {
  hubUrl: string;
  keys?: unknown[];
  entries?: unknown[];
  onProgress: { onmessage: ((value: unknown) => void) | null };
}

const calls: RecordedCall[] = [];
let nextResult: unknown = { results: [] };

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    () =>
    async (args: RecordedCall): Promise<unknown> => {
      calls.push(args);
      return nextResult;
    },
}));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;
  },
}));

const { mapsTheHubWants, publishMapFacts } = await import("./catalog");

function entry(mapName: string): MapCatalogEntry {
  return {
    map_name: mapName,
    source_archive: mapName,
    source_hash: "src-a",
    catalog_version: 1,
    width_elmos: 8192,
    height_elmos: 8192,
    world_height_min: -50,
    world_height_max: 300,
  };
}

describe("mapsTheHubWants", () => {
  it("asks nobody for an empty set, and builds no channel for it", async () => {
    calls.length = 0;
    const onProgress = vi.fn();
    const results = await mapsTheHubWants(
      "https://hub.example",
      [],
      onProgress,
    );
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("wires a caller's onProgress to the channel it sends the command", async () => {
    calls.length = 0;
    nextResult = { results: [{ map_name: "Isis 1.3", status: "missing" }] };
    const onProgress = vi.fn();
    const keys = [
      { map_name: "Isis 1.3", source_hash: "src-a", catalog_version: 1 },
    ];

    const results = await mapsTheHubWants(
      "https://hub.example",
      keys,
      onProgress,
    );

    expect(results).toEqual([{ map_name: "Isis 1.3", status: "missing" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].hubUrl).toBe("https://hub.example");
    expect(calls[0].keys).toEqual(keys);

    // The channel handed to the command is the one whose messages reach the
    // caller: this is the whole of what makes progress visible rather than
    // silently dropped.
    calls[0].onProgress.onmessage?.({ done: 1, total: 1 });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1 });
  });

  it("defaults to a silent onProgress, so a caller that does not ask still works", async () => {
    calls.length = 0;
    nextResult = { results: [] };
    const keys = [
      { map_name: "Isis 1.3", source_hash: "src-a", catalog_version: 1 },
    ];

    await mapsTheHubWants("https://hub.example", keys);

    expect(() =>
      calls[0].onProgress.onmessage?.({ done: 1, total: 1 }),
    ).not.toThrow();
  });
});

describe("publishMapFacts", () => {
  it("sends nobody an empty set, and builds no channel for it", async () => {
    calls.length = 0;
    const onProgress = vi.fn();
    const results = await publishMapFacts(
      "https://hub.example",
      [],
      onProgress,
    );
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("wires a caller's onProgress to the channel it sends the command", async () => {
    calls.length = 0;
    nextResult = { results: [{ map_name: "Isis 1.3", outcome: "stored" }] };
    const onProgress = vi.fn();
    const entries = [entry("Isis 1.3")];

    const results = await publishMapFacts(
      "https://hub.example",
      entries,
      onProgress,
    );

    expect(results).toEqual([{ map_name: "Isis 1.3", outcome: "stored" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].entries).toEqual(entries);

    calls[0].onProgress.onmessage?.({ done: 1, total: 1 });
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1 });
  });
});
