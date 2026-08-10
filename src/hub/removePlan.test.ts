import { describe, expect, it } from "vitest";
import type { HubImportRecord } from "./importRecord";
import { planRemoval, type RemovalStores } from "./removePlan";

const EMPTY: RemovalStores = {
  presets: [],
  galaxies: [],
  playing: new Set(),
  runs: [],
  scenarios: [],
  attached: new Set(),
};

function stores(part: Partial<RemovalStores>): RemovalStores {
  return { ...EMPTY, ...part };
}

function record(refs: string[]): HubImportRecord {
  return {
    id: "hub-item",
    refs,
    route: "/play/skirmish",
    at: "2026-08-10T00:00:00Z",
  };
}

const PRESET = { kind: "preset", mode: null } as const;
const PACK = { kind: "setup-pack", mode: null } as const;
const CONQUEST = { kind: "challenge", mode: "conquest" } as const;
const WARPATH = { kind: "challenge", mode: "warpath" } as const;
const SCENARIO = { kind: "scenario", mode: null } as const;

describe("planRemoval", () => {
  it("has nothing to remove for an item that was never imported", () => {
    expect(
      planRemoval(
        PRESET,
        undefined,
        stores({ presets: [{ id: "p1", name: "A" }] }),
      ),
    ).toBeNull();
  });

  it("has nothing to remove when what it produced is already gone", () => {
    expect(planRemoval(PRESET, record(["p1"]), EMPTY)).toBeNull();
  });

  it("names the preset it will delete", () => {
    const plan = planRemoval(
      PRESET,
      record(["p1"]),
      stores({
        presets: [
          { id: "p1", name: "Obsidian Belt" },
          { id: "p2", name: "Somebody else's" },
        ],
      }),
    );
    expect(plan).toEqual({
      store: "preset",
      targets: [{ id: "p1", name: "Obsidian Belt" }],
      summary: "Delete “Obsidian Belt”?",
      warning: null,
    });
  });

  it("takes every preset a setup pack brought, and nothing else", () => {
    const plan = planRemoval(
      PACK,
      record(["p1", "p3"]),
      stores({
        presets: [
          { id: "p1", name: "One" },
          { id: "p2", name: "Not from the pack" },
          { id: "p3", name: "Three" },
        ],
      }),
    );
    expect(plan?.targets.map((t) => t.id)).toEqual(["p1", "p3"]);
    expect(plan?.summary).toBe("Delete “One”, “Three”?");
  });

  it("skips a ref that has already been deleted by hand", () => {
    const plan = planRemoval(
      PACK,
      record(["p1", "gone"]),
      stores({ presets: [{ id: "p1", name: "One" }] }),
    );
    expect(plan?.targets.map((t) => t.id)).toEqual(["p1"]);
  });

  it("counts rather than lists once there are too many to read", () => {
    const presets = ["a", "b", "c", "d"].map((id) => ({ id, name: id }));
    const plan = planRemoval(
      PACK,
      record(["a", "b", "c", "d"]),
      stores({ presets }),
    );
    expect(plan?.summary).toBe("Delete 4 presets?");
  });

  it("warns that a conquest galaxy takes a game in progress with it", () => {
    const galaxies = [{ id: "g1", title: "Obsidian Belt" }];
    const quiet = planRemoval(CONQUEST, record(["g1"]), stores({ galaxies }));
    expect(quiet).toEqual({
      store: "galaxy",
      targets: [{ id: "g1", name: "Obsidian Belt" }],
      summary: "Delete “Obsidian Belt”?",
      warning: null,
    });

    const playing = planRemoval(
      CONQUEST,
      record(["g1"]),
      stores({ galaxies, playing: new Set(["g1"]) }),
    );
    expect(playing?.warning).toBe(
      "You have a game in progress on it, which goes too.",
    );
  });

  it("will not remove a bundled galaxy, which is not there to be removed", () => {
    // The hook only ever passes local ones, so a bundled galaxy simply is not
    // in the list and the record points at nothing.
    expect(planRemoval(CONQUEST, record(["bundled"]), EMPTY)).toBeNull();
  });

  it("says a warpath run's progress goes with it", () => {
    const plan = planRemoval(
      WARPATH,
      record(["r1"]),
      stores({ runs: [{ id: "r1", name: "Kestrel Reach" }] }),
    );
    expect(plan).toEqual({
      store: "run",
      targets: [{ id: "r1", name: "Kestrel Reach" }],
      summary: "Delete “Kestrel Reach”?",
      warning: "However far you have got in it goes too.",
    });
  });

  it("keeps an attached scenario's clips and says why", () => {
    const scenarios = [{ id: "s1", name: "First contact" }];
    const loose = planRemoval(SCENARIO, record(["s1"]), stores({ scenarios }));
    expect(loose?.targets).toEqual([
      { id: "s1", name: "First contact", keepMedia: false },
    ]);
    expect(loose?.warning).toBeNull();

    const attached = planRemoval(
      SCENARIO,
      record(["s1"]),
      stores({ scenarios, attached: new Set(["s1"]) }),
    );
    expect(attached?.targets[0].keepMedia).toBe(true);
    expect(attached?.warning).toMatch(/campaign mission plays this scenario/);
  });
});
