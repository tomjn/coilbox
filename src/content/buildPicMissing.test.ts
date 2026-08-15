import { describe, expect, it } from "vitest";
import { buildPicMissing } from "./buildPicMissing";

describe("buildPicMissing", () => {
  it("keeps a picture coilbox cannot read apart from one the game never shipped", () => {
    const unreadable = buildPicMissing({ iconSkipped: "undecodable" });
    const none = buildPicMissing({ iconSkipped: "no-source" });
    expect(unreadable.label).not.toBe(none.label);
    expect(unreadable.title).toMatch(/cannot read/i);
    expect(none.title).toMatch(/ships no build pic/i);
  });

  it("treats a picture the encoder refused as unreadable too", () => {
    expect(buildPicMissing({ iconSkipped: "encode-failed" }).label).toBe(
      buildPicMissing({ iconSkipped: "undecodable" }).label,
    );
  });

  it("claims nothing about a unit whose build pics have not arrived", () => {
    expect(buildPicMissing()).toEqual({ label: "no pic" });
    expect(buildPicMissing({ name: "Construction Sub" })).toEqual({
      label: "no pic",
    });
  });
});
