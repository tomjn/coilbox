// @vitest-environment happy-dom

/**
 * The Done page inside the real wizard shell. The profile is stubbed so a test
 * can set `setupImage` and decide whether it resolves.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import { IDLE_RATE } from "@/downloads/downloadRate";
import type { Profile } from "@/profile/profile";

let profile: Profile = { version: 1 };
const resolveImage =
  vi.fn<(path: string | undefined) => Promise<string | null>>();
vi.mock("@/profile/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/profile/profile")>()),
  getProfile: () => profile,
  resolveProfileImage: (path: string | undefined) => resolveImage(path),
}));

const { Wizard } = await import("../Wizard");
const { WizardDownloadsContext } = await import("../wizardContexts");

const GAME: QueueItem = {
  kind: "game",
  label: "Game: Splinter Faction",
  args: { gameName: "Splinter Faction" },
  id: "one",
  identity: "game:Splinter Faction",
  status: "active",
  progress: {
    phase: "downloading",
    downloadedBytes: 10,
    totalBytes: 100,
    percent: 10,
    bytesPerSec: null,
  },
  rate: IDLE_RATE,
  startedAt: 1_000_000,
  error: null,
};

const onClose = vi.fn();

function show(downloads: QueueItem[] = []) {
  return render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <WizardDownloadsContext.Provider value={downloads}>
          <Wizard
            pages={["done"]}
            onSettle={() => {}}
            onClose={onClose}
            downloads={downloads}
            onCancelDownload={() => {}}
            onRetryDownload={() => {}}
          />
        </WizardDownloadsContext.Provider>
      </ThemeProvider>
    </PersistentStoreProvider>,
  );
}

beforeEach(() => {
  profile = { version: 1 };
  resolveImage.mockReset();
  resolveImage.mockResolvedValue(null);
  onClose.mockReset();
});

afterEach(() => {
  cleanup();
});

it("shows the heading and a Start playing button, with no eyebrow", () => {
  show();
  expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "You're ready" })).toBeTruthy();
  expect(screen.getAllByRole("heading")).toHaveLength(1);
  expect(screen.queryByText("All set")).toBeNull();
  screen.getByRole("button", { name: "Start playing" }).click();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows no summary rows", () => {
  show();
  expect(screen.queryByText("Language")).toBeNull();
  expect(screen.queryByText("Appearance")).toBeNull();
  expect(screen.queryByText("Games")).toBeNull();
});

it("shows the Coilbox mark by default", async () => {
  show();
  expect(screen.getByTestId("setup-mark")).toBeTruthy();
  expect(screen.queryByTestId("setup-image")).toBeNull();
});

it("shows the profile's setup image when it resolves", async () => {
  profile = { version: 1, setupImage: "setup.webp" };
  resolveImage.mockResolvedValue("data:image/webp;base64,AAAA");
  show();
  const image = await screen.findByTestId("setup-image");
  expect(image.getAttribute("src")).toBe("data:image/webp;base64,AAAA");
  expect(image.getAttribute("alt")).toBe("");
  expect(resolveImage).toHaveBeenCalledWith("setup.webp");
  expect(screen.queryByTestId("setup-mark")).toBeNull();
});

it("keeps the Coilbox mark when the setup image does not resolve", async () => {
  profile = { version: 1, setupImage: "missing.webp" };
  show();
  await vi.waitFor(() => expect(resolveImage).toHaveBeenCalled());
  expect(screen.getByTestId("setup-mark")).toBeTruthy();
  expect(screen.queryByTestId("setup-image")).toBeNull();
});

it("shows no progress row without downloads", () => {
  show();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("shows a progress row for each download", () => {
  show([GAME]);
  const row = screen
    .getAllByText("Game: Splinter Faction")
    .map((el) => el.closest("[data-testid=done-download]"))
    .find(Boolean) as HTMLElement;
  expect(row).toBeTruthy();
  expect(row.querySelector("[role=progressbar]")).toBeTruthy();
});
