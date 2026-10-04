// @vitest-environment happy-dom
/**
 * Issue #3452: an engine in a folder named for the recorded version has not said
 * what version it is. The replay page says so and enables Watch, and starts no
 * engine until Watch is pressed.
 */
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RECORDED = "105.1.1-2511-gabc1234 BAR105";

const h = vi.hoisted(() => ({
  contentVerifyEngine: vi.fn(),
  ensureContent: vi.fn(),
  launchReplay: vi.fn(),
  engines: [] as unknown[],
}));

vi.mock("./bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bindings")>()),
  contentVerifyEngine: h.contentVerifyEngine,
}));
vi.mock("./config", () => ({
  useContentState: () => ({
    state: { roots: [{ path: "/root", engines: h.engines }] },
    loading: false,
    error: null,
    refresh: async () => {},
  }),
}));
vi.mock("./useResolveContent", () => ({
  useResolveContent: () => ({
    loading: false,
    canDownload: () => true,
    noWriteRoot: false,
  }),
}));
vi.mock("../downloads/config", () => ({
  useWriteRoot: () => ({ loading: false, path: "/dl" }),
}));
vi.mock("../downloads/DownloadQueueProvider", () => ({
  useDownloadComplete: () => {},
}));
vi.mock("../play/config", () => ({
  useReplayTarget: () => ({
    resolved: {
      target: {
        executable: "/root/engine/folder/spring",
        dataDir: "/root",
        engineVersion: "105.1.1-2511-gabc1234",
      },
      matched: false,
    },
  }),
}));
vi.mock("../play/LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: h.ensureContent }),
}));
vi.mock("../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launchReplay: h.launchReplay }),
}));
vi.mock("./replayUserState", () => ({
  useReplayUserState: () => ({ setWatched: () => {} }),
}));

import { UncheckedEngineNotice } from "./pages/components/UncheckedEngineNotice";
import { WatchButton } from "./pages/components/WatchButton";
import { useReplayEngine } from "./useReplayEngine";

const folderEngine = {
  id: "folder",
  version: "105.1.1-2511-gabc1234",
  executable: "/root/engine/folder/spring",
};

beforeEach(() => {
  h.contentVerifyEngine.mockReset();
  h.ensureContent.mockReset();
  h.launchReplay.mockReset();
  h.engines = [folderEngine];
});
afterEach(cleanup);

describe("opening the replay page with an unverified engine", () => {
  it("says the engine has not been checked, enables Watch and offers no download", () => {
    const { result } = renderHook(() => useReplayEngine(RECORDED));
    expect(result.current.notice).toEqual({
      kind: "unchecked",
      version: RECORDED,
    });
    expect(result.current.watch).toEqual({ kind: "verify" });
  });

  it("starts no engine", () => {
    renderHook(() => useReplayEngine(RECORDED));
    expect(h.contentVerifyEngine).not.toHaveBeenCalled();
  });

  it("does not count an engine that reports another version under a matching folder", () => {
    h.engines = [{ ...folderEngine, syncVersion: "104.0.1-1828-g1234567" }];
    const { result } = renderHook(() => useReplayEngine(RECORDED));
    expect(result.current.notice).toEqual({
      kind: "download",
      version: RECORDED,
    });
    expect(h.contentVerifyEngine).not.toHaveBeenCalled();
  });
});

describe("the unchecked engine notice", () => {
  it("names the version, says it has not been checked and that Watch checks it", () => {
    render(<UncheckedEngineNotice version={RECORDED} />);
    const text = screen.getByText(/has not had its version checked yet/);
    expect(text.textContent).toContain(RECORDED);
    expect(text.textContent).toContain("Pressing Watch checks it first.");
    expect(text.textContent).not.toMatch(/download|installed/i);
  });
});

describe("Watch on an unverified engine", () => {
  it("is enabled and goes through the shared check, not through a verification of its own", async () => {
    h.ensureContent.mockResolvedValue({ ready: false, reason: "cancelled" });
    render(
      <WatchButton
        replayPath="/replays/a.sdfz"
        engineVersion={RECORDED}
        watch={{ kind: "verify" }}
      />,
    );
    const button = screen.getByRole("button", { name: /watch/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(h.ensureContent).toHaveBeenCalledTimes(1));
    const req = h.ensureContent.mock.calls[0][0];
    expect(req.requirements).toHaveLength(1);
    expect(req.requirements[0].kind).toBe("engine");
    expect(req.requirements[0].label).toBe(RECORDED);
    expect(h.contentVerifyEngine).not.toHaveBeenCalled();
    expect(h.launchReplay).not.toHaveBeenCalled();
  });

  it("launches on the engine the check hands back", async () => {
    h.ensureContent.mockResolvedValue({
      ready: true,
      target: { executable: "/root/engine/folder/spring", dataDir: "/root" },
    });
    h.launchReplay.mockResolvedValue({ exitCode: 0 });
    render(
      <WatchButton
        replayPath="/replays/a.sdfz"
        engineVersion={RECORDED}
        watch={{ kind: "verify" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /watch/i }));
    await waitFor(() => expect(h.launchReplay).toHaveBeenCalledTimes(1));
    expect(h.launchReplay).toHaveBeenCalledWith({
      demoPath: "/replays/a.sdfz",
      executable: "/root/engine/folder/spring",
      dataDir: "/root",
    });
  });
});
