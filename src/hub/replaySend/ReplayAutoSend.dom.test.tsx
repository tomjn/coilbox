// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let offered = true;
vi.mock("@/profile/profile", () => ({
  isHubAssetUploadOffered: () => offered,
}));
const stored = new Map<string, unknown>();
vi.mock("@picoframe/frame", async () => {
  const { useState } = await import("react");
  return {
    // The help button's.
    Button: (props: object) => <button type="button" {...props} />,
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
    useSetting: (key: string, fallback: unknown) => {
      const [value, setValue] = useState(stored.get(key) ?? fallback);
      return [
        value,
        (next: unknown) => {
          stored.set(key, next);
          setValue(next);
        },
      ];
    },
  };
});
const run = vi.fn(async (_context: unknown) => {});
const stop = vi.fn(async () => {});
vi.mock("./runner", () => ({
  runDueReplaySends: (context: unknown) => run(context),
  stopReplaySends: () => stop(),
}));
let signedIn = true;
const asked = vi.fn();
vi.mock("@/hub/account", () => ({
  useHubAccount: () => {
    asked();
    return { loading: false, signedIn, unknown: false };
  },
}));
vi.mock("@/hub/config", () => ({ useHubUrl: () => "https://hub.test" }));
let analyses = new Map<string, unknown>();
let tracks = new Map<string, unknown>();
vi.mock("@/content/replayAnalysis", () => ({
  useStoredAnalyses: () => analyses,
}));
vi.mock("@/content/replayTracks", () => ({
  useStoredTracks: () => tracks,
}));
vi.mock("@/lobby-servers/config", () => ({
  useLobbyAccounts: () => [
    { accounts: [{ serverId: "s", username: "Alice", lastUsedAt: 1 }] },
  ],
  useLastLogin: () => [null],
}));

import {
  installSettingsStorage,
  memorySettingsStorage,
  writeStoredSetting,
} from "@/lib/storedSetting";
import { rememberTrackOnHub } from "../replayExtras/onHub";
import {
  dropQueuedExtras,
  queueFinishedReplay,
  readReplayExtrasQueue,
} from "./queue";
import ReplayAutoSend from "./ReplayAutoSend";
import { ReplayAutoSendControl } from "./ReplayAutoSendControl";

const queue = (now = Date.now()) =>
  queueFinishedReplay(
    { dataDir: "/d", enginePath: "/e" },
    { path: "/d/demos/match.sdfz" },
    now,
  );
const turn = (on: boolean) => {
  stored.set("hub.autoSendReplays", on);
  writeStoredSetting("hub.autoSendReplays", on);
};

beforeEach(() => {
  offered = true;
  signedIn = true;
  analyses = new Map();
  tracks = new Map();
  stored.clear();
  installSettingsStorage(memorySettingsStorage());
  run.mockClear();
  stop.mockClear();
  asked.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  installSettingsStorage(null);
});

describe("the background sender", () => {
  it("asks nothing about the sign-in while there is nothing to send", () => {
    turn(true);
    render(<ReplayAutoSend />);
    expect(asked).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs when a match finishes", () => {
    turn(true);
    render(<ReplayAutoSend />);
    act(() => queue());
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hubUrl: "https://hub.test",
        names: ["Alice"],
        account: "in",
      }),
    );
  });

  it("runs again when a retry comes due", () => {
    vi.useFakeTimers();
    turn(true);
    queue(Date.now() + 5000);
    render(<ReplayAutoSend />);
    expect(run).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(run).toHaveBeenCalledTimes(2);
  });

  const analysis = (gameId: string, at: number, outcome = "reproduced") => ({
    gameId,
    outcome,
    analysedAtMs: at,
    map: "Persepolis",
  });

  it("queues a match's analysis and track when an analysis run of it finishes (#5495)", () => {
    turn(true);
    analyses = new Map([["old", analysis("old", 1)]]);
    const { rerender } = render(<ReplayAutoSend />);
    expect(readReplayExtrasQueue()).toEqual([]);
    const now = Date.now();
    analyses = new Map([
      ["old", analysis("old", 1)],
      ["new", analysis("new", now)],
      ["off", analysis("off", now, "diverged")],
    ]);
    rerender(<ReplayAutoSend />);
    expect(readReplayExtrasQueue().map((one) => one.gameId)).toEqual(["new"]);
    expect(readReplayExtrasQueue()[0]?.mapName).toBe("Persepolis");
  });

  const track = (gameId: string) => ({
    gameId,
    state: "current",
    lastWatchedMs: Date.now(),
  });
  const recorded = (recorderVersion: number) => ({
    ...track("m"),
    recorderVersion,
  });

  it("queues nothing when an old recording is watched (#5523)", () => {
    turn(true);
    analyses = new Map([["m", analysis("m", 1)]]);
    const { rerender } = render(<ReplayAutoSend />);
    // Watching sets the track file's time, and the next read shows it.
    tracks = new Map([["m", track("m")]]);
    rerender(<ReplayAutoSend />);
    expect(readReplayExtrasQueue()).toEqual([]);
  });

  it("queues a match again when its run's recording is read after its analysis (#5495)", () => {
    turn(true);
    const { rerender } = render(<ReplayAutoSend />);
    analyses = new Map([["m", analysis("m", Date.now())]]);
    rerender(<ReplayAutoSend />);
    // The sender found no track yet and finished with the match.
    act(() => dropQueuedExtras("m"));
    tracks = new Map([["m", track("m")]]);
    rerender(<ReplayAutoSend />);
    expect(readReplayExtrasQueue().map((one) => one.gameId)).toEqual(["m"]);
    // Watching it afterwards is not news.
    act(() => dropQueuedExtras("m"));
    tracks = new Map([["m", track("m")]]);
    rerender(<ReplayAutoSend />);
    expect(readReplayExtrasQueue()).toEqual([]);
  });

  it("queues nothing for a track the hub is known to hold (#5520)", () => {
    turn(true);
    const { rerender } = render(<ReplayAutoSend />);
    analyses = new Map([["m", analysis("m", Date.now())]]);
    rerender(<ReplayAutoSend />);
    act(() => dropQueuedExtras("m"));
    rememberTrackOnHub("m", "https://hub.test", 5);
    tracks = new Map([["m", recorded(5)]]);
    rerender(<ReplayAutoSend />);
    expect(readReplayExtrasQueue()).toEqual([]);
  });

  it("queues a track from a newer recorder than the hub's (#5525)", () => {
    turn(true);
    const { rerender } = render(<ReplayAutoSend />);
    analyses = new Map([["m", analysis("m", Date.now())]]);
    rerender(<ReplayAutoSend />);
    act(() => dropQueuedExtras("m"));
    rememberTrackOnHub("m", "https://hub.test", 4);
    tracks = new Map([["m", recorded(5)]]);
    rerender(<ReplayAutoSend />);
    expect(readReplayExtrasQueue().map((one) => one.gameId)).toEqual(["m"]);
  });

  it("stops everything while the setting is off", () => {
    render(<ReplayAutoSend />);
    expect(stop).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("the setting", () => {
  const toggle = () =>
    screen.getByRole("switch", {
      name: "Send my finished matches to the hub",
    });

  it("is off until turned on, and stores the answer", async () => {
    render(<ReplayAutoSendControl />);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle());
    });
    expect(stored.get("hub.autoSendReplays")).toBe(true);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("offers no switch when the distribution has switched uploads off", () => {
    offered = false;
    render(<ReplayAutoSendControl />);
    expect(screen.queryByRole("switch")).toBeNull();
  });
});
