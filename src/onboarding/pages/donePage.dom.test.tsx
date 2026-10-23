// @vitest-environment happy-dom

/**
 * The Done page inside the real wizard shell. The profile is stubbed so a test
 * can set `setupImage` and `home.background`, and decide whether the image
 * resolves. happy-dom drops the backdrop's inline SVG data URL from a style, so
 * the real `backdropStyle` runs with that one value swapped for a plain URL.
 */

import {
  memoryStorage,
  PersistentStoreProvider,
  ThemeProvider,
} from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueueItem } from "@/downloads/DownloadQueueProvider";
import { IDLE_RATE } from "@/downloads/downloadRate";
import type { Profile } from "@/profile/profile";
import type { BackgroundProblem } from "../useBackgroundDownloads";

let profile: Profile = { version: 1 };
const resolveImage =
  vi.fn<(path: string | undefined) => Promise<string | null>>();
vi.mock("@/profile/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/profile/profile")>()),
  getProfile: () => profile,
  resolveProfileImage: (path: string | undefined) => resolveImage(path),
}));

vi.mock("@/home/background", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/home/background")>();
  return {
    ...real,
    backdropStyle: (...args: Parameters<typeof real.backdropStyle>) => {
      const style = real.backdropStyle(...args);
      return style && { ...style, backgroundImage: 'url("home-backdrop")' };
    },
  };
});

const { Wizard } = await import("../Wizard");
const { WizardDownloadsContext, WizardProblemsContext } = await import(
  "../wizardContexts"
);
const PLATFORM = "No engine is available to download for this platform.";

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

function show(downloads: QueueItem[] = [], problems: BackgroundProblem[] = []) {
  return render(
    <PersistentStoreProvider storage={memoryStorage()}>
      <ThemeProvider>
        <WizardDownloadsContext.Provider value={downloads}>
          <WizardProblemsContext.Provider value={problems}>
            <Wizard
              pages={["done"]}
              onSettle={() => {}}
              onClose={onClose}
              downloads={downloads}
              problems={problems}
              onCancelDownload={() => {}}
              onRetryDownload={() => {}}
            />
          </WizardProblemsContext.Provider>
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

const backdrop = () => screen.queryByTestId("done-backdrop");
const setupImage = () => screen.queryByTestId("done-setup-image");

it("paints the home backdrop by default", () => {
  show();
  expect(backdrop()?.style.backgroundImage).toContain("url(");
  expect(setupImage()).toBeNull();
  expect(resolveImage).not.toHaveBeenCalled();
});

it("paints no picture when the profile switches the home backdrop off", () => {
  profile = { version: 1, home: { background: false } };
  show();
  expect(backdrop()).toBeNull();
  expect(setupImage()).toBeNull();
  expect(screen.getByRole("heading", { name: "You're ready" })).toBeTruthy();
});

it("paints the setup image, and never the backdrop before it", async () => {
  profile = { version: 1, setupImage: "setup.webp" };
  let settle: (src: string | null) => void = () => {};
  resolveImage.mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  show();
  expect(backdrop()).toBeNull();
  expect(setupImage()).toBeNull();
  settle("data:image/webp;base64,AAAA");
  const image = await screen.findByTestId("done-setup-image");
  expect(image.getAttribute("src")).toBe("data:image/webp;base64,AAAA");
  expect(image.getAttribute("alt")).toBe("");
  expect(resolveImage).toHaveBeenCalledWith("setup.webp");
  expect(backdrop()).toBeNull();
});

it("paints no picture when setupImage is false", () => {
  profile = { version: 1, setupImage: false };
  show();
  expect(backdrop()).toBeNull();
  expect(setupImage()).toBeNull();
  expect(resolveImage).not.toHaveBeenCalled();
});

it("falls back to the backdrop when the setup image does not resolve", async () => {
  profile = { version: 1, setupImage: "missing.webp" };
  show();
  expect(await screen.findByTestId("done-backdrop")).toBeTruthy();
  expect(setupImage()).toBeNull();
});

it("falls back to the backdrop when the setup image fails to load", async () => {
  profile = { version: 1, setupImage: "https://example.com/setup.webp" };
  resolveImage.mockResolvedValue("https://example.com/setup.webp");
  show();
  fireEvent.error(await screen.findByTestId("done-setup-image"));
  expect(backdrop()).toBeTruthy();
  expect(setupImage()).toBeNull();
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

it("says under the heading when the platform has no engine release", () => {
  show(
    [],
    [{ id: "engine", label: "Engine", message: PLATFORM, retry: false }],
  );
  const lines = screen.getAllByText(PLATFORM);
  expect(lines).toHaveLength(1);
  expect(lines[0].closest("[data-testid=done-problem]")).toBeTruthy();
  expect(screen.queryByTestId("downloads-pill")).toBeNull();
});

it("leaves an error that can be retried to the pill", () => {
  show(
    [],
    [{ id: "engine", label: "Engine", message: "offline", retry: true }],
  );
  expect(screen.queryByTestId("done-problem")).toBeNull();
  const pill = screen.getByTestId("downloads-pill");
  expect(screen.getByTestId("wizard-footer").contains(pill)).toBe(true);
  expect(pill.contains(screen.getByText("offline"))).toBe(true);
});
