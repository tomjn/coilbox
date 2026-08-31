import { describe, expect, it, vi } from "vitest";

// offer.ts reaches mutator.ts, and launch.ts the plugin, through bindings.ts,
// whose plugin-sdk import Vitest's node resolver cannot load from the published
// dist. Stubbed the way launch.test.ts stubs it.
vi.mock("./bindings", () => ({
  scenarioRuntimeStatus: vi.fn(),
  scenarioWriteMission: vi.fn(),
  scenarioTestMutator: vi.fn(),
  scenarioReadMission: vi.fn(),
}));

import type { GameItem } from "../content/bindings";
import { MUTATOR_FOLDER } from "../lib/generatedGames";
import type { RuntimeMarker } from "./bindings";
import { scenarioRoute } from "./launch";
import { mutatorOffer } from "./offer";

const marker = (version: number): RuntimeMarker => ({
  version,
  schemaVersion: 1,
  conditions: ["units_in_zone"],
  actions: ["victory"],
});

const PACKAGED: GameItem = {
  name: "Balanced Annihilation",
  primaryArchive: { name: "ba1598.sdz", path: "/games/ba1598.sdz" },
  dependencyArchives: [],
  info: {},
};

describe("mutatorOffer", () => {
  it("gives a packaged game the same reason its launch would", () => {
    const { reason } = mutatorOffer("Balanced Annihilation", marker(2));

    expect(reason).toBe(
      scenarioRoute({
        // The runtime the offer itself is about, so this asks the question the
        // offer asks: a packaged game that has adopted the runtime and still
        // cannot be written into. A null here would ask whether it has adopted
        // one at all, which is a different sentence.
        game: PACKAGED,
        installed: 2,
        required: 1,
        reader: "author",
      }).reason,
    );
    expect(reason).toContain("packaged archive");
  });

  it("names the folder, the base game and the runtime it would carry", () => {
    const { offer } = mutatorOffer("Balanced Annihilation", marker(2));

    expect(offer).toContain(MUTATOR_FOLDER);
    expect(offer).toContain("Balanced Annihilation");
    expect(offer).toContain("version 2");
  });

  it("says the mutator is for testing and not for shipping", () => {
    const { limit } = mutatorOffer("Balanced Annihilation", marker(2));

    expect(limit).toContain("never a distribution one");
    expect(limit).toContain(".sdd");
  });

  it("promises no mutator when this build ships no runtime", () => {
    const { reason, offer, limit } = mutatorOffer(
      "Balanced Annihilation",
      null,
    );

    expect(reason).toContain("cannot install the mission runtime");
    expect(offer).toContain("no test mutator");
    expect(offer).not.toContain(MUTATOR_FOLDER);
    expect(limit).toBeNull();
  });
});
