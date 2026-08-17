import { describe, expect, it } from "vitest";
import type { AssetPicture } from "./pictures";
import { PLAN_VARIANT, planPicture, unitPictureIdentity } from "./unitPictures";

const CDN = "https://tomjn.github.io/coilbox-assets/";

function held(fields: Partial<AssetPicture>): AssetPicture {
  return {
    tier: "static",
    path: "u/bar/armlab/render-top.webp",
    url: "https://hub.example/whatever.webp",
    width: 250,
    height: 200,
    served_variant: PLAN_VARIANT,
    substituted: false,
    ...fields,
  };
}

describe("unitPictureIdentity", () => {
  it("asks for the view from above, keyed the way the backfill uploads it", () => {
    expect(unitPictureIdentity("BAR", "ARMLAB")).toEqual({
      keyed_on: "unit",
      game: "BAR",
      // Lower cased, because the dataset the keys were minted from is, and a
      // layout carries whatever its author's game wrote.
      unit_name: "armlab",
      variant: "render:top",
    });
  });
});

describe("planPicture", () => {
  it("joins the path to the tier this session reads from", () => {
    expect(planPicture(held({}), CDN)?.url).toBe(
      `${CDN}u/bar/armlab/render-top.webp`,
    );
  });

  it("reads a render as framed, so it is drawn with its bleed", () => {
    expect(planPicture(held({}), CDN)?.framed).toBe(true);
  });

  it("reads a build pic served in place of a render as not framed", () => {
    const substitute = held({ served_variant: "buildpic", substituted: true });
    expect(planPicture(substitute, CDN)?.framed).toBe(false);
  });

  it("has no picture for a unit the hub holds nothing for", () => {
    expect(planPicture(null, CDN)).toBeNull();
  });
});
