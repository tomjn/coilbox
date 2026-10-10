// @vitest-environment happy-dom

/**
 * A launch checks the disk before it starts an engine: an engine folder deleted
 * while coilbox runs is refused with a message, not started as a process that
 * cannot exist. A content read that fails does not stop a launch.
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ContentState } from "@/content/bindings";
import { resetContentState } from "@/content/contentState";
import { PlayProvider, usePlay } from "./PlayProvider";

const { playLaunch, contentStateLoad } = vi.hoisted(() => ({
  playLaunch: vi.fn(async () => ({ exitCode: 0, signal: null })),
  contentStateLoad: vi.fn(),
}));

vi.mock("@/play/bindings", () => ({
  playCancel: vi.fn(),
  playFocus: vi.fn(),
  playLaunch,
  playLaunchReplay: vi.fn(),
  playLaunchSave: vi.fn(),
}));
vi.mock("@/content/bindings", () => ({ contentStateLoad }));
vi.mock("./LaunchContentProvider", () => ({
  LaunchContentProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("./pages/components/CrashDrawer", () => ({ CrashDrawer: () => null }));
vi.mock("./useCrashTriage", () => ({
  useCrashTriage: () => ({
    triage: null,
    open: false,
    setOpen: () => {},
    inspect: async () => {},
  }),
}));

const withEngine = (executable: string) =>
  ({
    roots: [{ path: "/data", engines: [{ id: "e", executable }] }],
  }) as unknown as ContentState;

let launch: ReturnType<typeof usePlay>["launch"];

function Probe() {
  launch = usePlay().launch;
  return null;
}

const run = () =>
  launch("skirmish", {
    config: { gameType: "g", mapName: "m" } as never,
    executable: "/engines/a/spring",
    dataDir: "/data",
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetContentState();
  // `Channel` registers a callback through the Tauri bridge.
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ =
    { transformCallback: (cb: unknown) => cb };
  render(
    <PlayProvider>
      <Probe />
    </PlayProvider>,
  );
});

afterEach(cleanup);

it("refuses an engine the disk check no longer lists", async () => {
  contentStateLoad.mockResolvedValue({
    state: withEngine("/engines/b/spring"),
  });
  await expect(run()).rejects.toThrow("no longer installed");
  expect(playLaunch).not.toHaveBeenCalled();
});

it("launches an engine the disk check still lists, and asks the backend", async () => {
  contentStateLoad.mockResolvedValue({
    state: withEngine("/engines/a/spring"),
  });
  await run();
  await waitFor(() => expect(playLaunch).toHaveBeenCalledTimes(1));
  expect(contentStateLoad).toHaveBeenCalledTimes(1);
});

it("launches when the content read fails", async () => {
  contentStateLoad.mockRejectedValue(new Error("unreadable"));
  await run();
  expect(playLaunch).toHaveBeenCalledTimes(1);
});

it("lets the next launch through after a refusal", async () => {
  contentStateLoad.mockResolvedValueOnce({
    state: withEngine("/engines/b/spring"),
  });
  await expect(run()).rejects.toThrow("no longer installed");
  contentStateLoad.mockResolvedValue({
    state: withEngine("/engines/a/spring"),
  });
  await run();
  expect(playLaunch).toHaveBeenCalledTimes(1);
});
