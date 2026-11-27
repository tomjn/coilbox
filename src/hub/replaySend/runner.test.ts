import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DemoBuildOrders,
  DemoInfo,
  DemoTrailer,
} from "@/content/bindings";
import type { ArchiveUploadState } from "@/hub/archiveUploads";
import {
  installSettingsStorage,
  memorySettingsStorage,
  writeStoredSetting,
} from "@/lib/storedSetting";

vi.mock("@/profile/profile", () => ({
  isHubAssetUploadOffered: () => true,
}));

const demoInfo = vi.fn();
const buildOrders = vi.fn();
vi.mock("@/content/bindings", async (actual) => ({
  ...(await actual<typeof import("@/content/bindings")>()),
  contentDemoInfo: (args: unknown) => demoInfo(args),
  contentReplayTrailer: async () => ({ trailer: TRAILER }),
  contentDemoBuildOrders: () => buildOrders(),
  contentUnitDefSet: async () => ({ links: [], matchListVersion: 0 }),
}));
const dataset = vi.fn();
let installed = [{ name: "Game 1", primaryArchive: { name: "game.sdz" } }];
const gameInfo = vi.fn();
vi.mock("@/content/config", () => ({
  primeScan: async () => ({ games: installed }),
  loadUnitsyncUnitDataset: () => dataset(),
  primeGameInfo: () => gameInfo(),
}));

const started = vi.fn();
const cancelled = vi.fn(async (_opId: string) => {});
let announce: (state: ArchiveUploadState) => void = () => {};
vi.mock("@/hub/archiveUploads", () => ({
  startReplayUpload: (...args: unknown[]) => started(...args),
  cancelArchiveUpload: (opId: string) => cancelled(opId),
  listArchiveUploads: async () => [],
  onArchiveUploadChanged: async (
    handler: (state: ArchiveUploadState) => void,
  ) => {
    announce = handler;
    return () => {};
  },
}));
vi.mock("@/hub/manualSend/run", () => ({ noteHubChanged: () => {} }));
vi.mock("@/hub/manualSend/status", () => ({
  gamePageUrl: () => "",
  mapPageUrl: () => "",
}));
vi.mock("@/hub/maps/lookup", () => ({ fetchMapFacts: async () => ({}) }));
const marked = vi.fn();
vi.mock("@/hub/replaysOnHub", async (actual) => ({
  ...(await actual<typeof import("@/hub/replaysOnHub")>()),
  rememberReplayOnHub: (...args: unknown[]) => marked(...args),
}));
const notified = vi.fn();
vi.mock("@/notify/notify", () => ({
  notify: (input: unknown) => notified(input),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

import { followArchiveUploads, forgetArchiveUploads } from "@/hub/upload/store";
import {
  AUTO_SEND_REPLAYS_KEY,
  queueFinishedReplay,
  readReplaySendQueue,
} from "./queue";
import {
  GIVE_UP_AFTER_MS,
  RETRY_DELAYS_MS,
  runDueReplaySends,
  type SendContext,
  stopReplaySends,
} from "./runner";

const GAME_ID = "9f2c4b1ad07e5386c1f4a92b6e8d0375";
const PATH = "/d/demos/match.sdfz";
const TARGET = { dataDir: "/d", enginePath: "/e/spring" };

const INFO: DemoInfo = {
  engineVersion: "2025.04.10",
  gameId: GAME_ID,
  startTimeMs: 1_000_000,
  durationSec: 30,
  wallclockSec: 30,
  mapName: "Tabula",
  gameType: "Game 1",
  winningAllyTeams: [0],
  winnersKnown: true,
  numAllyTeams: 2,
  allyTeams: [],
  players: [
    { name: "Alice", team: 0, allyTeam: 0, side: "Arm", spectator: false },
    { name: "Bob", team: 1, allyTeam: 1, side: "Core", spectator: false },
    { name: "Carol", spectator: true },
  ],
  ais: [],
  modOptions: {},
  mapOptions: {},
};
const TRAILER: DemoTrailer = {
  winningAllyTeams: [0],
  teamStatPeriodSec: 15,
  teams: [],
};
const ORDERS: DemoBuildOrders = {
  orders: [
    {
      frame: 10,
      player: 0,
      team: 0,
      origin: { kind: "player" } as never,
      unitDefId: 1,
      count: 1,
      slot: { kind: "append" } as never,
      builders: 1,
      options: 0,
    },
  ],
  players: [],
  removals: 0,
  lastFrame: 900,
  incomplete: false,
};

let now = 1_000_000;
const context = (patch: Partial<SendContext> = {}): SendContext => ({
  hubUrl: "https://hub.test",
  names: ["Alice"],
  account: "in",
  now: () => now,
  ...patch,
});

function state(patch: Partial<ArchiveUploadState> = {}): ArchiveUploadState {
  return {
    opId: "op-1",
    hubUrl: "https://hub.test",
    filename: "match.sdfz",
    kind: "replay",
    sha256: "c".repeat(64),
    phase: "reserving",
    sent: 0,
    size: 100,
    uploadId: null,
    pageUrl: null,
    heldAlready: false,
    outcome: null,
    ...patch,
  };
}

/** Make the next start answer, then end the upload as `patch` says. */
function endsWith(patch: Partial<ArchiveUploadState>) {
  started.mockImplementationOnce(async () => {
    const first = state({ opId: `op-${started.mock.calls.length}` });
    setTimeout(() => announce({ ...first, phase: "done", ...patch }), 0);
    return first;
  });
}
const listed = (patch: Partial<ArchiveUploadState> = {}) =>
  endsWith({
    outcome: { kind: "listed" },
    pageUrl: "https://hub.test/replays/x",
    ...patch,
  });
const stopped = (
  source: "hub" | "mirror" | "local",
  code: string,
  status: number | null = null,
) =>
  endsWith({
    outcome: { kind: "stopped", source, code, status, said: "said" },
  });

const finish = () => queueFinishedReplay(TARGET, { path: PATH }, now);

beforeEach(() => {
  now = 1_000_000;
  installSettingsStorage(memorySettingsStorage());
  writeStoredSetting(AUTO_SEND_REPLAYS_KEY, true);
  forgetArchiveUploads();
  demoInfo.mockReset().mockResolvedValue({ info: INFO });
  buildOrders.mockReset().mockResolvedValue(ORDERS);
  dataset.mockReset().mockResolvedValue({
    checksum: "1",
    errors: [],
    units: [{ name: "armsolar", stats: { metalCost: 155, energyCost: 0 } }],
  });
  installed = [{ name: "Game 1", primaryArchive: { name: "game.sdz" } }];
  gameInfo.mockReset().mockResolvedValue({
    checksum: "1",
    sides: [{ name: "Cortex", startUnit: "armsolar" }],
  });
  started.mockReset();
  cancelled.mockClear();
  marked.mockClear();
  notified.mockClear();
});
afterEach(async () => {
  await stopReplaySends();
  installSettingsStorage(null);
});

describe("sending finished matches", () => {
  it("sends a finished online match with no grant, and marks it", async () => {
    listed();
    finish();
    await runDueReplaySends(context());
    expect(started).toHaveBeenCalledTimes(1);
    const [hub, path, gameId, name, summary, grant] = started.mock.calls[0];
    expect([hub, path, gameId, name, grant]).toEqual([
      "https://hub.test",
      PATH,
      GAME_ID,
      "Alice",
      undefined,
    ]);
    expect(summary).toMatchObject({
      v: 1,
      units: [{ unit_def_id: 1, name: "armsolar", metal: 155 }],
    });
    expect(marked).toHaveBeenCalledWith(GAME_ID, {
      hubUrl: "https://hub.test",
      url: "https://hub.test/replays/x",
    });
    expect(readReplaySendQueue()).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
  });

  it("says nothing about a match the hub already had", async () => {
    listed({ heldAlready: true });
    finish();
    await runDueReplaySends(context());
    expect(marked).toHaveBeenCalled();
    expect(notified).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("sends a match the user watched", async () => {
    listed();
    finish();
    await runDueReplaySends(context({ names: ["carol"] }));
    expect(started.mock.calls[0][3]).toBe("Carol");
  });

  it.each<[string, Partial<DemoInfo>]>([
    [
      "against AIs only",
      {
        players: [INFO.players[0]],
        ais: [{ team: 1, shortName: "AI", name: "AI", host: 0 } as never],
      },
    ],
    [
      "with people on one side only",
      {
        players: [
          INFO.players[0],
          { ...INFO.players[1], allyTeam: 0 },
          INFO.players[2],
        ],
      },
    ],
    ["that never reached game over", { winnersKnown: false }],
    ["that is a remix", { remixed: true }],
    ["with no game id", { gameId: undefined }],
  ])("drops a match %s", async (_what, patch) => {
    demoInfo.mockResolvedValue({ info: { ...INFO, ...patch } });
    finish();
    await runDueReplaySends(context());
    expect(started).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
  });

  it("drops a match the user was not in", async () => {
    finish();
    await runDueReplaySends(context({ names: ["Dave"] }));
    expect(started).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("holds a match while signed out of the hub, then sends it", async () => {
    finish();
    await runDueReplaySends(context({ account: "out" }));
    expect(started).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toMatchObject([{ attempts: 0 }]);
    listed();
    await runDueReplaySends(context());
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("forgets a match held signed out past the limit", async () => {
    finish();
    now += GIVE_UP_AFTER_MS + 1;
    await runDueReplaySends(context({ account: "out" }));
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("keeps an old match while the sign-in cannot be checked", async () => {
    finish();
    now += GIVE_UP_AFTER_MS + 1;
    await runDueReplaySends(context({ account: "unknown" }));
    expect(readReplaySendQueue()).toHaveLength(1);
    expect(started).not.toHaveBeenCalled();
  });

  it.each([
    ["local", "unreachable", null],
    ["mirror", "unreachable", null],
    ["hub", "no_replay_mirror", 503],
    ["hub", "uploading", 409],
    ["hub", "http_502", 502],
    ["hub", "http_429", 429],
    ["mirror", "write_failed", 500],
    ["hub", "unauthorised", 401],
  ] as const)("tries again after %s says %s, once the wait is over", async (source, code, status) => {
    stopped(source, code, status);
    finish();
    await runDueReplaySends(context());
    expect(readReplaySendQueue()).toMatchObject([
      { attempts: 1, notBefore: now + RETRY_DELAYS_MS[0] },
    ]);
    expect(notified).not.toHaveBeenCalled();

    await runDueReplaySends(context());
    expect(started).toHaveBeenCalledTimes(1);

    now += RETRY_DELAYS_MS[0];
    listed();
    await runDueReplaySends(context());
    expect(started).toHaveBeenCalledTimes(2);
    expect(readReplaySendQueue()).toEqual([]);
  });

  it("keeps waiting at the longest delay", async () => {
    finish();
    for (let tried = 0; tried <= RETRY_DELAYS_MS.length; tried++) {
      stopped("local", "unreachable");
      await runDueReplaySends(context());
      now = readReplaySendQueue()[0].notBefore;
    }
    const last = RETRY_DELAYS_MS.at(-1) as number;
    stopped("local", "unreachable");
    await runDueReplaySends(context());
    expect(readReplaySendQueue()[0].notBefore).toBe(now + last);
  });

  it("gives up on a replay it could not send within the limit", async () => {
    finish();
    now += GIVE_UP_AFTER_MS + 1;
    stopped("local", "unreachable");
    await runDueReplaySends(context());
    expect(readReplaySendQueue()).toEqual([]);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not_kept", 201],
    ["not_in_replay", 422],
    ["bad_request", 400],
  ] as const)("gives up when the hub refuses with %s", async (code, status) => {
    stopped("hub", code, status);
    finish();
    await runDueReplaySends(context());
    expect(readReplaySendQueue()).toEqual([]);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified.mock.calls[0][0]).toMatchObject({
      title: "The replay on Tabula was not sent",
    });
    expect(marked).not.toHaveBeenCalled();
  });

  it("drops an upload the user stopped", async () => {
    endsWith({ outcome: { kind: "cancelled" } });
    finish();
    await runDueReplaySends(context());
    expect(readReplaySendQueue()).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
  });

  it("tries again when the game cannot be read yet", async () => {
    installed = [];
    finish();
    await runDueReplaySends(context());
    expect(started).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toMatchObject([{ attempts: 1 }]);
  });

  it("tries again when a read of the replay fails", async () => {
    buildOrders.mockRejectedValue(new Error("busy"));
    finish();
    await runDueReplaySends(context());
    expect(readReplaySendQueue()).toMatchObject([{ attempts: 1 }]);
  });

  it("gives up on build orders that cannot all be read", async () => {
    buildOrders.mockResolvedValue({ ...ORDERS, incomplete: true });
    finish();
    await runDueReplaySends(context());
    expect(readReplaySendQueue()).toEqual([]);
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("goes on to the next replay after one that has to wait", async () => {
    stopped("local", "unreachable");
    listed();
    finish();
    queueFinishedReplay(TARGET, { path: "/d/demos/other.sdfz" }, now);
    await runDueReplaySends(context());
    expect(started).toHaveBeenCalledTimes(2);
    expect(readReplaySendQueue()).toMatchObject([{ path: PATH }]);
  });

  /** Alice picks the start unit with id 1 in the match. */
  const PICKED: DemoInfo = {
    ...INFO,
    players: [
      { ...INFO.players[0], pick: { unitDefId: 1, frame: 0 } },
      ...INFO.players.slice(1),
    ],
  };

  it("sends the faction a player picked, named from the game's sides", async () => {
    demoInfo.mockResolvedValue({ info: PICKED });
    // Nothing built, so only the pick needs the units.
    buildOrders.mockResolvedValue({ ...ORDERS, orders: [] });
    listed();
    finish();
    await runDueReplaySends(context());
    expect(started.mock.calls[0][4]).toMatchObject({
      players: [{ name: "Alice", faction: "Cortex" }, { name: "Bob" }],
      units: [{ unit_def_id: 1, name: "armsolar" }],
    });
  });

  it.each([
    ["the game is not installed", () => (installed = [])],
    [
      "the game's factions cannot be read",
      () => gameInfo.mockRejectedValue(new Error("busy")),
    ],
    [
      "the picked unit cannot be read",
      () => dataset.mockRejectedValue(new Error("busy")),
    ],
  ])("holds a replay with a picked unit while %s", async (_what, breakIt) => {
    demoInfo.mockResolvedValue({ info: PICKED });
    buildOrders.mockResolvedValue({ ...ORDERS, orders: [] });
    breakIt();
    finish();
    await runDueReplaySends(context());
    expect(started).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toMatchObject([{ attempts: 1 }]);
  });

  it("does not miss a sign-in that happens during a pass", async () => {
    listed();
    finish();
    const first = runDueReplaySends(context({ account: "out" }));
    const second = runDueReplaySends(context());
    await Promise.all([first, second]);
    expect(started).toHaveBeenCalledTimes(1);
    expect(readReplaySendQueue()).toEqual([]);
  });

  it.each([
    ["marks it when it is listed", { kind: "listed" } as const, 0],
    [
      "leaves a refusal to that send's own message",
      {
        kind: "stopped",
        source: "hub",
        code: "bad_request",
        status: 400,
        said: "said",
      } as const,
      0,
    ],
    [
      "tries again later when it could not get through",
      {
        kind: "stopped",
        source: "local",
        code: "unreachable",
        status: null,
        said: "said",
      } as const,
      1,
    ],
  ])("waits for a send started from the replay's page and %s", async (_what, outcome, left) => {
    await followArchiveUploads();
    announce(state({ opId: "manual", phase: "sending" }));
    finish();
    const pass = runDueReplaySends(context());
    await vi.waitFor(() => expect(demoInfo).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    announce(state({ opId: "manual", phase: "done", outcome }));
    await pass;
    expect(started).not.toHaveBeenCalled();
    expect(readReplaySendQueue()).toHaveLength(left);
    expect(marked).toHaveBeenCalledTimes(outcome.kind === "listed" ? 1 : 0);
    // The one message is the manual send's own.
    expect(notified).toHaveBeenCalledTimes(1);
  });

  it("sends nothing once the setting is off", async () => {
    finish();
    writeStoredSetting(AUTO_SEND_REPLAYS_KEY, false);
    await runDueReplaySends(context());
    expect(started).not.toHaveBeenCalled();
  });

  it("stops the running upload and forgets the queue when turned off", async () => {
    started.mockResolvedValueOnce(state({ phase: "sending" }));
    finish();
    const pass = runDueReplaySends(context());
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    await stopReplaySends();
    expect(cancelled).toHaveBeenCalledWith("op-1");
    expect(readReplaySendQueue()).toEqual([]);
    announce(state({ phase: "done", outcome: { kind: "cancelled" } }));
    await pass;
    expect(readReplaySendQueue()).toEqual([]);
  });
});
