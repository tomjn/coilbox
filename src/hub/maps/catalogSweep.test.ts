import { describe, expect, it, vi } from "vitest";
import type { MapCatalogEntry, MapCatalogResult } from "../../content/bindings";
import type { MapHaveResult, MapSubmitResult } from "./catalog";
import {
  type SweepProgress,
  type SweepTools,
  sweepMapCatalog,
  sweepSummary,
} from "./catalogSweep";

const target = {
  hubUrl: "https://hub.example",
  enginePath: "/engines/105",
  dataDir: "/data",
};

function entry(mapName: string, sourceHash = "src-a"): MapCatalogEntry {
  return {
    map_name: mapName,
    source_archive: mapName,
    source_hash: sourceHash,
    catalog_version: 1,
    width_elmos: 8192,
    height_elmos: 8192,
    world_height_min: -50,
    world_height_max: 300,
  };
}

/**
 * A library of `names`, a hub that answers `status` for each, and a submission
 * route that stores everything unless told otherwise.
 *
 * The catalog call is one function for both passes, the way the binding is, so a
 * test can see that the second one asked for fewer maps than the first.
 */
function tools(
  names: string[],
  statuses: Record<string, MapHaveResult["status"]> = {},
  outcomes: Record<string, MapSubmitResult["outcome"]> = {},
  skipped: MapCatalogResult["skipped"] = [],
): SweepTools & { asked: () => string[][]; catalogCalls: () => unknown[] } {
  const catalogCalls: { maps?: string[]; keysOnly: boolean }[] = [];
  const asked: string[][] = [];
  return {
    catalog: vi.fn(async (args: { maps?: string[]; keysOnly: boolean }) => {
      catalogCalls.push(args);
      const wanted = args.maps ?? names;
      return {
        maps: wanted.map((mapName) => ({
          mapName,
          sourceHash: "src-a",
          catalogVersion: 1,
          ...(args.keysOnly ? {} : { entry: entry(mapName) }),
        })),
        skipped: args.keysOnly ? skipped : [],
        errors: [],
      };
    }) as unknown as SweepTools["catalog"],
    ask: vi.fn(async (_hubUrl: string, keys: { map_name: string }[]) => {
      asked.push(keys.map((key) => key.map_name));
      return keys.map((key) => ({
        map_name: key.map_name,
        status: statuses[key.map_name] ?? "missing",
      }));
    }) as unknown as SweepTools["ask"],
    send: vi.fn(async (_hubUrl: string, entries: MapCatalogEntry[]) =>
      entries.map((sent) => ({
        map_name: sent.map_name,
        outcome: outcomes[sent.map_name] ?? "stored",
      })),
    ) as unknown as SweepTools["send"],
    asked: () => asked,
    catalogCalls: () => catalogCalls,
  };
}

describe("sweepMapCatalog", () => {
  it("produces one entry per map archive and no duplicates", async () => {
    const kit = tools(["Isis 1.3", "Tabula 3", "Comet Catcher Remake 1.8"]);

    const report = await sweepMapCatalog(target, () => {}, kit);

    expect(report.read).toBe(3);
    expect(report.sent).toBe(3);
    const sent = (kit.send as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as MapCatalogEntry[];
    expect(sent.map((e) => e.map_name)).toEqual([
      "Isis 1.3",
      "Tabula 3",
      "Comet Catcher Remake 1.8",
    ]);
    expect(new Set(sent.map((e) => e.map_name)).size).toBe(sent.length);
  });

  /// The whole reason the sweep is two passes.
  it("asks before it reads a map's facts, and reads nothing for a map the hub has", async () => {
    const kit = tools(["Isis 1.3", "Tabula 3"], {
      "Isis 1.3": "have",
      "Tabula 3": "missing",
    });

    const report = await sweepMapCatalog(target, () => {}, kit);

    // Two catalog calls: the whole library keys-only, then the one wanted map.
    const calls = kit.catalogCalls() as {
      maps?: string[];
      keysOnly: boolean;
    }[];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ keysOnly: true });
    expect(calls[0].maps).toBeUndefined();
    expect(calls[1]).toMatchObject({ keysOnly: false, maps: ["Tabula 3"] });
    expect(kit.asked()).toEqual([["Isis 1.3", "Tabula 3"]]);
    expect(report.wanted).toBe(1);
    expect(report.sent).toBe(1);
  });

  it("sends nothing at all when the hub already has every map", async () => {
    const kit = tools(["Isis 1.3", "Tabula 3"], {
      "Isis 1.3": "have",
      "Tabula 3": "have",
    });

    const report = await sweepMapCatalog(target, () => {}, kit);

    expect(report.asked).toBe(2);
    expect(report.wanted).toBe(0);
    expect(report.sent).toBe(0);
    expect(kit.send).not.toHaveBeenCalled();
    // And the facts of neither were read, which is the expensive half.
    expect(kit.catalogCalls()).toHaveLength(1);
  });

  it("carries on past a map the hub would not take", async () => {
    const kit = tools(
      ["Isis 1.3", "Tabula 3", "Comet Catcher Remake 1.8"],
      {},
      { "Tabula 3": "conflict" },
    );

    const report = await sweepMapCatalog(target, () => {}, kit);

    expect(report.sent).toBe(2);
    expect(report.refused).toBe(1);
    expect(report.problems.map((p) => p.map_name)).toEqual(["Tabula 3"]);
  });

  it("reports what the library could not read", async () => {
    const kit = tools(["Isis 1.3"], {}, {}, [
      { mapName: "Rapid Map 1.0", reason: "no-archive-file" },
    ]);

    const report = await sweepMapCatalog(target, () => {}, kit);

    expect(report.skipped).toEqual([
      { mapName: "Rapid Map 1.0", reason: "no-archive-file" },
    ]);
  });

  it("counts maps rather than bytes as it goes", async () => {
    const kit = tools(["Isis 1.3", "Tabula 3"]);
    const seen: SweepProgress[] = [];

    await sweepMapCatalog(target, (p) => seen.push(p), kit);

    expect(seen.map((p) => p.phase)).toContain("asking");
    expect(seen.map((p) => p.phase)).toContain("sending");
    expect(seen.at(-1)).toEqual({ phase: "sending", done: 2, total: 2 });
  });

  it("does nothing with an empty library", async () => {
    const kit = tools([]);

    const report = await sweepMapCatalog(target, () => {}, kit);

    expect(report.read).toBe(0);
    expect(kit.ask).not.toHaveBeenCalled();
    expect(kit.send).not.toHaveBeenCalled();
  });
});

describe("sweepSummary", () => {
  const base = {
    read: 10,
    asked: 10,
    wanted: 3,
    sent: 3,
    refused: 0,
    problems: [],
    skipped: [],
    errors: [],
  };

  it("says what was sent", () => {
    expect(sweepSummary(base)).toBe("Sent facts for 3 maps.");
  });

  it("says nothing was needed when the hub had everything", () => {
    expect(sweepSummary({ ...base, wanted: 0, sent: 0 })).toBe(
      "The hub already had every map on this machine.",
    );
  });

  /// The interesting number, and it is about this machine rather than about the
  /// hub: a conflicting archive would not match in a game.
  it("words a conflict as what it means for this install", () => {
    const said = sweepSummary({
      ...base,
      sent: 2,
      refused: 1,
      problems: [{ map_name: "Isis 1.3", outcome: "conflict" }],
    });
    expect(said).toContain("differs from the version everyone else has");
    expect(said).not.toContain("hub would not take");
  });

  it("falls back to a count when the refusals are not all conflicts", () => {
    const said = sweepSummary({
      ...base,
      sent: 1,
      refused: 2,
      problems: [
        { map_name: "Isis 1.3", outcome: "conflict" },
        { map_name: "Tabula 3", outcome: "refused", said: "no" },
      ],
    });
    expect(said).toContain("would not take 2 of them");
  });
});
