// @vitest-environment happy-dom

/**
 * The start card a distribution's profile names (issue #3378), as the continue
 * zone draws it.
 *
 * `continue.test.ts` covers when the card exists and what its words are. This
 * file renders the zone for real, because the two things the card adds are both
 * hooks: the campaign's own picture, and whether the mission's game and map are
 * installed. `continueZone.test.ts` calls the zone as a function and so never
 * runs either.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign } from "../campaign/model";
import type { ResumeCandidate } from "./continue";

// Same stubs `continueZone.test.ts` uses, for the same reasons.
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
  buttonVariants: () => "button",
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("../multiplayer/ringEffect", () => ({ triggerRing: () => {} }));
vi.mock("../multiplayer/ingameCue", () => ({ triggerIngameCue: () => {} }));
vi.mock("../multiplayer/chat/mentionCue", () => ({
  triggerMentionCue: () => {},
}));

const resume =
  vi.fn<() => { candidates: ResumeCandidate[]; loading: boolean }>();
vi.mock("./continue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./continue")>()),
  useResume: () => resume(),
}));

// The install, as the engine scan would report it.
const target = vi.fn<() => { enginePath: string; dataDir: string } | null>();
vi.mock("../play/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../play/config")>()),
  usePreferredTarget: () => ({ target: target(), loading: false }),
}));
const scan =
  vi.fn<() => { games: { name: string }[]; maps: { name: string }[] } | null>();
vi.mock("../content/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../content/config")>()),
  useUnitsyncScan: () => ({ data: scan() }),
}));

// The campaign's picture, already resolved. The real hook reads it off disk.
const image = vi.fn<(id: string, ref?: unknown) => string | undefined>();
vi.mock("../campaign/panorama", () => ({
  useCampaignImage: (id: string, ref?: unknown) => image(id, ref),
}));

import Continue from "./zones/Continue";

const ICON = { kind: "local", path: "images/emblem.png" } as const;

const CAMPAIGN = {
  id: "c1",
  title: "Basic Training",
  icon: ICON,
  missions: [],
} as unknown as Campaign;

const MISSION = {
  id: "m1",
  title: "Landfall",
  snapshot: { gameName: "Ironhold 1.2", mapName: "Red Comet" },
} as unknown as Campaign["missions"][number];

function startCard(campaign: Campaign = CAMPAIGN): ResumeCandidate {
  return {
    id: "start:c1:m1",
    kind: "start",
    title: campaign.title,
    detail: MISSION.title,
    to: "/campaign/c1/m1",
    touchedAt: 0,
    start: { campaign, mission: MISSION },
  };
}

function renderZone() {
  return render(
    <MemoryRouter>
      <Continue />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resume.mockReturnValue({ candidates: [startCard()], loading: false });
  target.mockReturnValue({ enginePath: "/engine", dataDir: "/data" });
  scan.mockReturnValue({
    games: [{ name: "Ironhold 1.2" }],
    maps: [{ name: "Red Comet" }],
  });
  image.mockReturnValue("coilbox://emblem.png");
});
afterEach(cleanup);

describe("the start card", () => {
  it("offers the mission, with the campaign's name and the mission's", () => {
    renderZone();
    expect(screen.getByRole("heading").textContent).toBe("Start here");
    expect(screen.getByText("Basic Training")).toBeTruthy();
    expect(screen.getByText("Landfall")).toBeTruthy();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/campaign/c1/m1");
    expect(link.getAttribute("aria-label")).toBe(
      "Start mission: Basic Training",
    );
  });

  it("draws the campaign's own emblem", () => {
    const { container } = renderZone();
    expect(image).toHaveBeenCalledWith("c1", ICON);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "coilbox://emblem.png",
    );
  });

  it("falls back to the campaign's background when it has no emblem", () => {
    const background = { kind: "local", path: "images/bg.jpg" } as const;
    const campaign = { ...CAMPAIGN, icon: undefined, background } as Campaign;
    resume.mockReturnValue({
      candidates: [startCard(campaign)],
      loading: false,
    });
    renderZone();
    expect(image).toHaveBeenCalledWith("c1", background);
  });

  it("draws the icon when the campaign has no picture, or only a video", () => {
    image.mockReturnValue(undefined);
    expect(renderZone().container.querySelector("img")).toBeNull();
    cleanup();
    image.mockReturnValue("coilbox://intro.mp4");
    expect(renderZone().container.querySelector("img")).toBeNull();
  });

  it("offers the download first when the map is not installed", () => {
    scan.mockReturnValue({ games: [{ name: "Ironhold 1.2" }], maps: [] });
    renderZone();
    expect(screen.getByText("Download Red Comet first")).toBeTruthy();
    const link = screen.getByRole("link");
    // The briefing page holds the mission back and does the downloading.
    expect(link.getAttribute("href")).toBe("/campaign/c1/m1");
    expect(link.getAttribute("aria-label")).toBe(
      "Download and start: Basic Training",
    );
  });

  it("names the game and the map when neither is installed", () => {
    scan.mockReturnValue({ games: [], maps: [] });
    renderZone();
    expect(
      screen.getByText("Download Ironhold 1.2 and Red Comet first"),
    ).toBeTruthy();
  });

  it("asks for the engine when there is none to read the install with", () => {
    target.mockReturnValue(null);
    scan.mockReturnValue(null);
    renderZone();
    expect(screen.getByText("Download the engine first")).toBeTruthy();
  });

  it("says nothing about downloads before the scan has answered", () => {
    scan.mockReturnValue(null);
    renderZone();
    expect(screen.getByText("Landfall")).toBeTruthy();
  });
});
