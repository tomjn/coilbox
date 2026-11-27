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
import { queueFinishedReplay, readReplayExtrasQueue } from "./queue";
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

  it("queues a match when a track of it is recorded after an earlier run (#5495)", () => {
    turn(true);
    analyses = new Map([["m", analysis("m", 1)]]);
    const { rerender } = render(<ReplayAutoSend />);
    tracks = new Map([
      ["m", { gameId: "m", state: "current", lastWatchedMs: Date.now() }],
    ]);
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
