import { describe, expect, it, vi } from "vitest";

import type { Scenario } from "../../model";
import { createScenarioSaver } from "./saving";

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 2,
    id: "s1",
    name: "Test",
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "Game",
      mapName: "Map",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    blueprints: [],
    bases: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** A document with `count` actors on it, standing in for that many placements. */
const placed = (count: number) =>
  scenario({
    actors: Array.from({ length: count }, (_, i) => ({
      id: `a${i}`,
      unitDef: "armcom",
      team: "you",
      pos: { x: 0, z: 0 },
      facing: 0,
    })),
  });

/**
 * A `write` that takes longer the earlier the edit was, which is the shape that
 * lost an edit: an earlier save resolving last. `delays` is keyed by how many
 * actors the document has.
 */
function slowWrites(delays: Record<number, number>) {
  const written: Scenario[] = [];
  const write = async (doc: Scenario) => {
    await new Promise((r) => setTimeout(r, delays[doc.actors.length] ?? 0));
    written.push(doc);
    return { ...doc, updatedAt: `stamp-${written.length}` };
  };
  return { written, write };
}

describe("createScenarioSaver", () => {
  it("writes and shows what came back", async () => {
    const shown: Scenario[] = [];
    const saver = createScenarioSaver({
      write: async (doc) => ({ ...doc, updatedAt: "stamped" }),
      onWritten: (doc) => {
        shown.push(doc);
      },
      onError: () => {},
    });

    saver.save(placed(1));
    await saver.settled();

    expect(shown).toHaveLength(1);
    expect(shown[0].updatedAt).toBe("stamped");
  });

  it("keeps every edit made in the same moment, on disk and on screen", async () => {
    // The first write is the slowest, so without a queue it would land last and
    // put a one-actor document on disk and back on the screen.
    const { written, write } = slowWrites({ 1: 30, 2: 15, 3: 0 });
    const shown: Scenario[] = [];
    const saver = createScenarioSaver({
      write,
      onWritten: (doc) => {
        shown.push(doc);
      },
      onError: () => {},
    });

    // Three placements in the same tick, each built on the last.
    saver.save(placed(1));
    saver.save(placed(2));
    saver.save(placed(3));
    await saver.settled();

    // The newest document is the last thing written, so it is what is on disk.
    expect(written.map((d) => d.actors.length)).toEqual([1, 2, 3]);
    // And the superseded writes never reached the screen.
    expect(shown.map((d) => d.actors.length)).toEqual([3]);
  });

  it("reports a failed write and still runs the next one", async () => {
    const errors: unknown[] = [];
    const shown: Scenario[] = [];
    const write = vi
      .fn<(doc: Scenario) => Promise<Scenario>>()
      .mockRejectedValueOnce(new Error("disk is full"))
      .mockImplementation(async (doc) => doc);
    const saver = createScenarioSaver({
      write,
      onWritten: (doc) => {
        shown.push(doc);
      },
      onError: (e) => errors.push(e),
    });

    saver.save(placed(1));
    await saver.settled();
    saver.save(placed(2));
    await saver.settled();

    expect((errors[0] as Error).message).toBe("disk is full");
    expect(shown.map((d) => d.actors.length)).toEqual([2]);
  });
});
