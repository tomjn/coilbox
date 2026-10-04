// @vitest-environment happy-dom

/**
 * The pre-launch content check, from a launch path's side (issue #3364): what
 * `ensureContent` resolves with, when the drawer opens, and what each unhappy
 * path leaves on screen.
 *
 * The download queue, the resolve hook and the drawer are the real ones. Only
 * what they read from Rust is stood in for: the scan, the installed engines and
 * the download commands. A DOM environment is opened for this file alone, by
 * the docblock at the top.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode, useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "@/downloads/DownloadQueueProvider";
import type { PlayTarget } from "./config";
import {
  LaunchContentProvider,
  type LaunchContentRequest,
  useLaunchContent,
} from "./LaunchContentProvider";
import { type LaunchContentResult, launchRequirements } from "./launchContent";

/** What this pretend machine has, read by every stand-in hook below. */
const machine = vi.hoisted(() => {
  interface Snapshot {
    games: string[];
    maps: string[];
    engines: string[];
    writePath: string | undefined;
    scanError: string | null;
  }
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = {
    games: [],
    maps: [],
    engines: [],
    writePath: "/content",
    scanError: null,
  };
  return {
    set(next: Partial<Snapshot>) {
      snapshot = { ...snapshot, ...next };
      for (const l of listeners) l();
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    read: () => snapshot,
  };
});

const downloads = vi.hoisted(() => ({
  map: vi.fn(),
  game: vi.fn(),
  engineRecoil: vi.fn(),
  recoilCatalog: [] as { version: string; assetUrl: string }[],
}));

const useMachine = () => useSyncExternalStore(machine.subscribe, machine.read);

const targetFor = (engineVersion: string): PlayTarget => ({
  enginePath: `/content/engine/${engineVersion}`,
  executable: `/content/engine/${engineVersion}/spring`,
  dataDir: "/content",
  engineVersion,
});

vi.mock("@/downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: downloads.engineRecoil,
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
  dlRecoilEngines: vi.fn(async () => ({ releases: downloads.recoilCatalog })),
  dlSpringfilesEngines: vi.fn(async () => ({ engines: [] })),
}));
vi.mock("@/downloads/downloadGame", () => ({
  downloadGameAnySource: downloads.game,
}));
vi.mock("@/downloads/downloadMap", () => ({
  downloadMapAnySource: downloads.map,
}));
vi.mock("@/downloads/warmEngineCache", () => ({
  installEngine: vi.fn(async (download: () => Promise<unknown>) => {
    await download();
  }),
}));
vi.mock("@/downloads/config", () => ({
  useWriteRoot: () => ({ path: useMachine().writePath, loading: false }),
}));
vi.mock("@/downloads/pages/components/ProgressBar", () => ({
  QueueProgress: () => null,
}));
vi.mock("@/content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

vi.mock("@/content/config", () => ({
  invalidateScans: vi.fn(),
  useContentTargets: () => ({
    targets: useMachine().engines.map((engineVersion) => ({ engineVersion })),
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
  useUnitsyncScan: (enginePath?: string) => {
    const m = useMachine();
    const readable = !!enginePath && !m.scanError;
    return {
      data: readable
        ? {
            games: m.games.map((name) => ({ name, info: {} })),
            maps: m.maps.map((name) => ({ name })),
          }
        : null,
      loading: false,
      error: enginePath ? m.scanError : null,
      cancelled: false,
      run: vi.fn(),
    };
  },
}));

// Like the real hook, this holds its own read of the engines and only looks
// again when told to, so an engine that arrives mid-check is invisible to it
// until the provider refreshes.
vi.mock("./config", async () => {
  const { useState } = await import("react");
  return {
    usePreferredTarget: () => {
      const [engines, setEngines] = useState(() => machine.read().engines);
      const targets = engines.map(targetFor);
      return {
        target: targets[0] ?? null,
        targets,
        loading: false,
        error: null,
        refresh: async () => setEngines(machine.read().engines),
      };
    },
  };
});

/** A launch path, reduced to the one call it makes. */
let ask: (request: LaunchContentRequest) => Promise<LaunchContentResult>;
function Caller() {
  ask = useLaunchContent().ensureContent;
  return null;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <DownloadQueueProvider>
      <LaunchContentProvider>{children}</LaunchContentProvider>
    </DownloadQueueProvider>
  </MemoryRouter>
);

/** Start a check and collect its answer without waiting on it. */
function check(request: LaunchContentRequest) {
  const outcome: { result: LaunchContentResult | null } = { result: null };
  act(() => {
    void ask(request).then((r) => {
      outcome.result = r;
    });
  });
  return outcome;
}

beforeEach(() => {
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
  machine.set({
    games: ["Beyond All Reason test-1"],
    maps: ["Comet Catcher Redux"],
    engines: ["2025.04.01"],
    writePath: "/content",
    scanError: null,
  });
  downloads.recoilCatalog = [];
  render(<Caller />, { wrapper });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ensureContent", () => {
  it("lets a launch through without a drawer when everything is installed", async () => {
    const outcome = check({
      requirements: launchRequirements({
        game: "Beyond All Reason test-1",
        map: "Comet Catcher Redux",
      }),
    });

    await waitFor(() =>
      expect(outcome.result).toEqual({
        ready: true,
        target: targetFor("2025.04.01"),
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the drawer for a missing map and carries on once it is installed", async () => {
    downloads.map.mockImplementationOnce(async () => {
      machine.set({ maps: ["Comet Catcher Redux", "Tabula"] });
      return "springfiles mirror";
    });
    const outcome = check({
      requirements: launchRequirements({
        game: "Beyond All Reason test-1",
        map: "Tabula",
      }),
      title: "Download what this skirmish needs",
    });

    await screen.findByText("Download what this skirmish needs");
    expect(screen.getByText("Tabula")).toBeTruthy();
    // The game is installed, so it is not offered.
    expect(screen.queryByText("Beyond All Reason test-1")).toBeNull();
    expect(outcome.result).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(outcome.result).toEqual({
        ready: true,
        target: targetFor("2025.04.01"),
      }),
    );
    // The map goes through the any-source download, which tries the mirrors
    // before pr-downloader.
    expect(downloads.map).toHaveBeenCalledWith(
      expect.objectContaining({ mapName: "Tabula", writePath: "/content" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not launch when the player cancels", async () => {
    const outcome = check({
      requirements: launchRequirements({ map: "Tabula" }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(outcome.result).toEqual({ ready: false, reason: "cancelled" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why a download failed and keeps the launch waiting", async () => {
    downloads.game.mockRejectedValueOnce(new Error("no mirror had it"));
    const outcome = check({
      requirements: launchRequirements({ game: "SplinterFaction 0.1.86" }),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Download" }));

    await screen.findByText("no mirror had it");
    expect(outcome.result).toBeNull();
    // The button comes back, so the player can try again.
    expect(
      (screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("says an engine with no published build cannot be downloaded", async () => {
    const outcome = check({
      requirements: launchRequirements({ engineVersion: "2019.01.01" }),
    });

    await screen.findByText(/No matching engine build found/);
    expect(
      (screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(outcome.result).toBeNull();
  });

  it("says there is no download folder when none is set", async () => {
    machine.set({ writePath: undefined });
    const outcome = check({
      requirements: launchRequirements({ map: "Tabula" }),
    });

    await screen.findByText(/Set a download folder in Downloads settings/);
    expect(
      (screen.getByRole("button", { name: "Download" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(outcome.result).toBeNull();
  });

  it("hands back the engine it downloaded, not the one the page had", async () => {
    downloads.recoilCatalog = [
      { version: "2025.06.12", assetUrl: "https://example.invalid/e.7z" },
    ];
    downloads.engineRecoil.mockImplementationOnce(async () => {
      machine.set({ engines: ["2025.04.01", "2025.06.12"] });
      return {};
    });
    const outcome = check({
      requirements: launchRequirements({ engineVersion: "2025.06.12" }),
      target: targetFor("2025.04.01"),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(outcome.result).toEqual({
        ready: true,
        target: targetFor("2025.06.12"),
      }),
    );
  });

  it("refuses without a drawer when there is no engine and none was named", async () => {
    machine.set({ engines: [] });
    const outcome = check({
      requirements: launchRequirements({ game: "Beyond All Reason test-1" }),
    });

    await waitFor(() =>
      expect(outcome.result).toEqual({ ready: false, reason: "no-engine" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets the player go on when the install cannot be read", async () => {
    machine.set({ scanError: "no libunitsync found" });
    const outcome = check({
      requirements: launchRequirements({ map: "Comet Catcher Redux" }),
    });

    await screen.findByText("no libunitsync found");
    expect(outcome.result).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));

    await waitFor(() =>
      expect(outcome.result).toEqual({
        ready: true,
        target: targetFor("2025.04.01"),
      }),
    );
  });

  it("ends the first check as cancelled when a second launch asks", async () => {
    const first = check({
      requirements: launchRequirements({ map: "Tabula" }),
    });
    await screen.findByText("Tabula");
    const second = check({
      requirements: launchRequirements({ map: "Comet Catcher Redux" }),
    });

    await waitFor(() =>
      expect(first.result).toEqual({ ready: false, reason: "cancelled" }),
    );
    await waitFor(() => expect(second.result?.ready).toBe(true));
  });
});
