import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaReadMock = vi.fn();
const mediaWriteMock = vi.fn();
const campaignListMock = vi.fn();
const scenarioListMock = vi.fn();
const mediaSweepMock = vi.fn();

// The media helpers reach the plugin through the scenario bindings, whose
// plugin-sdk import Vitest's node resolver cannot load from the published dist.
// Stubbing the bindings module keeps the logic testable, the way
// scenario/storage.test.ts stubs its own.
vi.mock("../scenario/bindings", () => ({
  scenarioMediaRead: (...args: unknown[]) => mediaReadMock(...args),
  scenarioMediaWrite: (...args: unknown[]) => mediaWriteMock(...args),
  scenarioList: (...args: unknown[]) => scenarioListMock(...args),
  scenarioMediaSweep: (...args: unknown[]) => mediaSweepMock(...args),
  // Unused here, but `scenario/storage.ts` imports them and a mocked module
  // throws on an export it was never given.
  scenarioSave: vi.fn(),
  scenarioDelete: vi.fn(),
  scenarioMediaImport: vi.fn(),
  scenarioMediaDelete: vi.fn(),
}));

vi.mock("./bindings", () => ({
  campaignList: (...args: unknown[]) => campaignListMock(...args),
}));

import type { Scenario } from "../scenario/model";
import { listScenarios } from "../scenario/storage";
import { encodeScenarioExport } from "../scenario/transfer";
import type { Campaign, CampaignMission } from "./model";
import {
  clipIsAttached,
  collectCampaignScenarioMedia,
  dropUnavailableDialogueMedia,
  ensureCampaignScenarioMedia,
  namedScenarioClips,
  restoreCampaignScenarioMedia,
  sweepOrphanedScenarioMedia,
} from "./scenarioMedia";
import { wrapCampaignForExport } from "./transfer";

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

function campaign(missions: CampaignMission[], id = "c1"): Campaign {
  return {
    schemaVersion: 1,
    id,
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
  campaignListMock.mockResolvedValue({ items: [] });
  scenarioListMock.mockResolvedValue({ items: [] });
  mediaSweepMock.mockResolvedValue({
    summary: { applied: true, folders: [], files: [], bytes: 0 },
  });
});

/** A bundled campaign as it sits in `.coilbox/campaigns/`: the exported file. */
function bundled(id: string) {
  return {
    source: "bundled" as const,
    json: JSON.stringify(
      wrapCampaignForExport(campaign([mission("m1", scenario("s1"))], id), {
        s1: { "a.png": PORTRAIT, "a.ogg": VOICE },
      }),
    ),
  };
}

describe("ensureCampaignScenarioMedia", () => {
  it("writes a bundled campaign's clips into the media store", async () => {
    campaignListMock.mockResolvedValue({ items: [bundled("b1")] });

    await ensureCampaignScenarioMedia("b1");

    expect(mediaWriteMock).toHaveBeenCalledWith({
      scenarioId: "s1",
      file: "a.png",
      dataUri: PORTRAIT,
    });
    expect(mediaWriteMock).toHaveBeenCalledTimes(2);
  });

  it("writes them once, however many missions are launched", async () => {
    campaignListMock.mockResolvedValue({ items: [bundled("b2")] });

    await ensureCampaignScenarioMedia("b2");
    await ensureCampaignScenarioMedia("b2");

    expect(campaignListMock).toHaveBeenCalledTimes(1);
  });

  it("leaves another bundled campaign's clips alone", async () => {
    campaignListMock.mockResolvedValue({
      items: [bundled("b3"), bundled("other")],
    });

    await ensureCampaignScenarioMedia("b3");

    expect(mediaWriteMock).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a local campaign, whose clips are already stored", async () => {
    campaignListMock.mockResolvedValue({
      items: [
        {
          source: "local" as const,
          json: JSON.stringify(campaign([mission("m1", scenario("s1"))], "l1")),
        },
      ],
    });

    await ensureCampaignScenarioMedia("l1");

    expect(mediaWriteMock).not.toHaveBeenCalled();
  });

  it("retries next launch when the list could not be read", async () => {
    campaignListMock.mockRejectedValueOnce(new Error("no campaigns dir"));
    await ensureCampaignScenarioMedia("b4");

    campaignListMock.mockResolvedValue({ items: [bundled("b4")] });
    await ensureCampaignScenarioMedia("b4");

    expect(mediaWriteMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * Issue #919. A bundled campaign's clips are written into the ordinary media
 * store on the launch path, and the only thing holding them is the campaign
 * still being bundled. Nothing acted on that until the sweep.
 */
describe("collecting the clips nothing names", () => {
  it("holds a scenario's own clips and every campaign's attached ones", () => {
    expect(
      namedScenarioClips(
        [scenario("local")],
        [
          campaign([mission("m1", scenario("attached"))], "c1"),
          campaign([mission("m1"), mission("m2", scenario("bundled"))], "c2"),
        ],
      ),
    ).toEqual(
      new Map([
        ["local", new Set(["a.png", "a.ogg"])],
        ["attached", new Set(["a.png", "a.ogg"])],
        ["bundled", new Set(["a.png", "a.ogg"])],
      ]),
    );
  });

  /**
   * Issue #916. The clip a campaign mission is holding is not the one the
   * stored scenario names, which is exactly what #866 and #871 leave behind. Both
   * have to survive, or the sweep breaks the mission it was written to tidy up
   * after.
   */
  it("unions the stored scenario's clips with what a mission still names", () => {
    const stored = scenario("s1", {
      dialogue: [{ id: "d1", speaker: "V", text: "x", portrait: "new.png" }],
    });
    const held = scenario("s1", {
      dialogue: [{ id: "d1", speaker: "V", text: "x", portrait: "old.png" }],
    });

    expect(
      namedScenarioClips([stored], [campaign([mission("m1", held)])]),
    ).toEqual(new Map([["s1", new Set(["new.png", "old.png"])]]));
  });

  it("holds a scenario with no dialogue as a named folder with no clips", () => {
    expect(
      namedScenarioClips([scenario("bare", { dialogue: [] })], []),
    ).toEqual(new Map([["bare", new Set()]]));
  });

  it("holds nothing when there is nothing to hold", () => {
    expect(namedScenarioClips([], [])).toEqual(new Map());
  });

  it("hands the sweep every named clip and nothing else", async () => {
    scenarioListMock.mockResolvedValue({
      items: [JSON.stringify(scenario("kept"))].map((json) => ({
        json,
        source: "local" as const,
      })),
    });
    mediaSweepMock.mockResolvedValue({
      summary: { applied: true, folders: ["gone"], files: [], bytes: 12 },
    });

    await sweepOrphanedScenarioMedia([
      campaign([mission("m1", scenario("held"))], "c1"),
    ]);

    expect(mediaSweepMock).toHaveBeenCalledWith({
      keep: { kept: ["a.png", "a.ogg"], held: ["a.png", "a.ogg"] },
      apply: true,
    });
  });

  /**
   * Issue #786. A bundled scenario's clips are written into the same media
   * store an imported one's are, and the only thing holding them is the
   * scenario still being bundled. It is in the list the keep set is built from,
   * so the sweep has to see it and leave its clips alone.
   */
  it("keeps a bundled scenario's clips, so the sweep cannot take them", async () => {
    scenarioListMock.mockResolvedValue({
      items: [
        {
          source: "bundled" as const,
          json: encodeScenarioExport({
            scenario: scenario("shipped"),
            media: { "a.png": PORTRAIT, "a.ogg": VOICE },
          }),
        },
      ],
    });

    const scenarios = (await listScenarios()).map((l) => l.scenario);

    expect(namedScenarioClips(scenarios, [])).toEqual(
      new Map([["shipped", new Set(["a.png", "a.ogg"])]]),
    );
  });

  it("sweeps once a session", async () => {
    await sweepOrphanedScenarioMedia([]);
    expect(mediaSweepMock).not.toHaveBeenCalled();
  });
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
