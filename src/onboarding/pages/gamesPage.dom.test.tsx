// @vitest-environment happy-dom

/**
 * The games page inside the real onboarding provider and wizard shell. The
 * wizard context is stubbed so each test says which games the decision holds.
 * The download queue, the write folder and the branding catalog are stubbed
 * because each of them reaches Tauri. The fake queue keeps its items in a store
 * so a download shows wherever the wizard reads the queue.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuggestedGame } from "@/content/branding";
import {
  type EnqueueInput,
  identityOf,
  type QueueItem,
} from "@/downloads/DownloadQueueProvider";
import { IDLE_RATE } from "@/downloads/downloadRate";
import type { WizardContext } from "../relevance";

const SF: SuggestedGame = {
  id: "sf",
  title: "Splinter Faction",
  download: { kind: "rapid", tag: "sf:test" },
};
const ZK: SuggestedGame = {
  id: "zk",
  title: "Zero-K",
  download: { kind: "rapid", tag: "zk:stable" },
};

const BASE: WizardContext = {
  languageStored: true,
  profileMode: true,
  profileColours: true,
  hubEnabled: false,
  hub: { loading: false, signedIn: false, unknown: false },
  lobbyAccountCount: 1,
  games: { kind: "pick", games: [SF, ZK] },
};

let ctx: WizardContext = BASE;
vi.mock("../useWizardContext", () => ({
  useWizardContext: () => ({ ctx, candidates: [] }),
}));

vi.mock("../useBackgroundDownloads", () => ({
  useBackgroundDownloads: () => ({
    items: [],
    problems: [],
    cancel: () => {},
    retry: () => {},
  }),
}));

let queueItems: QueueItem[] = [];
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const enqueue = vi.fn((input: EnqueueInput) => {
  const id = `q${queueItems.length + 1}`;
  queueItems = [
    ...queueItems,
    {
      ...input,
      id,
      identity: identityOf(input),
      status: "active",
      progress: {
        phase: "downloading",
        downloadedBytes: 10,
        totalBytes: 100,
        percent: 10,
        bytesPerSec: null,
      },
      rate: IDLE_RATE,
      startedAt: 1,
      error: null,
    } as QueueItem,
  ];
  for (const l of listeners) l();
  return id;
});
vi.mock("@/downloads/DownloadQueueProvider", async (original) => ({
  ...(await original<typeof import("@/downloads/DownloadQueueProvider")>()),
  useDownloadQueue: () => ({
    enqueue,
    waitFor: () => new Promise(() => {}),
    items: useSyncExternalStore(subscribe, () => queueItems),
    settled: [],
    failureFor: () => null,
    completedFor: () => false,
  }),
}));

let writeRoot: { path?: string; loading: boolean } = {
  path: "/data",
  loading: false,
};

vi.mock("@/downloads/config", async (original) => ({
  ...(await original<typeof import("@/downloads/config")>()),
  useWriteRoot: () => writeRoot,
}));

vi.mock("@/content/branding", async (original) => ({
  ...(await original<typeof import("@/content/branding")>()),
  useBrandingCatalog: () => [],
  useGithubGameRepos: () => [],
  useBrandingImage: () => undefined,
}));

let matcher: ((name: string) => boolean) | null = null;
vi.mock("@/profile/profile", async (original) => ({
  ...(await original<typeof import("@/profile/profile")>()),
  getGameMatcher: () => matcher,
}));

const { OnboardingProvider } = await import("../OnboardingProvider");

let storage = memoryStorage();

function show() {
  return render(
    <PersistentStoreProvider storage={storage}>
      <ThemeProvider>
        <MemoryRouter>
          <OnboardingProvider>
            <p>home</p>
          </OnboardingProvider>
        </MemoryRouter>
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

const downloadButtons = () =>
  screen.queryAllByRole("button", { name: /^Download / });

beforeEach(() => {
  storage = memoryStorage();
  ctx = BASE;
  queueItems = [];
  writeRoot = { path: "/data", loading: false };
  enqueue.mockClear();
  matcher = () => true;
});

afterEach(() => {
  cleanup();
});

it("renders one card per game in the decision", () => {
  show();
  expect(screen.getByText("Download a game")).toBeTruthy();
  expect(downloadButtons()).toHaveLength(2);
  expect(
    screen.getByRole("button", { name: "Download Splinter Faction" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download Zero-K" })).toBeTruthy();
});

it("queues the game a card's Download button names", async () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: "Download Splinter Faction" }),
  );
  await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
  expect(enqueue.mock.calls[0][0]).toMatchObject({
    kind: "rapid",
    args: { tag: "sf:test", writePath: "/data" },
  });
});

it("keeps the cards once a download installs a game mid run", () => {
  const view = show();
  // A finished download makes the scan find a game, so the live decision
  // turns to none. The page keeps the list the run opened with.
  ctx = { ...BASE, games: { kind: "none" } };
  view.rerender(
    <PersistentStoreProvider storage={storage}>
      <ThemeProvider>
        <MemoryRouter>
          <OnboardingProvider>
            <p>home again</p>
          </OnboardingProvider>
        </MemoryRouter>
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
  expect(screen.getByText("home again")).toBeTruthy();
  expect(downloadButtons()).toHaveLength(2);
});

it("follows a game started on the page in the pill and on Done", async () => {
  show();
  fireEvent.click(
    screen.getByRole("button", { name: "Download Splinter Faction" }),
  );
  await vi.waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Cancel Game: Splinter Faction" }),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText("You're ready")).toBeTruthy();
  // The progress row, labelled with the download, beside the pill's own entry.
  const progressRow = screen
    .getAllByText("Game: Splinter Faction")
    .map((el) => el.closest("[data-testid=done-download]"))
    .find(Boolean);
  expect(progressRow?.querySelector("[role=progressbar]")).toBeTruthy();
});

it("draws no heading of its own under the wizard title", () => {
  show();
  expect(screen.queryByRole("heading", { name: "Games" })).toBeNull();
  expect(screen.getAllByRole("heading")).toHaveLength(1);
});

it("says to set a download folder without a link out of the wizard", () => {
  writeRoot = { path: undefined, loading: false };
  show();
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByText(
      "Set a download folder in Content folders settings to enable downloads.",
    ),
  ).toBeTruthy();
  expect(within(dialog).queryByRole("link")).toBeNull();
});

const FEATURED_LINE =
  "Coilbox runs other games too. Find them in Games after setup.";

it("calls the games featured when no profile filter narrows them", () => {
  matcher = null;
  show();
  expect(screen.getByRole("dialog", { name: "Featured games" })).toBeTruthy();
  expect(screen.getByText(FEATURED_LINE)).toBeTruthy();
  expect(screen.queryByText("Download a game")).toBeNull();
});

it("says Download a game, with no line, when a profile filter picks them", () => {
  show();
  expect(screen.getByRole("dialog", { name: "Download a game" })).toBeTruthy();
  expect(screen.queryByText(FEATURED_LINE)).toBeNull();
});

it("centres the cards", () => {
  show();
  const list = within(screen.getByRole("dialog")).getByRole("list");
  expect(list.className).toContain("justify-center");
});
