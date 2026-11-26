// @vitest-environment happy-dom

/**
 * Where a briefing's inline media comes from (issue #5468).
 *
 * A bundled campaign names its files relative to the portable `.coilbox/`
 * folder. A campaign shipped inside a game keeps them beside `campaign.json` in
 * the archive, so the same Markdown has to be read out of the game instead.
 * Only the plugin command is stubbed, so each case runs the real Markdown render
 * and the real archive read path.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { scenarioGameCampaignFile } = vi.hoisted(() => ({
  scenarioGameCampaignFile: vi.fn(
    async (_args: { root: string; folder: string; file: string }) => ({
      base64: btoa("bytes"),
    }),
  ),
}));
vi.mock("../../../scenario/bindings", () => ({
  scenarioGameCampaigns: vi.fn(),
  scenarioGameCampaignFile,
}));

import type { CampaignGameOrigin } from "../../gameCampaigns";
import { BriefingProse } from "./Briefing";

/** A game of its own per case, since a read file is held for the session. */
let games = 0;
function origin(): CampaignGameOrigin {
  games += 1;
  return {
    gameName: "Test Game",
    archivePath: `/games/briefing-${games}.sdz`,
    folder: "act-one",
    loose: false,
  };
}

function briefing(markdown: string, gameOrigin?: CampaignGameOrigin) {
  return render(
    <BriefingProse gameOrigin={gameOrigin}>{markdown}</BriefingProse>,
  );
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  scenarioGameCampaignFile.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("inline media in a bundled campaign's briefing", () => {
  it("resolves against the .coilbox folder without reading a game", () => {
    briefing("![the map](images/map.jpg)");

    expect(screen.getByAltText("the map").getAttribute("src")).toMatch(
      /\/portable\/images\/map\.jpg$/,
    );
    expect(scenarioGameCampaignFile).not.toHaveBeenCalled();
  });

  it("encodes the name the author wrote once (issue #5483)", () => {
    briefing("![the map](<images/my art é.jpg>)");

    expect(screen.getByAltText("the map").getAttribute("src")).toBe(
      "coilbox://localhost/portable/images/my%20art%20%C3%A9.jpg",
    );
  });
});

describe("inline media in a game campaign's briefing", () => {
  it("reads an image out of the campaign's folder in the game", async () => {
    const from = origin();
    briefing("![the map](map.jpg)", from);

    // The read is async, so something says the picture is on its way.
    expect(screen.getByRole("status").textContent).toContain("map.jpg");
    const img = await screen.findByAltText("the map");
    expect(img.getAttribute("src")).toMatch(/^blob:/);
    expect(screen.queryByRole("status")).toBeNull();
    expect(scenarioGameCampaignFile).toHaveBeenCalledWith({
      root: from.archivePath,
      folder: "act-one",
      file: "map.jpg",
    });
  });

  it("asks the game for the name the author wrote, spaces and all", async () => {
    briefing("![the map](<./the map é.jpg>)", origin());

    await screen.findByAltText("the map");
    expect(scenarioGameCampaignFile.mock.calls[0][0].file).toBe(
      "the map é.jpg",
    );
  });

  it("plays audio and video, told apart by the file name", async () => {
    const { container } = briefing(
      "![](voice.ogg)\n\n![](intro.mp4)",
      origin(),
    );

    await waitFor(() => {
      expect(container.querySelector("audio")?.getAttribute("src")).toMatch(
        /^blob:/,
      );
      expect(container.querySelector("video")?.getAttribute("src")).toMatch(
        /^blob:/,
      );
    });
    expect(container.querySelector("img")).toBeNull();
  });

  it("names a file the game cannot give back instead of a broken image", async () => {
    scenarioGameCampaignFile.mockRejectedValueOnce(new Error("not there"));
    const { container } = briefing("![the map](gone.jpg)", origin());

    await screen.findByText(/Could not load gone\.jpg/);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses a web address as it is written", () => {
    briefing("![far](https://example.org/far.jpg)", origin());

    expect(screen.getByAltText("far").getAttribute("src")).toBe(
      "https://example.org/far.jpg",
    );
    expect(scenarioGameCampaignFile).not.toHaveBeenCalled();
  });
});
