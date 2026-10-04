// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AchievementResult } from "../../content/achievements";
import type { Career } from "../career";
import type { CareerData, SourceId, SourceStatus } from "../useCareer";

const hoisted = vi.hoisted(() => ({
  data: null as unknown,
  hide: [] as string[],
  /** The headers map the icon reads, by installed game name. */
  headers: new Map<string, string>(),
  /** What the cached image path hands back for a logo or banner. */
  image: undefined as string | undefined,
}));

// The page reads the stores through this hook, which needs the app frame.
vi.mock("../useCareer", () => ({ useCareer: () => hoisted.data }));
vi.mock("../../profile/profile", () => ({
  getProfile: () => ({ hide: hoisted.hide }),
}));

// The icon reads the scan and the cached art, which need the app frame.
vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/e", rootPath: "/r" },
  }),
  useUnitsyncScan: () => ({
    data: {
      games: [
        {
          name: "Balanced Annihilation V15.9.8",
          info: { shortname: "ba", version: "V15.9.8" },
        },
      ],
    },
  }),
  useUnitsyncGameHeaders: () => ({ headers: hoisted.headers }),
}));
vi.mock("@/content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
  useBrandingImage: () => hoisted.image,
  useCachedImage: () => undefined,
}));
// No hub in these tests: the icon falls back to the local art.
vi.mock("@/hub/gameIcons", () => ({ useHubGameLogoUrl: () => undefined }));

import CareerPage from "./CareerPage";

const ready: SourceStatus = { state: "ready" };
const allReady: Record<SourceId, SourceStatus> = {
  campaigns: ready,
  conquest: ready,
  warpath: ready,
  ai: ready,
  games: ready,
};

const FULL: Career = {
  isEmpty: false,
  warpath: {
    runs: 2,
    wins: 1,
    deepest: 8,
    ascensionTier: 1,
    maxAscension: 5,
    loadouts: ["Armoured vanguard"],
    eventPools: [],
  },
  games: [
    {
      key: "ba",
      title: "Balanced Annihilation",
      installed: true,
      campaigns: [
        {
          id: "c 1",
          title: "Ridge",
          missions: 4,
          completed: 1,
          finished: false,
          nextMission: "Mission 2",
        },
      ],
      conquest: {
        finished: 3,
        won: 2,
        lost: 1,
        threatLevel: 2,
        inProgress: 0,
      },
      ai: { games: 14, wins: 1, losses: 1, undecided: 12, topAi: null },
    },
  ],
};

const EMPTY: Career = { isEmpty: true, warpath: null, games: [] };

function show(
  data: Pick<CareerData, "career" | "sources"> & Partial<CareerData>,
) {
  hoisted.data = { player: null, achievements: null, ...data };
  return render(
    <MemoryRouter>
      <CareerPage />
    </MemoryRouter>,
  );
}

const href = (name: string | RegExp) =>
  screen.getByRole("link", { name }).getAttribute("href");

beforeEach(() => {
  hoisted.hide = [];
  hoisted.headers = new Map();
  hoisted.image = undefined;
});
afterEach(cleanup);

describe("CareerPage", () => {
  it("says there is nothing yet, and where to start, without a box per mode", () => {
    show({ career: EMPTY, sources: allReady });
    expect(screen.getByText(/Nothing to show yet/)).toBeTruthy();
    expect(href("a skirmish against AI")).toBe("/play/skirmish");
    expect(href("a campaign")).toBe("/campaign");
    expect(href("a Conquest")).toBe("/conquest");
    expect(href("a Warpath run")).toBe("/warpath");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("does not offer a start point the profile hides", () => {
    hoisted.hide = ["conquest.list", "runlite.list"];
    show({ career: EMPTY, sources: allReady });
    expect(screen.queryByRole("link", { name: "a Conquest" })).toBeNull();
    expect(screen.queryByRole("link", { name: "a Warpath run" })).toBeNull();
  });

  it("does not call the page empty while a source is still loading", () => {
    show({
      career: EMPTY,
      sources: { ...allReady, ai: { state: "loading" } },
    });
    expect(screen.queryByText(/Nothing to show yet/)).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/replay records/);
  });

  it("does not call the page empty when a source failed", () => {
    show({
      career: EMPTY,
      sources: { ...allReady, ai: { state: "error", message: "disk full" } },
    });
    expect(screen.queryByText(/Nothing to show yet/)).toBeNull();
  });

  it("renders every section for a game with progress in all four", () => {
    show({ career: FULL, sources: allReady });
    const card = screen.getByRole("region", { name: /Balanced Annihilation/ });
    expect(within(card).getByText("Campaigns")).toBeTruthy();
    expect(within(card).getByText("Conquest")).toBeTruthy();
    expect(within(card).getByText("Against AI")).toBeTruthy();
    expect(card.textContent).toContain("1 of 4 missions");
    expect(card.textContent).toContain("2 won of 3 finished");
    expect(card.textContent).toContain("highest threat level unlocked: 2 of 3");
    expect(card.textContent).toContain("14 games · 1W · 1L · 12 undecided");
    const warpath = screen.getByRole("region", { name: /Warpath/ });
    expect(warpath.textContent).toContain("2 runs · 1 win");
    expect(warpath.textContent).toContain("ascension tier 1 of 5");
  });

  it("links each section to the screen that owns it", () => {
    show({ career: FULL, sources: allReady });
    expect(href("Ridge")).toBe("/campaign/c%201");
    expect(href("Open Conquest")).toBe("/conquest");
    expect(href("Open Warpath")).toBe("/warpath");
    expect(href("Open Player stats")).toBe("/stats");
  });

  it("shows only the sections a game has progress in", () => {
    const game = { ...FULL.games[0], campaigns: [], ai: null };
    show({
      career: { ...FULL, games: [game], warpath: null },
      sources: allReady,
    });
    expect(screen.queryByText("Campaigns")).toBeNull();
    expect(screen.queryByText("Against AI")).toBeNull();
    expect(screen.getByText("Conquest")).toBeTruthy();
  });

  it("renders the rest of the page when one source failed, and names the failure", () => {
    show({
      career: { ...FULL, games: [{ ...FULL.games[0], ai: null }] },
      sources: {
        ...allReady,
        ai: { state: "error", message: "database is locked" },
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Replay records could not be read");
    expect(alert.textContent).toContain("database is locked");
    expect(screen.getByText("Campaigns")).toBeTruthy();
    expect(screen.getByText("Conquest")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Warpath/ })).toBeTruthy();
  });

  it("says when the installed games could not be read, without calling any not installed", () => {
    const game = { ...FULL.games[0], installed: null };
    show({
      career: { ...FULL, games: [game] },
      sources: {
        ...allReady,
        games: { state: "error", message: "unitsync Init failed" },
      },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "matched by name only",
    );
    expect(screen.queryByText("Not installed")).toBeNull();
  });

  it("marks a game with no matching installed game when the scan answered", () => {
    show({
      career: { ...FULL, games: [{ ...FULL.games[0], installed: false }] },
      sources: allReady,
    });
    expect(screen.getByText("Not installed")).toBeTruthy();
  });

  it("leaves out Conquest and Warpath where the profile hides them", () => {
    hoisted.hide = ["conquest.list", "runlite.list", "multiplayer.stats"];
    show({ career: FULL, sources: allReady });
    expect(screen.queryByText("Conquest")).toBeNull();
    expect(screen.queryByRole("region", { name: /Warpath/ })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Open Player stats" }),
    ).toBeNull();
    expect(screen.getByText("Against AI")).toBeTruthy();
  });

  describe("game icons", () => {
    const icon = (card: HTMLElement) =>
      within(card).getByTestId("game-icon") as HTMLElement;

    it("draws the game's art in its card header with empty alt text", () => {
      hoisted.headers = new Map([
        ["Balanced Annihilation V15.9.8", "coilbox://header/ba.jpg"],
      ]);
      show({ career: FULL, sources: allReady });
      const card = screen.getByRole("region", {
        name: "Balanced Annihilation",
      });
      expect(icon(card).dataset.state).toBe("image");
      const img = icon(card).querySelector("img");
      expect(img?.getAttribute("src")).toBe("coilbox://header/ba.jpg");
      expect(img?.getAttribute("alt")).toBe("");
      expect(icon(card).style.width).toBe("32px");
      expect(icon(card).style.height).toBe("32px");
    });

    it("draws a placeholder of the same size for a game with no art", () => {
      show({ career: FULL, sources: allReady });
      const card = screen.getByRole("region", {
        name: "Balanced Annihilation",
      });
      expect(icon(card).dataset.state).toBe("placeholder");
      expect(icon(card).querySelector("img")).toBeNull();
      expect(icon(card).style.width).toBe("32px");
    });

    it("falls back to the placeholder and keeps the page when the picture fails", () => {
      hoisted.headers = new Map([
        ["Balanced Annihilation V15.9.8", "coilbox://header/missing.jpg"],
      ]);
      show({ career: FULL, sources: allReady });
      const card = screen.getByRole("region", {
        name: "Balanced Annihilation",
      });
      const img = icon(card).querySelector("img");
      expect(img).not.toBeNull();
      if (img) fireEvent.error(img);
      expect(icon(card).dataset.state).toBe("placeholder");
      expect(card.textContent).toContain("2 won of 3 finished");
      expect(screen.getByRole("region", { name: /Warpath/ })).toBeTruthy();
    });

    it("keeps a logo too wide to fit a square and clips it to the square", () => {
      hoisted.image = "coilbox://logo/wordmark.webp";
      hoisted.headers = new Map([
        ["Balanced Annihilation V15.9.8", "coilbox://header/ba.jpg"],
      ]);
      show({ career: FULL, sources: allReady });
      const card = screen.getByRole("region", {
        name: "Balanced Annihilation",
      });
      const img = icon(card).querySelector("img") as HTMLImageElement;
      expect(img.getAttribute("src")).toBe("coilbox://logo/wordmark.webp");
      expect(img.className).toContain("object-contain");
      Object.defineProperty(img, "naturalWidth", { value: 500 });
      Object.defineProperty(img, "naturalHeight", { value: 92 });
      fireEvent.load(img);
      const after = icon(card).querySelector("img") as HTMLImageElement;
      expect(after.getAttribute("src")).toBe("coilbox://logo/wordmark.webp");
      expect(after.className).toContain("object-cover");
      expect(after.className).not.toContain("object-contain");
    });

    it("fits a near-square logo inside the square", () => {
      hoisted.image = "coilbox://logo/square.webp";
      show({ career: FULL, sources: allReady });
      const card = screen.getByRole("region", {
        name: "Balanced Annihilation",
      });
      const img = icon(card).querySelector("img") as HTMLImageElement;
      Object.defineProperty(img, "naturalWidth", { value: 120 });
      Object.defineProperty(img, "naturalHeight", { value: 100 });
      fireEvent.load(img);
      const after = icon(card).querySelector("img") as HTMLImageElement;
      expect(after.className).toContain("object-contain");
    });

    it("puts no icon on the all-games Warpath card", () => {
      show({ career: FULL, sources: allReady });
      const warpath = screen.getByRole("region", { name: /Warpath/ });
      expect(within(warpath).queryByTestId("game-icon")).toBeNull();
    });
  });

  describe("overview", () => {
    const result = (
      id: string,
      earned: boolean,
      earnedAtMs?: number,
    ): AchievementResult => ({
      id,
      name: `Name ${id}`,
      description: `Do ${id}`,
      category: "Milestones",
      target: 10,
      current: earned ? 10 : 2,
      earned,
      earnedAtMs,
    });
    const some = [
      result("a", true, 100),
      result("b", true, 200),
      result("c", false),
      result("d", false),
    ];

    it("shows the totals across games above the game cards", () => {
      show({ career: FULL, sources: allReady });
      const overview = screen.getByRole("region", { name: "Overview" });
      expect(overview.textContent).toContain("14 games");
      expect(overview.textContent).toContain("1 won");
      expect(overview.textContent).toContain("2");
      expect(overview.textContent).toContain("of 3 finished");
      expect(overview.textContent).toContain("2 runs");
      expect(overview.textContent).toContain("1 win");
      expect(overview.textContent).toContain("of 1 started");
      const order = screen
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent);
      expect(order[0]).toBe("Overview");
      expect(order[1]).toContain("Balanced Annihilation");
    });

    it("lists earned achievements, newest first, and counts the rest", () => {
      show({ career: FULL, sources: allReady, achievements: some });
      const box = screen.getByRole("region", { name: /Achievements/ });
      expect(box.textContent).toContain("2 of 4 earned");
      const names = within(box)
        .getAllByRole("listitem")
        .map((li) => li.textContent);
      expect(names).toHaveLength(2);
      expect(names[0]).toContain("Name b");
      expect(names[1]).toContain("Name a");
      expect(box.textContent).not.toContain("Name c");
      expect(within(box).queryAllByLabelText("Not yet earned")).toHaveLength(0);
      expect(box.textContent).toContain("2 not yet earned");
      expect(within(box).getByRole("link").getAttribute("href")).toBe("/stats");
    });

    it("says so when none are earned, without a list", () => {
      show({
        career: FULL,
        sources: allReady,
        achievements: [result("c", false), result("d", false)],
      });
      const box = screen.getByRole("region", { name: /Achievements/ });
      expect(box.textContent).toContain("None earned yet. 2 to go.");
      expect(within(box).queryAllByRole("listitem")).toHaveLength(0);
    });

    it("says in one line that there are no replay records", () => {
      show({ career: FULL, sources: allReady });
      const box = screen.getByRole("region", { name: /Achievements/ });
      expect(box.textContent).toContain("No replay records yet");
      expect(within(box).queryAllByRole("listitem")).toHaveLength(0);
    });

    it("says it is reading while replay records load, and keeps the rest", () => {
      show({
        career: FULL,
        sources: { ...allReady, ai: { state: "loading" } },
      });
      const box = screen.getByRole("region", { name: /Achievements/ });
      expect(box.textContent).toContain("Reading replay records");
      expect(screen.getByText("Campaigns")).toBeTruthy();
    });

    it("leaves the achievements out when replay records fail, and keeps the rest", () => {
      show({
        career: { ...FULL, games: [{ ...FULL.games[0], ai: null }] },
        sources: { ...allReady, ai: { state: "error", message: "locked" } },
      });
      expect(screen.queryByRole("region", { name: /Achievements/ })).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain(
        "achievements are not shown",
      );
      expect(screen.getByRole("region", { name: "Overview" })).toBeTruthy();
      expect(screen.getByText("Campaigns")).toBeTruthy();
    });

    it("links your player stats to your dossier when the player is known", () => {
      show({ career: FULL, sources: allReady, player: "Tom & Co" });
      expect(href("Your player stats")).toBe("/stats/Tom%20%26%20Co");
    });

    it("links your player stats to the stats page when the player is not known", () => {
      show({ career: FULL, sources: allReady });
      expect(href("Your player stats")).toBe("/stats");
    });

    it("hides both stats links under a profile that hides Player stats, and still shows achievements", () => {
      hoisted.hide = ["multiplayer.stats"];
      show({
        career: FULL,
        sources: allReady,
        player: "me",
        achievements: some,
      });
      expect(
        screen.queryByRole("link", { name: "Your player stats" }),
      ).toBeNull();
      expect(
        screen.queryByRole("link", { name: /See them all on Player stats/ }),
      ).toBeNull();
      expect(screen.getByText("Name a")).toBeTruthy();
    });

    it("leaves Conquest and Warpath totals out where the profile hides them", () => {
      hoisted.hide = ["conquest.list", "runlite.list"];
      show({ career: FULL, sources: allReady });
      const overview = screen.getByRole("region", { name: "Overview" });
      expect(overview.textContent).not.toContain("Conquests won");
      expect(overview.textContent).not.toContain("Warpath");
    });

    it("shows achievements even when no game card is left to show", () => {
      show({
        career: EMPTY,
        sources: allReady,
        player: "me",
        achievements: some,
      });
      expect(screen.queryByText(/Nothing to show yet/)).toBeNull();
      expect(screen.getByText("Name a")).toBeTruthy();
    });
  });
});
