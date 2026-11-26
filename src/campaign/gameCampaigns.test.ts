import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "../content/bindings";

const campaignsMock = vi.fn();
const fileMock = vi.fn();

// The plugin-sdk import in the real bindings does not load under Vitest's node
// resolver, so the two archive commands are stubbed.
vi.mock("../scenario/bindings", () => ({
  scenarioGameCampaigns: (...args: unknown[]) => campaignsMock(...args),
  scenarioGameCampaignFile: (...args: unknown[]) => fileMock(...args),
}));

import {
  gameCampaignFileDataUri,
  gameCampaignJson,
  gameCampaignOrigin,
  gameCampaigns,
} from "./gameCampaigns";

/** Base64 of a UTF-8 string, as the plugin hands a file back. */
function b64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** A campaign document with one playable mission. */
function campaignJson(id: string, title = id): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    type: "ta",
    title,
    missions: [
      {
        id: `${id}-1`,
        title: "Landing",
        briefing: "",
        snapshot: { gameName: "Test Game 1.0", mapName: "Comet" },
        panorama: { kind: "file", file: "landing.png" },
      },
    ],
    updatedAt: "2026-11-01T00:00:00.000Z",
  });
}

/** A game the content scan returned, packaged unless the path ends `.sdd`. */
function game(name: string, path: string): GameItem {
  return {
    name,
    primaryArchive: { name: path.split("/").pop(), path },
  } as unknown as GameItem;
}

/** Serve `files` keyed `root folder file` out of the stubbed archive. */
function archive(
  campaigns: Record<string, string[]>,
  files: Record<string, string>,
) {
  campaignsMock.mockImplementation(async ({ root }: { root: string }) => ({
    campaigns: campaigns[root] ?? [],
    stamp: root.endsWith(".sdd") ? null : "1:1",
  }));
  fileMock.mockImplementation(
    async (a: { root: string; folder: string; file: string }) => {
      const body = files[`${a.root} ${a.folder} ${a.file}`];
      if (body === undefined) throw new Error("not in the game");
      return { base64: b64(body) };
    },
  );
}

beforeEach(() => {
  campaignsMock.mockReset();
  fileMock.mockReset();
});

describe("a game's own campaigns", () => {
  it("lists every campaign folder a game ships, read-only and with where it came from", async () => {
    archive(
      { "/games/tg.sd7": ["act-one", "act-two"] },
      {
        "/games/tg.sd7 act-one campaign.json": campaignJson("act-one"),
        "/games/tg.sd7 act-two campaign.json": campaignJson("act-two"),
      },
    );

    const found = await gameCampaigns([game("Test Game", "/games/tg.sd7")]);

    expect(found.map((l) => [l.campaign.id, l.source])).toEqual([
      ["act-one", "game"],
      ["act-two", "game"],
    ]);
    expect(gameCampaignOrigin("act-two")).toEqual({
      gameName: "Test Game",
      archivePath: "/games/tg.sd7",
      folder: "act-two",
      loose: false,
    });
    expect(gameCampaignJson("act-one")).toBe(campaignJson("act-one"));
  });

  it("keeps the missions in the order the game wrote them", async () => {
    const doc = JSON.parse(campaignJson("ordered"));
    doc.missions = ["third", "first", "second"].map((id) => ({
      ...doc.missions[0],
      id,
      title: id,
    }));
    archive(
      { "/games/order.sdz": ["ordered"] },
      { "/games/order.sdz ordered campaign.json": JSON.stringify(doc) },
    );

    const [loaded] = await gameCampaigns([game("G", "/games/order.sdz")]);

    expect(loaded.campaign.missions.map((m) => m.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("skips a document that will not parse and keeps the rest", async () => {
    archive(
      { "/games/bad.sdz": ["broken", "fine"] },
      {
        "/games/bad.sdz broken campaign.json": "{ not json",
        "/games/bad.sdz fine campaign.json": campaignJson("fine"),
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const found = await gameCampaigns([game("G", "/games/bad.sdz")]);

    expect(found.map((l) => l.campaign.id)).toEqual(["fine"]);
    warn.mockRestore();
  });

  it("skips a game that cannot be read rather than failing the list", async () => {
    archive(
      { "/games/ok.sdz": ["ok"] },
      { "/games/ok.sdz ok campaign.json": campaignJson("ok") },
    );
    campaignsMock.mockImplementationOnce(async () => {
      throw new Error("not a game archive");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const found = await gameCampaigns([
      game("Broken", "/games/broken.sdz"),
      game("Fine", "/games/ok.sdz"),
    ]);

    expect(found.map((l) => l.campaign.id)).toEqual(["ok"]);
    warn.mockRestore();
  });

  it("lists a campaign two games both ship once, from the first", async () => {
    archive(
      { "/games/a.sdz": ["shared"], "/games/b.sdz": ["shared"] },
      {
        "/games/a.sdz shared campaign.json": campaignJson("dupe", "From A"),
        "/games/b.sdz shared campaign.json": campaignJson("dupe", "From B"),
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const found = await gameCampaigns([
      game("A", "/games/a.sdz"),
      game("B", "/games/b.sdz"),
    ]);

    expect(found.map((l) => l.campaign.title)).toEqual(["From A"]);
    warn.mockRestore();
  });

  it("reads a packaged game once per scan and a loose one every time", async () => {
    archive(
      { "/games/p.sd7": ["p"], "/games/l.sdd": ["l"] },
      {
        "/games/p.sd7 p campaign.json": campaignJson("p"),
        "/games/l.sdd l campaign.json": campaignJson("l"),
      },
    );
    const games = [game("P", "/games/p.sd7"), game("L", "/games/l.sdd")];

    await gameCampaigns(games);
    await gameCampaigns(games);

    const roots = campaignsMock.mock.calls.map((c) => c[0].root);
    expect(roots.filter((r) => r === "/games/p.sd7")).toHaveLength(1);
    expect(roots.filter((r) => r === "/games/l.sdd")).toHaveLength(2);
    expect(gameCampaignOrigin("l")?.loose).toBe(true);
  });

  it("reads a media file out of the campaign's own folder in the game", async () => {
    archive(
      { "/games/m.sdz": ["m"] },
      {
        "/games/m.sdz m campaign.json": campaignJson("m"),
        "/games/m.sdz m landing.png": "png",
      },
    );
    await gameCampaigns([game("M", "/games/m.sdz")]);
    const origin = gameCampaignOrigin("m");
    if (!origin) throw new Error("the campaign was not listed");

    const uri = await gameCampaignFileDataUri(origin, "landing.png");

    expect(uri).toBe(`data:image/png;base64,${b64("png")}`);
    expect(fileMock).toHaveBeenLastCalledWith({
      root: "/games/m.sdz",
      folder: "m",
      file: "landing.png",
    });
  });
});
