// @vitest-environment happy-dom

/**
 * The order of the launch warm-up (issue #3726): the rapid pool starts with the
 * scan, the map work and game headers follow the scan one at a time, game info
 * is read for the game last used, and the list fetch starts when the scan ends.
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as string[],
  autoScan: true,
  lastGame: "Last Game",
  scanGate: null as null | Promise<void>,
  failing: new Set<string>(),
}));

const step = (name: string) => async () => {
  h.calls.push(name);
  if (h.failing.has(name)) throw new Error(name);
};

vi.mock("@picoframe/frame", () => ({
  useSetting: (_key: string, fallback: unknown) => [fallback, vi.fn()],
}));
vi.mock("../downloads/config", () => ({
  useDownloadsConfig: () => [{ writeRootId: "x" }, vi.fn()],
}));
vi.mock("../hub/config", () => ({ useTrustedHubUrl: () => null }));
vi.mock("../play/drafts", () => ({
  useSkirmishDraft: () => [{ gameName: h.lastGame }, vi.fn()],
}));
vi.mock("./BundledEngineSetup", () => ({
  BundledEngineSetup: ({ children }: { children: unknown }) => children,
}));
vi.mock("./backgroundFetch", () => ({
  fetchListsInBackground: () => {
    h.calls.push("lists");
    return Promise.resolve();
  },
}));
vi.mock("./bindings", () => ({ contentRescan: vi.fn() }));
vi.mock("./contentState", () => ({
  loadContentState: async () => ({ lastScanAt: 1, roots: [] }),
  setContentState: vi.fn(),
}));
vi.mock("./rapidPoolWarm", () => ({ warmAllRoots: step("rapid") }));
vi.mock("./config", () => ({
  useContentPrefs: () => [{ autoScanOnStartup: h.autoScan, probeZeroK: false }],
  targetKey: (t: { rootPath: string }) => t.rootPath,
  targetsFromState: () => [{ enginePath: "/e", rootPath: "/d" }],
  primeScan: async () => {
    h.calls.push("scan:start");
    await h.scanGate;
    h.calls.push("scan:end");
    return {
      games: [
        { name: "Other", primaryArchive: { name: "other.sdz" } },
        { name: "Last Game", primaryArchive: { name: "last.sdz" } },
      ],
    };
  },
  primeThumbnails: step("thumbnails"),
  primeMapMeta: step("mapmeta"),
  primeGameHeaders: step("headers"),
  primeGameInfo: async (_e: string, _d: string, archive: string) => {
    h.calls.push(`info:${archive}`);
    if (h.failing.has("info")) throw new Error("info");
  },
}));

const { default: ContentStartupProvider } = await import(
  "./ContentStartupProvider"
);

function launch() {
  render(<ContentStartupProvider>{null}</ContentStartupProvider>);
}

beforeEach(() => {
  h.calls = [];
  h.autoScan = true;
  h.lastGame = "Last Game";
  h.scanGate = null;
  h.failing.clear();
});

describe("the launch warm-up", () => {
  it("starts the rapid pool before the scan returns", async () => {
    let open: () => void = () => {};
    h.scanGate = new Promise((resolve) => {
      open = resolve;
    });
    launch();
    await waitFor(() => expect(h.calls).toContain("scan:start"));
    expect(h.calls).toContain("rapid");
    expect(h.calls).not.toContain("thumbnails");
    open();
    await waitFor(() => expect(h.calls).toContain("info:last.sdz"));
  });

  it("reads maps, then game headers, then the last game's info", async () => {
    launch();
    await waitFor(() => expect(h.calls).toContain("info:last.sdz"));
    expect(h.calls.filter((c) => c !== "rapid" && c !== "lists")).toEqual([
      "scan:start",
      "scan:end",
      "thumbnails",
      "mapmeta",
      "headers",
      "info:last.sdz",
    ]);
  });

  it("starts the list fetch when the scan ends", async () => {
    launch();
    await waitFor(() => expect(h.calls).toContain("lists"));
    expect(h.calls.indexOf("lists")).toBeGreaterThan(
      h.calls.indexOf("scan:end"),
    );
  });

  it("reads no game info when the last game is not installed", async () => {
    h.lastGame = "";
    launch();
    await waitFor(() => expect(h.calls).toContain("headers"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls.some((c) => c.startsWith("info:"))).toBe(false);
  });

  it("carries on after a step fails", async () => {
    h.failing = new Set(["thumbnails", "mapmeta", "headers"]);
    launch();
    await waitFor(() => expect(h.calls).toContain("info:last.sdz"));
  });

  it("does nothing with scan on startup off", async () => {
    h.autoScan = false;
    launch();
    await waitFor(() => expect(h.calls).toContain("lists"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.calls).toEqual(["lists"]);
  });
});
