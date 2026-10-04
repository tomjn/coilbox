// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Career } from "../career";
import type { CareerData, SourceId, SourceStatus } from "../useCareer";

const hoisted = vi.hoisted(() => ({
  data: null as unknown,
  hide: [] as string[],
}));

// The page reads the stores through this hook, which needs the app frame.
vi.mock("../useCareer", () => ({ useCareer: () => hoisted.data }));
vi.mock("../../profile/profile", () => ({
  getProfile: () => ({ hide: hoisted.hide }),
}));

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

function show(data: CareerData) {
  hoisted.data = data;
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
});
