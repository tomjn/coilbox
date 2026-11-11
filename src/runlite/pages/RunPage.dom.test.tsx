// @vitest-environment happy-dom
/**
 * The warpath run page when the run file could not be read. It has to give the
 * reason and say nothing was changed, not "No active warpath", which reads as if
 * the run were gone.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  error: null as string | null,
  run: null as import("../model").RogueliteRun | null,
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useHideSidebar: () => {},
  useDrawer: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
// Records live in the frame's settings store, which this page is rendered without.
vi.mock("../../challenge/useChallengeRecords", () => ({
  useRecordChallengeRun: vi.fn(),
}));
vi.mock("../../challenge/ChallengeRecordLine", () => ({
  ChallengeRecordLine: () => null,
}));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({ data: null, error: null, run: vi.fn() }),
  useUnitsyncUnitDataset: () => ({ dataset: null }),
  useScanEpoch: () => 0,
}));
vi.mock("../../content/mapEligibility", () => ({
  useMapEligibility: () => ({ isExcluded: () => false }),
}));
vi.mock("../../play/config", () => ({
  usePreferredTarget: () => ({
    target: null,
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/gameOffer", async (orig) => ({
  ...(await orig<typeof import("../../play/gameOffer")>()),
  resolveGameDownload: () => null,
}));
vi.mock("../RunMapView", () => ({ RunMapView: () => null }));
vi.mock("./components/RunContentNotice", () => ({
  RunContentNotice: () => null,
}));
vi.mock("../useAwardFinishedRuns", () => ({
  useAwardFinishedRuns: vi.fn(),
}));
vi.mock("../runs", () => ({
  useRun: () => ({
    run: h.run,
    loading: false,
    error: h.error,
    refresh: vi.fn(),
    save: vi.fn(),
  }),
}));

import { generateRun } from "../generate";
import { nextChoices } from "../progress";
import RunPage from "./RunPage";

afterEach(() => {
  cleanup();
  h.error = null;
  h.run = null;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/warpath/r1"]}>
      <RunPage />
    </MemoryRouter>,
  );
}

describe("RunPage with an active run", () => {
  function activeRun() {
    return generateRun({
      seed: 777,
      length: "standard",
      difficulty: 3,
      ascension: 2,
      game: { shortname: "ba" },
      factionId: "player",
      side: "ARM",
      skin: "galaxy",
      maps: [
        { name: "Small", size: 64 },
        { name: "Medium", size: 256 },
      ],
      now: "2026-07-18T00:00:00.000Z",
    });
  }

  it("lists the nodes the player can move to in a Next strip", () => {
    const run = activeRun();
    h.run = run;
    renderPage();
    const strip = screen.getByRole("navigation", { name: "Next" });
    expect(strip.textContent).toContain("Next:");
    const choices = nextChoices(run);
    expect(choices.length).toBeGreaterThan(0);
    expect(strip.querySelectorAll("button").length).toBe(choices.length);
  });

  it("shows difficulty as a stat card with its ascension", () => {
    h.run = activeRun();
    renderPage();
    expect(screen.getByText("Difficulty")).toBeTruthy();
    expect(screen.getByText("Veteran")).toBeTruthy();
    expect(screen.getByText("A2")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Difficulty 3 of 5" })).toBeTruthy();
  });
});

describe("RunPage with no run", () => {
  it("gives the reason and says nothing was changed when the file could not be read", () => {
    h.error = "run.json is not valid JSON";
    renderPage();
    expect(
      screen.getByText(
        "Your warpath runs could not be read. Nothing has been changed. run.json is not valid JSON",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No active warpath/)).toBeNull();
  });

  it("says there is no active warpath when the file read and has no such run", () => {
    renderPage();
    expect(screen.getByText(/No active warpath/)).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});
