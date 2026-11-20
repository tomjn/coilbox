// @vitest-environment happy-dom

/**
 * A rapid version downloaded from the browser has to stay marked installed
 * after the queue forgets the finished download, which it does a few seconds
 * later. Before, the row read "installed" from the queue alone and went back
 * to Download until the repository was opened again.
 */

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Version } from "./bindings";
import { DownloadQueueProvider } from "./DownloadQueueProvider";
import { RapidBrowser } from "./pages/components/RapidBrowser";

const { finishDownload } = vi.hoisted(() => ({
  finishDownload: { current: null as null | (() => void) },
}));

const version = (tag: string, installed = false): Version => ({
  tag,
  md5: "",
  name: tag,
  depends: [],
  kind: "release",
  installed,
});

vi.mock("./bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload: vi.fn(
    () =>
      new Promise((resolve) => {
        finishDownload.current = () => resolve({ message: "ok" });
      }),
  ),
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(),
  dlDownloadMap: vi.fn(),
  dlVersion: vi.fn(async () => ({})),
  dlRepos: vi.fn(async () => ({
    repos: [{ name: "byar", url: "https://master.test/byar" }],
    ageSecs: 0,
  })),
  dlVersions: vi.fn(async () => ({
    versions: [version("byar:stable"), version("byar:test")],
    ageSecs: 0,
  })),
}));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  useDownloadsConfig: () => [
    {
      rapidRepos: [{ name: "Master", url: "https://master.test" }],
    },
    vi.fn(),
  ],
}));
vi.mock("./warmEngineCache", () => ({ installEngine: vi.fn() }));
vi.mock("./downloadGame", () => ({ downloadGameAnySource: vi.fn() }));
vi.mock("./downloadMap", () => ({ downloadMapAnySource: vi.fn() }));
vi.mock("../hub/downloadCount", () => ({ reportDownload: vi.fn() }));
vi.mock("../content/bindings", () => ({
  contentRescan: vi.fn(async () => {}),
}));
vi.mock("../content/config", () => ({
  forgetScans: vi.fn(),
  invalidateScans: vi.fn(),
  rescanMounted: vi.fn(),
}));
vi.mock("../content/rapidPoolWarm", () => ({
  warmAllRoots: vi.fn(async () => {}),
  warmRapidPackage: vi.fn(async () => {}),
}));

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  // `Channel` asks Tauri for a callback id when it is made, and no Tauri is
  // behind a test.
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = {
    transformCallback: (cb: unknown) => cb,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("keeps a downloaded version installed after the queue forgets it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <DownloadQueueProvider>
          <RapidBrowser />
        </DownloadQueueProvider>
      </MemoryRouter>
    </I18nProvider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "byar" }));
  const button = await screen.findByRole("button", {
    name: "Download byar:test",
  });
  fireEvent.click(button);
  await waitFor(() => expect(finishDownload.current).not.toBeNull());
  await act(async () => finishDownload.current?.());
  await waitFor(() => expect(button.textContent).toBe("Done"));

  // Long enough for the queue to prune the finished item.
  await act(async () => vi.advanceTimersByTime(10_000));

  expect(button.textContent).toBe("Installed");
  expect((button as HTMLButtonElement).disabled).toBe(true);
});
