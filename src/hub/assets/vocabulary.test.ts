import { describe, expect, it } from "vitest";
import {
  ASSET_CLASSES,
  ASSET_ORIGINS,
  BUILDPIC_VARIANT,
  classForVariant,
  ELMOS_PER_BUILD_SQUARE,
  ELMOS_PER_METAL_SAMPLE,
  MAP_VARIANTS,
  MINIMAP_VARIANT,
  mapExtentElmos,
  maxObjectBytes,
  PICTURE_ANGLES,
  PLAN_ANGLE,
  RENDER_ANGLES,
  RENDER_BLEED_SQUARES,
  RENDER_VARIANT_PREFIX,
  renderFrame,
  renderPixels,
  renderVariant,
  TOP_RENDER_ANGLE,
} from "./vocabulary";

/**
 * `shared/asset-vocabulary.json` is embedded at build time on both sides, so a
 * bad edit to it cannot reach a user's machine without failing here first. That
 * makes these assertions the guard rather than a restatement of the file: every
 * expected value below is written out by hand, so changing the JSON and changing
 * the test are two separate decisions.
 *
 * `crates/coilbox-assets/src/lib.rs` asserts the same values from Rust.
 */

describe("the variant names", () => {
  it("names the two a unit has", () => {
    expect(BUILDPIC_VARIANT).toBe("buildpic");
    expect(renderVariant("top")).toBe("render:top");
    expect(RENDER_VARIANT_PREFIX).toBe("render:");
  });

  it("closes the map list at four", () => {
    expect([...MAP_VARIANTS]).toEqual([
      "minimap",
      "overlay:metal",
      "overlay:type",
      "overlay:height",
    ]);
  });

  it("names the map's own picture as one of them", () => {
    // The picture ladder asks the hub for this one by name, and a variant
    // outside the list is a 400 rather than an answer.
    expect(MAP_VARIANTS).toContain(MINIMAP_VARIANT);
  });

  it("renders four angles, one of which is a plan", () => {
    expect([...RENDER_ANGLES]).toEqual(["top", "front", "side", "angled"]);
  });

  it("names the angle a plan is drawn from as one of them", () => {
    // The blueprint plan asks the hub for this one by name, and an angle outside
    // the list names a picture nothing ever uploaded.
    expect(RENDER_ANGLES).toContain(TOP_RENDER_ANGLE);
  });

  /** The plan and the pictures between them are the whole list, so an angle
   *  added upstream is one or the other rather than neither (issue #1951). */
  it("splits the angles into the plan and the pictures", () => {
    expect([PLAN_ANGLE, ...PICTURE_ANGLES].sort()).toEqual(
      [...RENDER_ANGLES].sort(),
    );
    expect(PICTURE_ANGLES).not.toContain(PLAN_ANGLE);
  });

  /**
   * The framing rule, from the side that draws. Its twin in `coilbox-assets` is
   * what refuses a render that is not this shape, and the two disagreeing would
   * be every picture refused as mis-framed on somebody's machine.
   */
  it("frames only the plan on the footprint, and the rest square", () => {
    const frame = renderFrame(3, 2);
    expect(renderPixels(PLAN_ANGLE, 3, 2)).toEqual({
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
    });
    expect(frame.widthPx).not.toBe(frame.heightPx);

    for (const angle of PICTURE_ANGLES) {
      expect(renderPixels(angle, 3, 2)).toEqual({
        widthPx: 256,
        heightPx: 256,
      });
      // The footprint cannot move it, since these frame on the model instead.
      expect(renderPixels(angle, 12, 1)).toEqual({
        widthPx: 256,
        heightPx: 256,
      });
    }
  });

  it("names how the bytes were produced", () => {
    expect([...ASSET_ORIGINS]).toEqual(["extracted", "rendered", "uploaded"]);
  });
});

describe("the encode profiles", () => {
  it("names the codec, the quality and the size cap for each class", () => {
    expect(ASSET_CLASSES.buildpic.encodeProfile).toBe("webp-lossless-256");
    expect(ASSET_CLASSES.render.encodeProfile).toBe("webp-q80-256");
    expect(ASSET_CLASSES.minimap.encodeProfile).toBe("webp-q80-512");
    expect(ASSET_CLASSES["overlay:metal"].encodeProfile).toBe(
      "webp-lossless-source",
    );
    expect(ASSET_CLASSES["overlay:type"].encodeProfile).toBe(
      "webp-lossless-source",
    );
    expect(ASSET_CLASSES["overlay:height"].encodeProfile).toBe(
      "webp-lossless-512",
    );
  });

  it("fits the 64 characters the hub's `encode_profile` column takes", () => {
    for (const asset of Object.values(ASSET_CLASSES)) {
      expect(asset.encodeProfile.length).toBeLessThanOrEqual(64);
    }
  });

  it("names a quality on exactly the lossy classes", () => {
    for (const asset of Object.values(ASSET_CLASSES)) {
      expect(asset.quality === null).toBe(asset.lossless);
    }
  });
});

describe("the dimension caps", () => {
  it("caps a unit image at 256px and a minimap at 512px", () => {
    expect(ASSET_CLASSES.buildpic.maxEdgePx).toBe(256);
    expect(ASSET_CLASSES.render.maxEdgePx).toBe(256);
    expect(ASSET_CLASSES.minimap.maxEdgePx).toBe(512);
  });

  // 512 is where the terrain mesh stops being able to show more detail, which
  // is what issue #1730 caps the height picture on.
  it("caps the height overlay at 512px like the minimap", () => {
    expect(ASSET_CLASSES["overlay:height"].maxEdgePx).toBe(512);
  });

  it("leaves the sample overlays at whatever resolution the map's grid has", () => {
    for (const variant of ["overlay:metal", "overlay:type"]) {
      expect(ASSET_CLASSES[variant].maxEdgePx).toBeNull();
      expect(ASSET_CLASSES[variant].maxBytes).toBeNull();
    }
  });

  it("keeps square a build pic property and extends it to nothing else", () => {
    expect(ASSET_CLASSES.buildpic.square).toBe(true);
    for (const [name, asset] of Object.entries(ASSET_CLASSES)) {
      if (name !== "buildpic") expect(asset.square).toBe(false);
    }
  });

  it("derives maxBytes from maxEdgePx at four bytes a pixel", () => {
    for (const asset of Object.values(ASSET_CLASSES)) {
      if (asset.maxEdgePx === null) continue;
      expect(asset.maxBytes).toBe(asset.maxEdgePx * asset.maxEdgePx * 4);
    }
  });

  it("holds the same 2 MB backstop the hub does", () => {
    expect(maxObjectBytes).toBe(2 * 1024 * 1024);
  });

  // The height overlay is grey pixels, but nothing may say so: WebP has no
  // grayscale mode, so the bytes are RGB with the three channels equal and the
  // hub's header reader cannot tell that from any other picture (issue #1730).
  it("takes every class as WebP, with no depth or channel count declared", () => {
    for (const asset of Object.values(ASSET_CLASSES)) {
      expect(asset.mime).toBe("image/webp");
      expect(asset.minBitDepth).toBeNull();
      expect(asset.grayscale).toBe(false);
    }
  });

  it("requires lossless of every class that carries data rather than a picture", () => {
    expect(ASSET_CLASSES.buildpic.lossless).toBe(true);
    expect(ASSET_CLASSES["overlay:metal"].lossless).toBe(true);
    expect(ASSET_CLASSES["overlay:type"].lossless).toBe(true);
    expect(ASSET_CLASSES["overlay:height"].lossless).toBe(true);
    expect(ASSET_CLASSES.render.lossless).toBe(false);
    expect(ASSET_CLASSES.minimap.lossless).toBe(false);
  });
});

describe("classForVariant", () => {
  it("gives every render angle the render class", () => {
    expect(classForVariant("render:top")).toBe(ASSET_CLASSES.render);
    expect(classForVariant("render:front")).toBe(ASSET_CLASSES.render);
  });

  it("gives each map variant its own class", () => {
    for (const variant of MAP_VARIANTS) {
      expect(classForVariant(variant)).toBe(ASSET_CLASSES[variant]);
    }
  });

  it("keys the unit classes on the unit and the map classes on the map", () => {
    expect(classForVariant("buildpic")?.keyedOn).toBe("unit");
    expect(classForVariant("render:top")?.keyedOn).toBe("unit");
    for (const variant of MAP_VARIANTS) {
      expect(classForVariant(variant)?.keyedOn).toBe("map");
    }
  });

  it("has nothing for a variant the hub would refuse", () => {
    expect(classForVariant("overlay:wind")).toBeNull();
    expect(classForVariant("buildpics")).toBeNull();
  });
});

describe("mapExtentElmos", () => {
  it("counts a metal sample as two map squares of eight elmos", () => {
    expect(ELMOS_PER_METAL_SAMPLE).toBe(16);
  });

  // Real numbers, read off a map library with the worker's `--thumbnails` pass
  // and checked against the sizes Beyond All Reason publishes for the same maps
  // in `lobby_maps.validated.json`. A factor out by two still looks like a map
  // size, so the check that matters is against a second source.
  it("turns real maps' metal samples into their size in elmos", () => {
    // Altored Divide Bar Remake 1.6.2, which BAR calls 16 by 16.
    expect(mapExtentElmos(512, 512)).toEqual({
      widthElmos: 8192,
      heightElmos: 8192,
    });
    // Comet Catcher Remake 1.8, 16 by 12.
    expect(mapExtentElmos(512, 384)).toEqual({
      widthElmos: 8192,
      heightElmos: 6144,
    });
    // All That Glitters Extended v1.0.2, 30 by 20.
    expect(mapExtentElmos(960, 640)).toEqual({
      widthElmos: 15360,
      heightElmos: 10240,
    });
  });

  it("is 512 times the size a player says, which BAR's own list holds", () => {
    const { widthElmos, heightElmos } = mapExtentElmos(512, 384);
    expect([widthElmos / 512, heightElmos / 512]).toEqual([16, 12]);
  });
});

describe("renderFrame", () => {
  it("takes its aspect from the footprint, so a 3 by 2 building is never square", () => {
    const frame = renderFrame(3, 2);
    expect(frame.squaresX).toBe(5);
    expect(frame.squaresZ).toBe(4);
    expect(frame.widthPx / frame.heightPx).toBe(5 / 4);
    expect(frame.widthPx).toBeGreaterThan(frame.heightPx);
  });

  it("carries a whole build square of bleed on every side", () => {
    expect(RENDER_BLEED_SQUARES).toBe(1);
    const frame = renderFrame(4, 4);
    expect(frame.squaresX).toBe(6);
    expect(frame.squaresZ).toBe(6);
    expect(frame.widthElmos).toBe(6 * ELMOS_PER_BUILD_SQUARE);
    expect(ELMOS_PER_BUILD_SQUARE).toBe(16);
  });

  it("stays inside the render cap on the longest edge", () => {
    for (let footprint = 1; footprint <= 32; footprint++) {
      const frame = renderFrame(footprint, footprint);
      expect(Math.max(frame.widthPx, frame.heightPx)).toBeLessThanOrEqual(256);
      expect(frame.widthPx).toBeGreaterThan(0);
    }
  });

  it("uses whole pixels per square, so the encoded aspect is exact", () => {
    const frame = renderFrame(7, 3);
    expect(frame.widthPx).toBe(frame.squaresX * frame.pixelsPerSquare);
    expect(frame.heightPx).toBe(frame.squaresZ * frame.pixelsPerSquare);
  });

  it("floors a footprint at one square the way the engine does", () => {
    expect(renderFrame(0, 0)).toEqual(renderFrame(1, 1));
  });
});
