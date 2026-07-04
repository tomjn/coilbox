import { describe, expect, it } from "vitest";
import type { Campaign } from "./model";
import {
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  parseCampaignExport,
  wrapCampaignForExport,
} from "./transfer";

const campaign: Campaign = {
  schemaVersion: 1,
  id: "abc",
  type: "ta",
  title: "Test",
  description: "",
  missions: [],
  createdAt: "t0",
  updatedAt: "t1",
};

describe("wrapCampaignForExport", () => {
  it("wraps a campaign with the format + version envelope", () => {
    const file = wrapCampaignForExport(campaign);
    expect(file.format).toBe(EXPORT_FORMAT);
    expect(file.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(file.campaign).toBe(campaign);
  });
});

describe("parseCampaignExport", () => {
  it("round-trips a wrapped campaign", () => {
    const json = JSON.stringify(wrapCampaignForExport(campaign));
    const parsed = parseCampaignExport(json);
    expect(parsed?.id).toBe("abc");
    expect(parsed?.title).toBe("Test");
  });

  it("rejects non-JSON", () => {
    expect(parseCampaignExport("not json")).toBeNull();
  });

  it("rejects a wrong format tag", () => {
    const json = JSON.stringify({
      ...wrapCampaignForExport(campaign),
      format: "x",
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a wrong format version", () => {
    const json = JSON.stringify({
      ...wrapCampaignForExport(campaign),
      formatVersion: 2,
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a wrapper whose inner campaign is invalid", () => {
    const json = JSON.stringify({
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      campaign: { type: "ta", id: "x" }, // no missions array
    });
    expect(parseCampaignExport(json)).toBeNull();
  });

  it("rejects a bare campaign that isn't wrapped", () => {
    expect(parseCampaignExport(JSON.stringify(campaign))).toBeNull();
  });
});
