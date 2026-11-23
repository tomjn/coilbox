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

const version = (tag: string, md5: string, installed = false): Version => ({
  tag,
  md5,
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
    // `byar:test` and the snapshot it points at are one package.
    versions: [
      version("byar:stable", "aaa"),
      version("byar:test", "bbb"),
      version("byar:git:1", "bbb"),
    ],
    ageSecs: 0,
  })),
}));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  useDownloadsConfig: () => [
    {
      rapidRepos: [
        { name: "Master", url: "https://master.test" },
        { name: "Other", url: "https://other.test" },
      ],
    },
    vi.fn(),
  ],
}));
/** Stands in for the real confirm-then-delete, recording the path it was
 *  given, so the test covers what the browser does once a package is gone. */
const { deletedPaths } = vi.hoisted(() => ({ deletedPaths: [] as string[] }));
vi.mock("../content/pages/components/DeleteArchiveButton", () => ({
  DeleteArchiveButton: ({
    path,
    name,
    onDeleted,
  }: {
    path: string;
    name: string;
    onDeleted: () => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        deletedPaths.push(path);
        onDeleted();
      }}
    >
      Delete {name}
    </button>
  ),
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

async function openByar(writePath?: string) {
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <DownloadQueueProvider>
          <RapidBrowser writePath={writePath} />
        </DownloadQueueProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "byar" }));
}

/** Download `byar:test` and let the queue prune the finished item. */
async function downloadTest(): Promise<HTMLButtonElement> {
  const button = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Download byar:test",
  });
  fireEvent.click(button);
  await waitFor(() => expect(finishDownload.current).not.toBeNull());
  await act(async () => finishDownload.current?.());
  // `PRUNE_MS` in the queue is 4000.
  await act(async () => vi.advanceTimersByTime(10_000));
  return button;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  finishDownload.current = null;
  deletedPaths.length = 0;
});

/** Lists `sa` and `byar`, and holds `sa`'s versions until the test releases
 *  them, so a later click can overtake the request. */
async function openWithSlowSa() {
  const { dlRepos, dlVersions } = await import("./bindings");
  vi.mocked(dlRepos).mockResolvedValueOnce({
    repos: [
      { name: "sa", url: "https://master.test/sa" },
      { name: "byar", url: "https://master.test/byar" },
    ],
    ageSecs: 0,
    stale: false,
  });
  let releaseSa = () => {};
  vi.mocked(dlVersions).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseSa = () =>
          resolve({
            versions: [version("sa:test", "ccc")],
            ageSecs: 0,
            stale: false,
          });
      }),
  );
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <DownloadQueueProvider>
          <RapidBrowser />
        </DownloadQueueProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "sa" }));
  return () => act(async () => releaseSa());
}

it("ignores versions for a repository that is no longer selected", async () => {
  const releaseSa = await openWithSlowSa();
  fireEvent.click(screen.getByRole("button", { name: "byar" }));
  await screen.findByRole("button", { name: "Download byar:stable" });

  await releaseSa();

  expect(screen.queryByText("sa:test")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Download byar:stable" }),
  ).toBeTruthy();
});

it("ignores a repository list that a newer load has overtaken", async () => {
  const { dlRepos } = await import("./bindings");
  let releaseOld = () => {};
  vi.mocked(dlRepos)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOld = () =>
            resolve({
              repos: [{ name: "sa", url: "https://master.test/sa" }],
              ageSecs: 0,
              stale: false,
            });
        }),
    )
    .mockImplementationOnce(() => new Promise(() => {}));
  render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>
        <DownloadQueueProvider>
          <RapidBrowser />
        </DownloadQueueProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  // The mount load is still out when the user picks another master.
  await waitFor(() => expect(dlRepos).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Other" }));
  await waitFor(() => expect(dlRepos).toHaveBeenCalledTimes(2));

  await act(async () => releaseOld());

  expect(screen.queryByRole("button", { name: "sa" })).toBeNull();
});

it("shows a stale disk copy, then swaps in the copy fetched this launch", async () => {
  const { dlVersions } = await import("./bindings");
  let releaseFresh = () => {};
  vi.mocked(dlVersions)
    .mockResolvedValueOnce({
      versions: [version("byar:stable", "aaa")],
      ageSecs: 34 * 24 * 3600,
      stale: true,
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFresh = () =>
            resolve({
              versions: [
                version("byar:stable", "aaa"),
                version("byar:test", "ddd"),
              ],
              ageSecs: 0,
              stale: false,
            });
        }),
    );
  await openByar();

  await screen.findByRole("button", { name: "Download byar:stable" });
  expect(screen.queryByText("byar:test")).toBeNull();
  await waitFor(() =>
    expect(dlVersions).toHaveBeenLastCalledWith(
      expect.objectContaining({ revalidate: true }),
    ),
  );

  await act(async () => releaseFresh());

  expect(
    screen.getByRole("button", { name: "Download byar:test" }),
  ).toBeTruthy();
  expect(screen.getAllByText("refreshed just now")).toHaveLength(2);
});

it("keeps a downloaded version installed after the queue forgets it", async () => {
  await openByar();
  const button = await downloadTest();

  expect(button.textContent).toBe("Installed");
  expect(button.disabled).toBe(true);
});

it("offers to delete every tag of a downloaded package, then to download it again", async () => {
  await openByar("/data/spring/");
  await downloadTest();

  // The snapshot is the same package, so it is installed too.
  expect(
    screen.getByRole("button", { name: "Delete byar:git:1" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Delete byar:test" }));

  expect(deletedPaths).toEqual(["/data/spring/packages/bbb.sdp"]);
  expect(
    screen.getByRole("button", { name: "Download byar:test" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Download byar:git:1" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Download byar:stable" }),
  ).toBeTruthy();
});
