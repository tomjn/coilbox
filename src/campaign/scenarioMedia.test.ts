import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaReadMock = vi.fn();
const mediaWriteMock = vi.fn();

// The media helpers reach the plugin through the scenario bindings, whose
// plugin-sdk import Vitest's node resolver cannot load from the published dist.
// Stubbing the bindings module keeps the logic testable, the way
// scenario/storage.test.ts stubs its own.
vi.mock("../scenario/bindings", () => ({
  scenarioMediaRead: (...args: unknown[]) => mediaReadMock(...args),
  scenarioMediaWrite: (...args: unknown[]) => mediaWriteMock(...args),
}));

import type { Scenario } from "../scenario/model";
import type { Campaign, CampaignMission } from "./model";
import {
  clipIsAttached,
  collectCampaignScenarioMedia,
  dropUnavailableDialogueMedia,
  restoreCampaignScenarioMedia,
} from "./scenarioMedia";

const PORTRAIT = "data:image/png;base64,aGk=";
const VOICE = "data:audio/ogg;base64,b2dn";

function scenario(id: string, over: Partial<Scenario> = {}): Scenario {
  return {
    schemaVersion: 1,
    id,
    name: id,
    description: "",
    runtimeVersion: 1,
    setup: {
      participants: [],
      gameName: "BAR",
      mapName: "Bismuth Valley",
      startPosType: 0,
      modOptionValues: {},
    },
    teams: {},
    zones: [],
    actors: [],
    groups: [],
    prefabs: [],
    restrictions: {},
    vars: {},
    triggers: [],
    objectives: [],
    dialogue: [
      {
        id: "d1",
        speaker: "Vega",
        text: "Hold the line.",
        portrait: "a.png",
        audio: "a.ogg",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function mission(id: string, attached?: Scenario): CampaignMission {
  return {
    id,
    title: id,
    briefing: "",
    objectives: [],
    snapshot: {
      participants: [],
      gameName: "BAR",
      mapName: "Bismuth Valley",
      startPosType: 0,
      modOptionValues: {},
    },
    scenario: attached,
    disabledUnits: [],
    skippable: false,
  };
}

function campaign(missions: CampaignMission[]): Campaign {
  return {
    schemaVersion: 1,
    id: "c1",
    type: "ta",
    title: "Test",
    description: "",
    missions,
    createdAt: "t0",
    updatedAt: "t1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mediaReadMock.mockImplementation(({ file }: { file: string }) =>
    Promise.resolve({ dataUrl: file.endsWith(".png") ? PORTRAIT : VOICE }),
  );
  mediaWriteMock.mockResolvedValue({});
});

describe("collectCampaignScenarioMedia", () => {
  it("reads every attached scenario's clips, keyed by scenario id", async () => {
    const media = await collectCampaignScenarioMedia(
      campaign([mission("m1", scenario("s1"))]),
    );
    expect(media).toEqual({ s1: { "a.png": PORTRAIT, "a.ogg": VOICE } });
  });

  it("is empty for a campaign with no scenarios", async () => {
    expect(
      await collectCampaignScenarioMedia(campaign([mission("m1")])),
    ).toEqual({});
    expect(mediaReadMock).not.toHaveBeenCalled();
  });

  it("reads a scenario two missions share only once per clip", async () => {
    await collectCampaignScenarioMedia(
      campaign([mission("m1", scenario("s1")), mission("m2", scenario("s1"))]),
    );
    expect(mediaReadMock).toHaveBeenCalledTimes(2);
  });

  it("leaves out a clip that cannot be read rather than failing", async () => {
    mediaReadMock.mockImplementation(({ file }: { file: string }) =>
      file === "a.ogg"
        ? Promise.reject(new Error("gone"))
        : Promise.resolve({ dataUrl: PORTRAIT }),
    );
    const media = await collectCampaignScenarioMedia(
      campaign([mission("m1", scenario("s1"))]),
    );
    expect(media).toEqual({ s1: { "a.png": PORTRAIT } });
  });
});

describe("restoreCampaignScenarioMedia", () => {
  it("writes each clip under the scenario id it came from", async () => {
    const written = await restoreCampaignScenarioMedia({
      s1: { "a.png": PORTRAIT },
    });
    expect(mediaWriteMock).toHaveBeenCalledWith({
      scenarioId: "s1",
      file: "a.png",
      dataUri: PORTRAIT,
    });
    expect(written.get("s1")).toEqual(new Set(["a.png"]));
  });

  it("reports a rejected clip as not written", async () => {
    mediaWriteMock.mockRejectedValueOnce(new Error("too big"));
    const written = await restoreCampaignScenarioMedia({
      s1: { "a.png": PORTRAIT, "a.ogg": VOICE },
    });
    expect(written.get("s1")).toEqual(new Set(["a.ogg"]));
  });
});

describe("clipIsAttached", () => {
  const attached = [campaign([mission("m1", scenario("s1"))])];

  it("holds a clip a mission's snapshot still names", () => {
    expect(clipIsAttached(attached, "s1", "a.png")).toBe(true);
    expect(clipIsAttached(attached, "s1", "a.ogg")).toBe(true);
  });

  it("releases a clip no snapshot names", () => {
    expect(clipIsAttached(attached, "s1", "b.png")).toBe(false);
    expect(clipIsAttached([], "s1", "a.png")).toBe(false);
  });

  it("does not confuse one scenario's clips for another's", () => {
    expect(clipIsAttached(attached, "s2", "a.png")).toBe(false);
  });

  it("ignores a mission with no scenario", () => {
    expect(clipIsAttached([campaign([mission("m1")])], "s1", "a.png")).toBe(
      false,
    );
  });
});

describe("dropUnavailableDialogueMedia", () => {
  it("keeps references to clips that landed", () => {
    const dropped = dropUnavailableDialogueMedia(
      campaign([mission("m1", scenario("s1"))]),
      new Map([["s1", new Set(["a.png", "a.ogg"])]]),
    );
    expect(dropped.missions[0].scenario?.dialogue[0]).toMatchObject({
      portrait: "a.png",
      audio: "a.ogg",
    });
  });

  it("drops a reference to a clip that did not arrive", () => {
    const dropped = dropUnavailableDialogueMedia(
      campaign([mission("m1", scenario("s1"))]),
      new Map([["s1", new Set(["a.png"])]]),
    );
    expect(dropped.missions[0].scenario?.dialogue[0]).toMatchObject({
      portrait: "a.png",
      audio: undefined,
    });
  });

  it("drops every reference for a scenario that carried no clips", () => {
    const dropped = dropUnavailableDialogueMedia(
      campaign([mission("m1", scenario("s1"))]),
      new Map(),
    );
    expect(dropped.missions[0].scenario?.dialogue[0]).toMatchObject({
      portrait: undefined,
      audio: undefined,
    });
  });

  it("leaves a mission with no scenario alone", () => {
    const before = campaign([mission("m1")]);
    expect(dropUnavailableDialogueMedia(before, new Map()).missions[0]).toEqual(
      before.missions[0],
    );
  });
});

describe("export and import round trip", () => {
  it("carries a campaign's dialogue media to a machine that has none", async () => {
    const store = new Map<string, string>([
      ["s1/a.png", PORTRAIT],
      ["s1/a.ogg", VOICE],
    ]);
    mediaReadMock.mockImplementation(
      ({ scenarioId, file }: { scenarioId: string; file: string }) => {
        const found = store.get(`${scenarioId}/${file}`);
        return found
          ? Promise.resolve({ dataUrl: found })
          : Promise.reject(new Error("not here"));
      },
    );
    const source = campaign([mission("m1", scenario("s1"))]);
    const media = await collectCampaignScenarioMedia(source);

    // The importing machine has an empty store.
    const landed = new Map<string, string>();
    mediaWriteMock.mockImplementation(
      ({
        scenarioId,
        file,
        dataUri,
      }: {
        scenarioId: string;
        file: string;
        dataUri: string;
      }) => {
        landed.set(`${scenarioId}/${file}`, dataUri);
        return Promise.resolve({});
      },
    );
    const imported = dropUnavailableDialogueMedia(
      source,
      await restoreCampaignScenarioMedia(media),
    );

    expect([...landed]).toEqual([...store]);
    expect(imported.missions[0].scenario?.dialogue[0]).toMatchObject({
      portrait: "a.png",
      audio: "a.ogg",
    });
  });
});
