// @vitest-environment happy-dom

/**
 * What the topbar says while coilbox updates itself (issue #1790).
 *
 * Start an app update from Settings > Updates, walk away, and the transfer used
 * to be invisible: the download indicator only knew about the content queue,
 * and the "Update available" pill said the same thing whether a download had
 * started or not. So these drive both topbar widgets together, since the whole
 * point is that between them they always say what is going on.
 *
 * A DOM environment is opened for this file alone, by the docblock at the top.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DownloadQueueBadge from "../downloads/DownloadQueueBadge";
import { DownloadQueueProvider } from "../downloads/DownloadQueueProvider";
import UpdateBadge from "./UpdateBadge";
import { UpdaterProvider, useUpdater } from "./UpdaterProvider";

/** The halves of the fake update, held open so a test can drive them. */
interface Driver {
  emit: (event: unknown) => void;
  finishDownload: () => void;
  failDownload: (message: string) => void;
  finishInstall: () => void;
}

let driver: Driver;

function fakeUpdate() {
  return {
    version: "1.2.3",
    body: "",
    download: (onEvent: (e: unknown) => void) =>
      new Promise<void>((resolve, reject) => {
        driver.emit = onEvent;
        driver.finishDownload = resolve;
        driver.failDownload = (m) => reject(new Error(m));
      }),
    install: () =>
      new Promise<void>((resolve) => {
        driver.finishInstall = resolve;
      }),
  };
}

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.2" }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => {} }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: async () => fakeUpdate(),
}));
vi.mock("../notify/notify", () => ({ notify: async () => {} }));
vi.mock("../profile/profile", () => ({ isUpdaterEnabled: () => true }));

// Keep `Channel`, which the download queue constructs for every queue item, and
// replace only the command call the install makes between download and install.
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => {}),
}));

vi.mock("../downloads/bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
}));
vi.mock("../downloads/downloadGame", () => ({
  downloadGameAnySource: vi.fn(),
}));
vi.mock("../downloads/downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../content/config", () => ({ invalidateScans: vi.fn() }));
vi.mock("../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
}));

/** Both topbar widgets, plus the two buttons the settings page would offer. */
function Topbar() {
  const { runCheck, runInstall } = useUpdater();
  return (
    <>
      <button type="button" onClick={() => void runCheck()}>
        check
      </button>
      <button type="button" onClick={() => void runInstall()}>
        install
      </button>
      <UpdateBadge />
      <DownloadQueueBadge />
    </>
  );
}

function renderTopbar() {
  return render(
    <MemoryRouter>
      <DownloadQueueProvider>
        <UpdaterProvider>
          <Topbar />
        </UpdaterProvider>
      </DownloadQueueProvider>
    </MemoryRouter>,
  );
}

/** Find the update, then start downloading it. */
async function startInstall() {
  renderTopbar();
  await act(async () => {
    screen.getByText("check").click();
  });
  await screen.findByText("Update available");
  await act(async () => {
    screen.getByText("install").click();
  });
}

const indicator = () => screen.queryByText(/downloading/);

beforeEach(() => {
  driver = {
    emit: () => {},
    finishDownload: () => {},
    failDownload: () => {},
    finishInstall: () => {},
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("coilbox downloading its own update", () => {
  it("shows in the download indicator, so leaving the settings page still shows it", async () => {
    await startInstall();

    await act(async () => {
      driver.emit({ event: "Started", data: { contentLength: 10_000_000 } });
      driver.emit({ event: "Progress", data: { chunkLength: 2_000_000 } });
    });

    await waitFor(() => expect(indicator()).not.toBeNull());
    expect(indicator()?.textContent).toContain("1 downloading");
    // Two pills about one transfer is the clutter the indicator exists to
    // avoid, so the update pill steps aside while the indicator has it.
    expect(screen.queryByText("Update available")).toBeNull();
  });

  it("hands back to the update pill once the transfer is over", async () => {
    await startInstall();

    await act(async () => {
      driver.emit({ event: "Started", data: { contentLength: 10_000_000 } });
    });
    await waitFor(() => expect(indicator()).not.toBeNull());

    // The download ends and the installer takes over. Nothing is transferring
    // any more, so the indicator lets go rather than sitting at 100% forever.
    await act(async () => {
      driver.emit({ event: "Finished" });
      driver.finishDownload();
    });

    await screen.findByText("Installing update");
    expect(indicator()).toBeNull();
  });

  it("asks for a restart once the install finishes", async () => {
    await startInstall();

    await act(async () => {
      driver.emit({ event: "Finished" });
      driver.finishDownload();
    });
    await screen.findByText("Installing update");

    await act(async () => {
      driver.finishInstall();
    });

    await screen.findByText("Restart to update");
  });

  it("leaves nothing in the indicator when the download fails", async () => {
    await startInstall();

    await act(async () => {
      driver.emit({ event: "Started", data: { contentLength: 10_000_000 } });
      driver.emit({ event: "Progress", data: { chunkLength: 2_000_000 } });
    });
    await waitFor(() => expect(indicator()).not.toBeNull());

    await act(async () => {
      driver.failDownload("network went away");
    });

    await waitFor(() => expect(indicator()).toBeNull());
    // Still offerable: the update did not go away just because the transfer did.
    expect(screen.queryByText("Update available")).not.toBeNull();
  });
});
