import { describe, expect, it } from "vitest";
import {
  type MapPictureSources,
  mapPictureAlt,
  mapPictureLadder,
  shownMapPicture,
} from "./picture";
import { BLOB_TIER_BASE, DEFAULT_ASSET_CDN_BASE } from "./tier";

const MAP = "Supreme Isthmus V2";

function sources(over: Partial<MapPictureSources> = {}): MapPictureSources {
  return { mapName: MAP, cdnBase: DEFAULT_ASSET_CDN_BASE, ...over };
}

const LOCAL = "coilbox://localhost/unitsyncthumb/abc.png";
const BAR = "https://api.bar-rts.com/maps/isthmus/preview.webp";
const HELD_STATIC = {
  tier: "static" as const,
  path: "maps/minimap/deadbeef.webp",
  width: 1024,
  height: 1024,
};
const HELD_BLOB = { ...HELD_STATIC, tier: "blob" as const };

/** Every rung's origin, in order, which is what the ladder is. */
function order(over: Partial<MapPictureSources> = {}): string[] {
  return mapPictureLadder(sources(over)).map((rung) => rung.from);
}

describe("mapPictureLadder order", () => {
  it("puts the installed archive first, ahead of every remote source", () => {
    // The one that matters. An installed map costs no request, works offline
    // and is the map the reader will actually play.
    expect(order({ local: LOCAL, held: HELD_STATIC, bar: BAR })).toEqual([
      "local",
      "static",
      "bar",
      "placeholder",
    ]);
  });

  it("never reaches a remote source when the map is installed", () => {
    const ladder = mapPictureLadder(
      sources({ local: LOCAL, held: HELD_STATIC, bar: BAR }),
    );
    expect(shownMapPicture(ladder, new Set())).toEqual({
      from: "local",
      url: LOCAL,
      width: null,
      height: null,
    });
  });

  it("puts the hub's own picture ahead of BAR's preview", () => {
    expect(order({ held: HELD_STATIC, bar: BAR })).toEqual([
      "static",
      "bar",
      "placeholder",
    ]);
  });

  it("serves a row still in staging from the staging tier", () => {
    expect(order({ held: HELD_BLOB, bar: BAR })).toEqual([
      "blob",
      "bar",
      "placeholder",
    ]);
  });

  it("falls to BAR for a map nothing else has", () => {
    expect(order({ bar: BAR })).toEqual(["bar", "placeholder"]);
  });

  it("always ends in the drawing, whatever it was given", () => {
    for (const over of [
      {},
      { local: LOCAL },
      { held: HELD_STATIC },
      { bar: BAR },
      { local: LOCAL, held: HELD_BLOB, bar: BAR },
    ]) {
      const ladder = mapPictureLadder(sources(over));
      expect(ladder.at(-1)?.from).toBe("placeholder");
    }
  });

  it("is only the drawing when nothing anywhere has a picture", () => {
    expect(
      mapPictureLadder(sources({ size: { width: 12, height: 12 } })),
    ).toEqual([
      { from: "placeholder", name: MAP, size: { width: 12, height: 12 } },
    ]);
  });

  it("draws a map whose size nothing knew rather than refusing", () => {
    expect(mapPictureLadder(sources()).at(-1)).toEqual({
      from: "placeholder",
      name: MAP,
      size: null,
    });
  });
});

describe("mapPictureLadder URLs", () => {
  it("builds the durable tier URL from the configured base", () => {
    expect(mapPictureLadder(sources({ held: HELD_STATIC }))[0]).toEqual({
      from: "static",
      url: `${DEFAULT_ASSET_CDN_BASE}maps/minimap/deadbeef.webp`,
      width: 1024,
      height: 1024,
    });
  });

  it("builds a staging URL from the store rather than the CDN base", () => {
    const rung = mapPictureLadder(
      sources({ held: HELD_BLOB, cdnBase: "https://mine.test/" }),
    )[0];
    expect(rung).toMatchObject({
      from: "blob",
      url: `${BLOB_TIER_BASE}maps/minimap/deadbeef.webp`,
    });
  });

  it("carries no dimensions for a local minimap, which is a square texture", () => {
    expect(mapPictureLadder(sources({ local: LOCAL }))[0]).toMatchObject({
      width: null,
      height: null,
    });
  });
});

describe("shownMapPicture", () => {
  const full = mapPictureLadder(
    sources({ local: LOCAL, held: HELD_STATIC, bar: BAR }),
  );
  const staticUrl = `${DEFAULT_ASSET_CDN_BASE}maps/minimap/deadbeef.webp`;

  it("demotes one rung at a time as each fails", () => {
    expect(shownMapPicture(full, new Set([LOCAL])).from).toBe("static");
    expect(shownMapPicture(full, new Set([LOCAL, staticUrl])).from).toBe("bar");
  });

  it("draws the map rather than leaving a broken image when every fetch fails", () => {
    const every = new Set([LOCAL, staticUrl, BAR]);
    expect(shownMapPicture(full, every)).toEqual({
      from: "placeholder",
      name: MAP,
      size: null,
    });
  });

  it("reaches the drawing from a ladder whose only rung is remote", () => {
    const ladder = mapPictureLadder(sources({ bar: BAR }));
    expect(shownMapPicture(ladder, new Set([BAR])).from).toBe("placeholder");
  });

  it("answers even for a ladder built with no drawing at the bottom", () => {
    const ladder = mapPictureLadder(sources({ bar: BAR })).slice(0, 1);
    expect(shownMapPicture(ladder, new Set([BAR])).from).toBe("placeholder");
  });
});

describe("mapPictureAlt", () => {
  it("calls a picture out of an archive a minimap", () => {
    const rung = mapPictureLadder(sources({ local: LOCAL }))[0];
    expect(mapPictureAlt(rung, MAP)).toBe(`Minimap of ${MAP}`);
  });

  it("calls BAR's thumbnail a preview, because that is what it is", () => {
    const rung = mapPictureLadder(sources({ bar: BAR }))[0];
    expect(mapPictureAlt(rung, MAP)).toBe(`Preview of ${MAP}`);
  });

  it("gives the drawing no alt text, since it carries its own label", () => {
    const rung = mapPictureLadder(sources()).at(-1);
    expect(rung && mapPictureAlt(rung, MAP)).toBe("");
  });
});
