// @vitest-environment happy-dom

/**
 * The first run of a distribution that bundles its engine (issue #3668), from
 * launch to the setup card, driven rather than read.
 *
 * The copy itself is Rust and has its own tests. These cover what the player
 * sees: the setup card says the engine is being set up instead of offering a
 * download, and every way the copy can fail leaves the download offer there.
 * They also pin that a coilbox with no bundle never asks and sees the card it
 * always did.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadProgress } from "../downloads/bindings";
import type { BundleReport } from "./bindings";

vi.mock("@picoframe/frame", () => ({
  useSetting: (_key: string, fallback: unknown) => [fallback, () => {}],
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} />
  ),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));

/** One copy held open, so a test can drive it. */
interface Copy {
  args: { writePath: string; platform?: string | null; version: string };
  progress: (p: DownloadProgress) => void;
  finish: () => void;
  fail: (message: string) => void;
}
const copies: Copy[] = [];

const bundle = vi.hoisted(() => ({
  inspect: vi.fn<() => Promise<{ bundle: BundleReport | null }>>(),
  cancel: vi.fn(async () => ({ cancelled: true })),
}));
vi.mock("./bindings", () => ({
  contentBundleInspect: bundle.inspect,
  contentBundleCancel: bundle.cancel,
  contentBundleInstallEngine: vi.fn(
    (
      args: Copy["args"] & {
        onProgress: { onmessage: (p: DownloadProgress) => void };
      },
    ) =>
      new Promise((resolve, reject) => {
        copies.push({
          args,
          progress: (p) => args.onProgress.onmessage(p),
          finish: () =>
            resolve({ path: "/pkg/engine", copied: true, bytes: 149066152 }),
          fail: (message) => reject(new Error(message)),
        });
      }),
  ),
  contentCreateStandardRoot: vi.fn(),
  contentRecreateRoot: vi.fn(),
}));

const setup = vi.hoisted(() => ({
  status: vi.fn(() => ({
    needsFolder: false,
    needsEngine: true,
    complete: false,
    refresh: async () => {},
  })),
}));
vi.mock("./config", () => ({
  useSetupStatus: () => setup.status(),
  invalidateScans: vi.fn(),
}));

const place = vi.hoisted(() => ({
  profileRoot: vi.fn(() => "/pkg/.coilbox"),
  writeRoot: vi.fn<() => { path?: string; loading: boolean }>(() => ({
    path: "/pkg",
    loading: false,
  })),
}));
vi.mock("../profile/profile", () => ({
  getProfileRoot: () => place.profileRoot(),
}));
vi.mock("../downloads/config", () => ({
  useWriteRoot: () => place.writeRoot(),
  useWriteRootPath: () => place.writeRoot().path,
  useDefaultWriteRoot: () => () => {},
}));

const newest = vi.hoisted(() => ({
  fetch: vi.fn(async () => ({
    release: { version: "2025.06.12", assetUrl: "https://example/e.7z" },
    platform: "macos_arm64",
  })),
}));
vi.mock("../downloads/engineInstall", () => ({
  fetchNewestRecoil: newest.fetch,
}));

/** Stands in for the rescan and cache warm, which have tests of their own. */
const installEngine = vi.hoisted(() =>
  vi.fn(async (copy: () => Promise<unknown>) => {
    await copy();
  }),
);
vi.mock("../downloads/warmEngineCache", () => ({ installEngine }));

vi.mock("../downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
// A real Tauri channel needs the webview's IPC, which a test has not got.
vi.mock("../downloads/progressChannel", () => ({
  progressChannel: (sink: (p: DownloadProgress | null) => void) => {
    sink(null);
    return { onmessage: sink };
  },
}));
vi.mock("../downloads/downloadGame", () => ({
  downloadGameAnySource: vi.fn(),
}));
vi.mock("../downloads/downloadMap", () => ({
  downloadMapAnySource: vi.fn(),
}));
vi.mock("./rapidPoolWarm", () => ({ warmAllRoots: vi.fn(async () => {}) }));
vi.mock("./getStartedOffer", () => ({
  GetStartedOfferContext: ({ children }: { children: ReactNode }) => children,
  useCollectGetStartedOffer: () => null,
}));
vi.mock("./pages/components/GetStartedCard", () => ({
  GetStartedCard: () => null,
}));

import {
  DownloadQueueProvider,
  useDownloadQueue,
} from "../downloads/DownloadQueueProvider";
import { BundledEngineSetup } from "./BundledEngineSetup";
import { SetupCard } from "./pages/components/SetupCard";

const ENGINE = {
  platform: "macos_arm64",
  version: "2025.06.12",
  path: "engine/macos_arm64/2025.06.12",
  bytes: 149066152,
  forThisPlatform: true,
  installed: false,
};

function report(over: Partial<BundleReport> = {}): BundleReport {
  return {
    path: "/pkg/.coilbox/content",
    games: 1,
    maps: 1,
    packages: 0,
    engines: [ENGINE],
    problems: [],
    ...over,
  };
}

/** Cancels whatever is running, as the topbar's cancel button would. */
function CancelRunning() {
  const { running, cancel } = useDownloadQueue();
  return (
    <button type="button" onClick={() => running[0] && cancel(running[0].id)}>
      Cancel running
    </button>
  );
}

function launch() {
  return render(
    <MemoryRouter>
      <DownloadQueueProvider>
        <BundledEngineSetup>
          <SetupCard />
          <CancelRunning />
        </BundledEngineSetup>
      </DownloadQueueProvider>
    </MemoryRouter>,
  );
}

const DOWNLOAD = /Download newest engine \(2025\.06\.12\)/;

beforeEach(() => {
  copies.length = 0;
  bundle.inspect.mockReset();
  bundle.inspect.mockResolvedValue({ bundle: report() });
  bundle.cancel.mockClear();
  installEngine.mockClear();
  newest.fetch.mockClear();
  place.profileRoot.mockReturnValue("/pkg/.coilbox");
  place.writeRoot.mockReturnValue({ path: "/pkg", loading: false });
});
afterEach(cleanup);

describe("a coilbox with nothing bundled", () => {
  it("never reads for a bundle when it is not portable, and offers the download", async () => {
    place.profileRoot.mockReturnValue("");
    launch();
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();
    expect(bundle.inspect).not.toHaveBeenCalled();
    expect(screen.queryByText(/Setting up engine/)).toBeNull();
  });

  it("offers the download when a distribution has no bundle", async () => {
    bundle.inspect.mockResolvedValue({ bundle: null });
    launch();
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();
    expect(bundle.inspect).toHaveBeenCalledWith({ writePath: "/pkg" });
    expect(copies).toHaveLength(0);
  });
});

describe("a distribution that bundles its engine", () => {
  it("sets the engine up instead of offering a download, and says so", async () => {
    launch();
    await waitFor(() => expect(copies).toHaveLength(1));
    expect(copies[0].args).toMatchObject({
      writePath: "/pkg",
      platform: "macos_arm64",
      version: "2025.06.12",
    });
    expect(screen.getByText("Setting up engine 2025.06.12")).toBeTruthy();
    // Nothing to download, so no download is offered in any words, and the
    // newest release is never even looked up.
    expect(screen.queryByText(/download/i)).toBeNull();
    expect(newest.fetch).not.toHaveBeenCalled();

    act(() =>
      copies[0].progress({
        phase: "copying",
        downloadedBytes: 74533076,
        totalBytes: 149066152,
        percent: 50,
        bytesPerSec: null,
      }),
    );
    expect(await screen.findByText(/71 MB of 142 MB/)).toBeTruthy();

    await act(async () => copies[0].finish());
    // The same install step a downloaded engine takes: rescan, then warm.
    expect(installEngine).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/Engine 2025\.06\.12 is set up/),
    ).toBeTruthy();
    expect(screen.queryByText(/download/i)).toBeNull();
  });

  it("copies nothing when the player already has that engine", async () => {
    bundle.inspect.mockResolvedValue({
      bundle: report({ engines: [{ ...ENGINE, installed: true }] }),
    });
    launch();
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();
    expect(copies).toHaveLength(0);
  });

  it("falls back to the download when the bundle has no engine for this platform", async () => {
    bundle.inspect.mockResolvedValue({
      bundle: report({
        engines: [{ ...ENGINE, platform: "windows64", forThisPlatform: false }],
        problems: [
          { kind: "noEngineForThisPlatform", path: "engine", detail: "x" },
        ],
      }),
    });
    launch();
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();
    expect(copies).toHaveLength(0);
    // Said in the health checklist, not to the player as an error.
    expect(screen.queryByText(/Could not set up/)).toBeNull();
  });

  it("falls back to the download when the bundle cannot be read", async () => {
    bundle.inspect.mockRejectedValue(new Error("permission denied"));
    launch();
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();
    expect(copies).toHaveLength(0);
  });

  it("falls back to the download when there is no download folder to copy into", async () => {
    place.writeRoot.mockReturnValue({ path: undefined, loading: false });
    launch();
    expect(await screen.findByText(/Download newest engine/)).toBeTruthy();
    expect(bundle.inspect).not.toHaveBeenCalled();
  });

  it("waits for the download folder to be read before it looks", async () => {
    place.writeRoot.mockReturnValue({ loading: true });
    const view = launch();
    expect(bundle.inspect).not.toHaveBeenCalled();
    expect(screen.queryByText(DOWNLOAD)).toBeNull();
    place.writeRoot.mockReturnValue({ path: "/pkg", loading: false });
    view.rerender(
      <MemoryRouter>
        <DownloadQueueProvider>
          <BundledEngineSetup>
            <SetupCard />
          </BundledEngineSetup>
        </DownloadQueueProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(copies).toHaveLength(1));
  });
});

describe("when the copy fails", () => {
  it("says how much space is needed and free, and offers a retry and the download", async () => {
    launch();
    await waitFor(() => expect(copies).toHaveLength(1));
    const message =
      "Setting up the engine needs 142 MB of free space, and the drive holding /pkg has 50 MB free.";
    await act(async () => copies[0].fail(message));

    const error = await screen.findByText(
      /Could not set up engine 2025\.06\.12/,
    );
    expect(error.textContent).toContain("needs 142 MB of free space");
    expect(error.textContent).toContain("has 50 MB free");
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(copies).toHaveLength(2));
    expect(bundle.inspect).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Setting up engine 2025.06.12")).toBeTruthy();
  });

  it("shows a missing or read-only folder's reason the same way", async () => {
    launch();
    await waitFor(() => expect(copies).toHaveLength(1));
    await act(async () =>
      copies[0].fail("could not write /pkg/.coilbox-installing: read-only"),
    );
    const error = await screen.findByText(/Could not set up engine/);
    expect(error.textContent).toContain("read-only");
    expect(screen.getByText(DOWNLOAD)).toBeTruthy();
  });

  it("stops the copy in the content plugin when cancelled, then offers the download", async () => {
    launch();
    await waitFor(() => expect(copies).toHaveLength(1));
    fireEvent.click(screen.getByText("Cancel running"));
    expect(bundle.cancel).toHaveBeenCalledTimes(1);
    await act(async () => copies[0].fail("cancelled"));
    expect(
      await screen.findByText(/Setting up engine 2025\.06\.12 was cancelled/),
    ).toBeTruthy();
    expect(screen.queryByText(/Could not set up/)).toBeNull();
    expect(await screen.findByText(DOWNLOAD)).toBeTruthy();
  });

  it("copies again on the next launch after an interrupted one", async () => {
    // The Rust side clears a half copy, so the next launch still finds the
    // engine missing and starts over.
    const first = launch();
    await waitFor(() => expect(copies).toHaveLength(1));
    first.unmount();
    launch();
    await waitFor(() => expect(copies).toHaveLength(2));
    expect(bundle.inspect).toHaveBeenCalledTimes(2);
  });
});
