// @vitest-environment happy-dom

/**
 * The files a briefing names, when a game's campaign leaves its game (issue
 * #5484). Only the plugin commands are stubbed, so each case runs the real
 * listing, duplicate, export, import and Markdown render.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { gameFiles, scenarioGameCampaigns, scenarioGameCampaignFile } =
  vi.hoisted(() => {
    const gameFiles = new Map<string, string>();
    return {
      gameFiles,
      scenarioGameCampaigns: vi.fn(async () => ({ campaigns: ["act-one"] })),
      scenarioGameCampaignFile: vi.fn(
        async ({ file }: { root: string; folder: string; file: string }) => {
          const body = gameFiles.get(file);
          if (body === undefined) throw new Error("not there");
          return { base64: btoa(body) };
        },
      ),
    };
  });
vi.mock("../scenario/bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../scenario/bindings")),
  scenarioGameCampaigns,
  scenarioGameCampaignFile,
}));

const { campaignMediaImportData, campaignList } = vi.hoisted(() => ({
  campaignMediaImportData: vi.fn(
    async (args: { campaignId: string; dataUri: string; ext: string }) => ({
      file: `stored-${atob(args.dataUri.split(",")[1])}.${args.ext}`,
    }),
  ),
  campaignList: vi.fn(async () => ({ items: [] })),
}));
vi.mock("./bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("./bindings")),
  campaignMediaImportData,
  campaignList,
}));

// A stored file is read back over the `coilbox://` protocol, and a game's clip
// over a `blob:` URL.
const { fetchAsDataUrl } = vi.hoisted(() => ({
  fetchAsDataUrl: vi.fn(
    async (_url: string) =>
      `data:image/png;base64,${btoa("copy")}` as string | undefined,
  ),
}));
vi.mock("../lib/dataUrl", () => ({ fetchAsDataUrl }));

import type { GameItem } from "../content/bindings";
import { duplicateCampaign } from "./duplicate";
import { gameCampaigns } from "./gameCampaigns";
import { inlineCampaignForExport, materializeCampaignImages } from "./images";
import { campaignMediaFiles } from "./media";
import { type Campaign, parseCampaignJson } from "./model";
import { BriefingProse } from "./pages/components/Briefing";
import { parseCampaignExport, wrapCampaignForExport } from "./transfer";

const BRIEFING = [
  "![the beach](landing.png)",
  "![](<./the voice.ogg>)",
  "![far](https://example.org/far.jpg)",
  "![the ridge][ridge]",
  "",
  "[ridge]: ridge.jpg",
].join("\n");

/** A game of its own per case, since a read campaign is held for the session. */
let games = 0;
async function gameCampaign(briefing = BRIEFING): Promise<Campaign> {
  games += 1;
  gameFiles.set(
    "campaign.json",
    JSON.stringify({
      schemaVersion: 1,
      id: `shipped-${games}`,
      type: "ta",
      title: "Act one",
      description: "",
      missions: [
        {
          id: "m1",
          title: "Landing",
          briefing,
          snapshot: { gameName: "Test Game", mapName: "Test Map" },
        },
      ],
    }),
  );
  const [found] = await gameCampaigns([
    {
      name: `Test Game ${games}`,
      primaryArchive: { path: `/games/files-${games}.sdz`, name: "g.sdz" },
    } as GameItem,
  ]);
  return found.campaign;
}

/** What a stored copy reads back as. */
const reread = (campaign: Campaign) =>
  parseCampaignJson(JSON.stringify(campaign)) as Campaign;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.clearAllMocks();
  gameFiles.clear();
  gameFiles.set("landing.png", "landing");
  gameFiles.set("ridge.jpg", "ridge");
  gameFiles.set("the voice.ogg", "voice");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("duplicating a game's campaign", () => {
  it("stores the files its briefings name under the copy", async () => {
    const { campaign, droppedMedia } = await duplicateCampaign(
      await gameCampaign(),
      "Copy",
    );
    const copy = reread(campaign);

    expect(droppedMedia).toBe(0);
    expect(copy.missions[0].briefing).toBe(BRIEFING);
    expect(copy.briefingFiles).toEqual({
      "landing.png": { kind: "file", file: "stored-landing.png" },
      "ridge.jpg": { kind: "file", file: "stored-ridge.jpg" },
      "the voice.ogg": { kind: "file", file: "stored-copy.ogg" },
    });
    for (const [args] of campaignMediaImportData.mock.calls) {
      expect(args.campaignId).toBe(copy.id);
    }
    expect(campaignMediaFiles(copy)).toContain("stored-landing.png");
  });

  it("shows them in the copy's briefing", async () => {
    const { campaign } = await duplicateCampaign(await gameCampaign(), "Copy");
    const copy = reread(campaign);

    const { container } = render(
      <BriefingProse campaignId={copy.id} files={copy.briefingFiles}>
        {copy.missions[0].briefing}
      </BriefingProse>,
    );

    expect(screen.getByAltText("the beach").getAttribute("src")).toBe(
      `coilbox://localhost/campaign/${copy.id}/stored-landing.png`,
    );
    expect(screen.getByAltText("the ridge").getAttribute("src")).toBe(
      `coilbox://localhost/campaign/${copy.id}/stored-ridge.jpg`,
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toBe(
      `coilbox://localhost/campaign/${copy.id}/stored-copy.ogg`,
    );
  });

  it("counts a file the game cannot give back", async () => {
    gameFiles.delete("landing.png");
    gameFiles.delete("the voice.ogg");

    const { campaign, droppedMedia } = await duplicateCampaign(
      await gameCampaign(),
      "Copy",
    );

    expect(droppedMedia).toBe(2);
    expect(Object.keys(campaign.briefingFiles ?? {})).toEqual(["ridge.jpg"]);
  });

  it("copies a copy's files again, so deleting the first costs nothing", async () => {
    const { campaign: first } = await duplicateCampaign(
      await gameCampaign("![](landing.png)"),
      "Copy",
    );
    campaignMediaImportData.mockClear();

    const { campaign: second, droppedMedia } = await duplicateCampaign(
      reread(first),
      "Copy of the copy",
    );

    expect(droppedMedia).toBe(0);
    expect(fetchAsDataUrl).toHaveBeenCalledWith(
      `coilbox://localhost/campaign/${first.id}/stored-landing.png`,
    );
    expect(campaignMediaImportData.mock.calls[0][0].campaignId).toBe(second.id);
    expect(second.briefingFiles).toEqual({
      "landing.png": { kind: "file", file: "stored-copy.png" },
    });
  });
});

describe("exporting a game's campaign", () => {
  it("carries the pictures and names what it leaves out", async () => {
    const { campaign, leftOut } = await inlineCampaignForExport(
      await gameCampaign(),
    );
    const parsed = parseCampaignExport(
      JSON.stringify(wrapCampaignForExport(campaign)),
    );

    expect(leftOut).toEqual(["the voice.ogg"]);
    expect(parsed?.campaign.briefingFiles).toEqual({
      "landing.png": {
        kind: "data",
        dataUri: `data:image/png;base64,${btoa("landing")}`,
      },
      "ridge.jpg": {
        kind: "data",
        dataUri: `data:image/jpeg;base64,${btoa("ridge")}`,
      },
    });

    const imported = await materializeCampaignImages(
      parsed?.campaign as Campaign,
      "imported",
    );
    expect(imported.briefingFiles).toEqual({
      "landing.png": { kind: "file", file: "stored-landing.png" },
      "ridge.jpg": { kind: "file", file: "stored-ridge.jpg" },
    });
  });

  it("names a picture the game cannot give back", async () => {
    gameFiles.delete("ridge.jpg");

    const { leftOut } = await inlineCampaignForExport(await gameCampaign());

    expect(leftOut).toEqual(["ridge.jpg", "the voice.ogg"]);
  });

  it("shows a carried picture before it is stored", () => {
    render(
      <BriefingProse
        campaignId="shipped"
        files={{ "a.png": { kind: "data", dataUri: "data:image/png,abc" } }}
      >
        {"![a](a.png)"}
      </BriefingProse>,
    );

    expect(screen.getByAltText("a").getAttribute("src")).toBe(
      "data:image/png,abc",
    );
  });
});
