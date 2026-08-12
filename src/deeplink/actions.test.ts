import { describe, expect, it } from "vitest";
import { encodeChallenge } from "../challenge/code";
import { encodeContainerCode } from "../container/container";
import { describeOpen, prepareImport } from "./actions";

const presetPayload = {
  participants: [],
  gameName: "Balanced Annihilation",
  mapName: "Comet Catcher",
  startPosType: 2,
  modOptionValues: {},
};

const packPayload = {
  engineVersion: "105.1.1",
  maps: ["Comet Catcher"],
  game: { shortname: "ba" },
};

describe("prepareImport", () => {
  it("rejects a non-coilbox payload", () => {
    const r = prepareImport("this-is-not-a-container");
    expect(r.ok).toBe(false);
  });

  it("routes a preset to the singleplayer importer", () => {
    const code = encodeContainerCode("preset", 1, presetPayload);
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.kind).toBe("preset");
      expect(r.plan.route).toContain("/play/skirmish?import=");
      expect(r.plan.compatibility).toBe("ok");
      expect(r.plan.warnings).toEqual([]);
    }
  });

  it("routes a conquest challenge to the conquest importer", () => {
    const code = encodeChallenge("conquest", {
      seed: 1,
      game: { shortname: "ba" },
      title: "x",
      nodeCount: 12,
      factionCount: 2,
    });
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.route).toContain("/conquest?import=");
  });

  it("routes a warpath challenge to the warpath importer", () => {
    const code = encodeChallenge("warpath", { seed: 2 });
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.route).toContain("/warpath?import=");
  });

  it("routes a setup pack to the setup-packs importer", () => {
    const code = encodeContainerCode("setup-pack", 1, packPayload);
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.route).toContain("/downloads/maps?import=");
  });

  it("routes a scenario to the player-facing Scenarios list", () => {
    const code = encodeContainerCode("scenario", 1, {
      scenario: { triggers: [], zones: [] },
      media: {},
    });
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.kind).toBe("scenario");
      expect(r.plan.route).toContain("/scenarios?import=");
    }
  });

  it("warns on a newer-version payload but still routes it", () => {
    const code = encodeContainerCode("preset", 99, presetPayload);
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.compatibility).toBe("newer");
      expect(r.plan.warnings.length).toBeGreaterThan(0);
    }
  });

  it("sends a campaign to the import box, which has no code importer", () => {
    const code = encodeContainerCode("campaign", 1, {
      type: "ta",
      missions: [],
    });
    const r = prepareImport(code);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.kind).toBe("campaign");
      expect(r.plan.route).toContain("/settings/import?import=");
      expect(r.plan.detail).toMatch(/import box/i);
    }
  });

  it("says a blueprint has nowhere to land rather than dropping it", () => {
    const code = encodeContainerCode("blueprint", 1, {
      name: "Opening",
      buildings: [],
      footprints: {},
    });
    const r = prepareImport(code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/blueprint/i);
  });
});

describe("describeOpen", () => {
  it("names the map for a map screen", () => {
    expect(describeOpen({ screen: "map", id: "Comet Catcher" })).toContain(
      "Comet Catcher",
    );
  });

  it("describes an idless screen", () => {
    expect(describeOpen({ screen: "conquest" })).toMatch(/conquest/i);
  });
});
