// @vitest-environment happy-dom

/**
 * The games page inside the real onboarding provider and wizard shell. The
 * wizard context is stubbed so each test says which games the decision holds.
 * The download queue, the write folder and the branding catalog are stubbed
 * because each of them reaches Tauri.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SuggestedGame } from "@/content/branding";
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
    cancel: () => {},
    retry: () => {},
  }),
}));

const enqueue = vi.fn((_input: { kind: string; args: unknown }) => "q1");
vi.mock("@/downloads/DownloadQueueProvider", () => ({
  useDownloadQueue: () => ({
    enqueue,
    waitFor: () => new Promise(() => {}),
    items: [],
    failureFor: () => null,
    completedFor: () => false,
  }),
}));

vi.mock("@/downloads/config", async (original) => ({
  ...(await original<typeof import("@/downloads/config")>()),
  useWriteRoot: () => ({ path: "/data", loading: false }),
}));

vi.mock("@/content/branding", async (original) => ({
  ...(await original<typeof import("@/content/branding")>()),
  useBrandingCatalog: () => [],
  useGithubGameRepos: () => [],
  useBrandingImage: () => undefined,
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
  enqueue.mockClear();
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
