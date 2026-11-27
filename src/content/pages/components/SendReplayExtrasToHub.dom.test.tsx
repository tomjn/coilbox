// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubAccount } from "@/hub/account";
import type { ArchiveUploadState } from "@/hub/archiveUploads";
import type { ReplayExtras } from "@/hub/replayExtras/onHub";
import type { ReplaysOnHub } from "@/hub/replaysOnHub";
import type { DemoInfo } from "../../bindings";

/** The replay page's analysis and track sends (issue #5495). */

vi.mock("@/hub/archiveUploads", () => ({
  listArchiveUploads: async () => [],
  onArchiveUploadChanged: async () => () => {},
}));
const begun = vi.fn(async (_kind: string, _gameId: string) => "grant-1");
const ended = vi.fn(async (_grant: string) => {});
vi.mock("@/hub/manualSend/grant", () => ({
  beginReplayExtraSend: (kind: string, gameId: string) => begun(kind, gameId),
  endManualSend: (grant: string) => ended(grant),
}));
vi.mock("@/hub/manualSend/run", () => ({ noteHubChanged: () => {} }));
vi.mock("@/hub/manualSend/status", () => ({
  gamePageUrl: () => "",
  mapPageUrl: () => "",
}));
vi.mock("@/hub/maps/lookup", () => ({ fetchMapFacts: async () => ({}) }));
let held: ReplaysOnHub = {};
vi.mock("@/hub/replaysOnHub", async (actual) => ({
  ...(await actual<typeof import("@/hub/replaysOnHub")>()),
  useReplaysOnHub: () => held,
}));
let extras: ReplayExtras = {};
vi.mock("@/hub/replayExtras/onHub", async (actual) => ({
  ...(await actual<typeof import("@/hub/replayExtras/onHub")>()),
  useReplayExtras: () => extras,
}));
const analysisSent = vi.fn();
const trackStarted = vi.fn();
vi.mock("@/hub/replayExtras/send", async (actual) => ({
  ...(await actual<typeof import("@/hub/replayExtras/send")>()),
  sendStoredAnalysis: (...args: unknown[]) => analysisSent(...args),
  startStoredTrack: (...args: unknown[]) => trackStarted(...args),
}));
vi.mock("@/notify/notify", () => ({ notify: () => {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));
vi.mock("@/hub/config", () => ({ useHubUrl: () => "https://hub.test" }));
let account: HubAccount;
vi.mock("@/hub/account", () => ({ useHubAccount: () => account }));
vi.mock("../../../lobby-servers/config", () => ({
  useLobbyAccounts: () => [
    { accounts: [{ serverId: "s", username: "Alice", lastUsedAt: 1 }] },
  ],
  useLastLogin: () => [null],
}));
let analyses = new Map<string, unknown>();
vi.mock("../../replayAnalysis", () => ({
  useStoredAnalyses: () => analyses,
}));
let tracks = new Map<string, unknown>();
vi.mock("../../replayTracks", () => ({
  useStoredTracks: () => tracks,
}));

import { forgetArchiveUploads, rememberUpload } from "@/hub/upload/store";
import { SendReplayExtrasToHub } from "./SendReplayExtrasToHub";

const HUB = "https://hub.test";
const GAME_ID = "9f2c4b1ad07e5386c1f4a92b6e8d0375";
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
  ],
  ais: [],
  modOptions: {},
  mapOptions: {},
};

function signedIn(yes = true): HubAccount {
  return {
    loading: false,
    busy: false,
    signedIn: yes,
    unknown: false,
    account: null,
    problem: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    recheck: vi.fn(async () => {}),
  };
}

const reproduced = (loggerVersion = 8) =>
  new Map([
    [GAME_ID, { gameId: GAME_ID, outcome: "reproduced", loggerVersion }],
  ]);
const analysisOnHub = (state: string, reason: string | null = null) => {
  extras = {
    [GAME_ID]: {
      hubUrl: HUB,
      analysis: { loggerVersion: 8, state: state as never, reason },
    },
  };
};

function trackUpload(patch: Partial<ArchiveUploadState>): ArchiveUploadState {
  return {
    opId: "track-op",
    hubUrl: HUB,
    filename: `${GAME_ID}.cbtrack`,
    kind: "track",
    sha256: "d".repeat(64),
    phase: "sending",
    sent: 0,
    size: 100,
    uploadId: null,
    pageUrl: null,
    heldAlready: false,
    outcome: null,
    ...patch,
  };
}

beforeEach(() => {
  held = { [GAME_ID]: { hubUrl: HUB, url: "https://hub.test/replays/x" } };
  extras = {};
  analyses = reproduced();
  tracks = new Map();
  account = signedIn();
  forgetArchiveUploads();
  begun.mockClear();
  ended.mockClear();
  analysisSent.mockReset();
  trackStarted.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("sending a replay's analysis and track from its page", () => {
  it("offers the analysis once the hub lists the replay, and sends it under its own grant", async () => {
    analysisSent.mockResolvedValue({ kind: "sent", state: "checking" });
    render(<SendReplayExtrasToHub info={INFO} />);
    await act(async () => {
      fireEvent.click(button(/Send analysis/));
    });
    expect(begun).toHaveBeenCalledWith("analysis", GAME_ID);
    expect(analysisSent).toHaveBeenCalledWith(HUB, GAME_ID, "grant-1");
    expect(ended).toHaveBeenCalledWith("grant-1");
  });

  it.each<[string, () => void]>([
    ["the hub does not list the replay", () => (held = {})],
    ["nobody is signed in", () => (account = signedIn(false))],
    [
      "the run diverged",
      () =>
        (analyses = new Map([
          [GAME_ID, { gameId: GAME_ID, outcome: "diverged", loggerVersion: 8 }],
        ])),
    ],
    ["there is no analysis", () => (analyses = new Map())],
    [
      "the user was not in the battle",
      () =>
        (INFO.players = INFO.players.map((p) => ({
          ...p,
          name: `${p.name}2`,
        }))),
    ],
  ])("offers nothing when %s", (_, arrange) => {
    const players = INFO.players;
    arrange();
    const { container } = render(<SendReplayExtrasToHub info={INFO} />);
    expect(container.textContent).toBe("");
    INFO.players = players;
  });

  it("asks the hub again while it checks the analysis", async () => {
    vi.useFakeTimers();
    analysisOnHub("checking");
    analysisSent.mockResolvedValue({ kind: "sent", state: "checking" });
    render(<SendReplayExtrasToHub info={INFO} />);
    expect(button(/The hub is checking the analysis/)).toHaveProperty(
      "disabled",
      true,
    );
    expect(analysisSent).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(analysisSent).toHaveBeenCalledWith(HUB, GAME_ID, "grant-1");
  });

  it("offers the analysis again when a newer logger made the stored one", () => {
    analysisOnHub("kept");
    analyses = reproduced(9);
    render(<SendReplayExtrasToHub info={INFO} />);
    expect(button(/Send analysis/)).toBeTruthy();
  });

  it("says why the hub refused the analysis, and offers no track", () => {
    analysisOnHub("refused", "total_mismatch");
    tracks = new Map([[GAME_ID, { gameId: GAME_ID, state: "current" }]]);
    render(<SendReplayExtrasToHub info={INFO} />);
    fireEvent.click(button(/Analysis refused/));
    expect(
      screen.getByText(
        "The hub's check found the analysis does not match the replay.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send track/ })).toBeNull();
  });

  it("offers the track once the analysis has passed, and sends it under its own grant", async () => {
    analysisOnHub("kept");
    tracks = new Map([[GAME_ID, { gameId: GAME_ID, state: "current" }]]);
    trackStarted.mockResolvedValue(trackUpload({}));
    render(<SendReplayExtrasToHub info={INFO} />);
    await act(async () => {
      fireEvent.click(button(/Send track/));
    });
    expect(begun).toHaveBeenCalledWith("track", GAME_ID);
    expect(trackStarted).toHaveBeenCalledWith(
      HUB,
      GAME_ID,
      "the match on Tabula",
      "grant-1",
    );
  });

  it("offers no track for a match whose track is out of date", () => {
    analysisOnHub("agreed");
    tracks = new Map([[GAME_ID, { gameId: GAME_ID, state: "stale" }]]);
    render(<SendReplayExtrasToHub info={INFO} />);
    expect(button(/Analysis on the hub/)).toHaveProperty("disabled", true);
  });

  it.each([
    [4, /Send track/],
    [5, /Track on the hub/],
  ])("with a version %s track on the hub and a version 5 one recorded, shows %s (#5525)", (theirs, name) => {
    analysisOnHub("kept");
    const record = extras[GAME_ID];
    if (record) record.trackRecorderVersion = theirs;
    tracks = new Map([
      [GAME_ID, { gameId: GAME_ID, state: "current", recorderVersion: 5 }],
    ]);
    render(<SendReplayExtrasToHub info={INFO} />);
    expect(button(name)).toBeTruthy();
  });

  it("says the hub is keeping its older track, and lets the track go again (#5525)", () => {
    analysisOnHub("kept");
    tracks = new Map([[GAME_ID, { gameId: GAME_ID, state: "current" }]]);
    render(<SendReplayExtrasToHub info={INFO} />);
    act(() =>
      rememberUpload(
        trackUpload({
          phase: "done",
          outcome: {
            kind: "stopped",
            source: "hub",
            code: "older_kept",
            status: 200,
            said: "said",
          },
        }),
        { kind: "track", label: "the match on Tabula", gameId: GAME_ID },
      ),
    );
    fireEvent.click(button(/Track not sent/));
    expect(screen.getByText(/The hub is keeping its older track/)).toBeTruthy();
    fireEvent.click(button("Send again"));
    expect(button(/Send track/)).toBeTruthy();
  });

  it("follows the track's upload and says when the hub has it", async () => {
    analysisOnHub("kept");
    tracks = new Map([[GAME_ID, { gameId: GAME_ID, state: "current" }]]);
    render(<SendReplayExtrasToHub info={INFO} />);
    act(() =>
      rememberUpload(trackUpload({ phase: "waiting" }), {
        kind: "track",
        label: "the match on Tabula",
        gameId: GAME_ID,
      }),
    );
    expect(button(/The hub is checking the track/)).toBeTruthy();
    act(() =>
      rememberUpload(
        trackUpload({ phase: "done", outcome: { kind: "listed" } }),
        { kind: "track", label: "the match on Tabula", gameId: GAME_ID },
      ),
    );
    await waitFor(() => expect(button(/Track on the hub/)).toBeTruthy());
  });

  it("says when no analysis has passed yet, and lets the track go again", () => {
    analysisOnHub("kept");
    tracks = new Map([[GAME_ID, { gameId: GAME_ID, state: "current" }]]);
    render(<SendReplayExtrasToHub info={INFO} />);
    act(() =>
      rememberUpload(
        trackUpload({
          phase: "done",
          outcome: {
            kind: "stopped",
            source: "hub",
            code: "no_analysis",
            status: 409,
            said: "said",
          },
        }),
        { kind: "track", label: "the match on Tabula", gameId: GAME_ID },
      ),
    );
    fireEvent.click(button(/Track not sent/));
    expect(
      screen.getByText(
        "The hub has not passed an analysis of this match yet. Try again once its check has finished.",
      ),
    ).toBeTruthy();
    fireEvent.click(button("Send again"));
    expect(button(/Send track/)).toBeTruthy();
  });
});
