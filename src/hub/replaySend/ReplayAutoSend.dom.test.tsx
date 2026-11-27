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
import { queueFinishedReplay } from "./queue";
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
