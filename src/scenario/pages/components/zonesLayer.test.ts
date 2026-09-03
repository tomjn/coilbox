/**
 * A selection marquee is not drawn like a zone (issue #2279).
 *
 * The marquee travels to the map through the same list a half-drawn zone does,
 * because a rectangle dragged out on the ground is exactly what this layer
 * already draws. That reuse is the whole reason the two once looked identical,
 * and both are made by the same gesture - a left-drag on bare ground, with only
 * the mode telling them apart - so looking alike is the one thing they must not
 * do.
 *
 * What follows pins the difference from both sides: the marquee has no fill and
 * a wide white edge, and a zone being dragged out is untouched. Nothing renders
 * here. The scene is a bag to hang objects off, and what is asserted is what was
 * hung in it.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { MapScene3D } from "@/mapconv/pages/components/MapPreview3D";
import type { ScenarioZone } from "../../model";
import { MARQUEE_ZONE_ID } from "./zones";
import { createZonesLayer } from "./zonesLayer";

/** Enough of a scene to hang objects off. Nothing here renders, but the
 *  marquee's screen-space lines ask the renderer how big the viewport is, so
 *  there is a size to read. */
function scene(): MapScene3D {
  return {
    scene: new THREE.Scene(),
    scale: 1,
    render: () => {},
    renderer: {
      getSize: (into: THREE.Vector2) => into.set(1280, 720),
    },
  } as unknown as MapScene3D;
}

function layer() {
  return createZonesLayer({
    handle: scene(),
    worldWidth: 4096,
    worldHeight: 4096,
    // Flat ground, so the drape does not change what is being asserted.
    groundAt: () => 0,
  });
}

const box = (id: string): ScenarioZone => ({
  id,
  name: id === MARQUEE_ZONE_ID ? "Selecting" : "Landing site",
  shape: "box",
  min: { x: 1000, z: 1000 },
  max: { x: 1400, z: 1400 },
});

/** Everything one zone was drawn as, flattened out of its group. */
function drawn(root: THREE.Object3D, at: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.children[at].traverse((one) => {
    if (one !== root.children[at]) out.push(one);
  });
  return out;
}

/** The name of the material a part was drawn with, whether it is a mesh, a
 *  plain line or one of the marquee's screen-space ones. */
const materialName = (one: THREE.Object3D) =>
  ((one as THREE.Mesh).material as THREE.Material).constructor.name;

/** The sheet of ground a zone is drawn as. `Line2` is a mesh too, so a marquee
 *  would answer `instanceof THREE.Mesh`, and what is being counted here is the
 *  fill rather than the geometry it happens to be built from. */
const sheets = (parts: THREE.Object3D[]) =>
  parts.filter((one) => materialName(one) === "MeshBasicMaterial");

/** Every edge drawn, a zone's plain line and the marquee's wide ones alike. */
const lines = (parts: THREE.Object3D[]) =>
  parts.filter((one) => materialName(one).startsWith("Line"));

describe("a selection marquee against a zone being drawn", () => {
  it("draws the marquee as lines and nothing else, so there is no sheet of ground", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    const parts = drawn(zones.root, 0);
    expect(sheets(parts)).toHaveLength(0);
    expect(lines(parts)).toHaveLength(2);
  });

  it("still draws a zone with its filled sheet", () => {
    const zones = layer();
    zones.draw([box("z1")], null);

    const parts = drawn(zones.root, 0);
    expect(sheets(parts).length).toBeGreaterThan(0);
  });

  it("draws the marquee solid, so the white is the line rather than flecks in it", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    // It was a dashed white line over a wider dark one. The dashes are a
    // fraction of the perimeter and the backing is wider than they are, so what
    // was on screen was a dark line with white specks in it.
    const dashed = lines(drawn(zones.root, 0)).filter(
      (one) =>
        ((one as THREE.Mesh).material as { dashed?: boolean }).dashed === true,
    );
    expect(dashed).toHaveLength(0);
  });

  it("draws the marquee wide enough to see, which a plain line cannot be", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID), box("z1")], null);

    // Every driver ignores `LineBasicMaterial.linewidth`, so a width that is
    // honoured means `LineMaterial` and nothing else (issue #2279).
    const widths = lines(drawn(zones.root, 0)).map((one) => ({
      material: materialName(one),
      width: ((one as THREE.Mesh).material as unknown as { linewidth: number })
        .linewidth,
    }));
    expect(widths).toHaveLength(2);
    for (const one of widths) {
      expect(one.material).toBe("LineMaterial");
      expect(one.width).toBeGreaterThan(1);
    }
    // The dark line under the white one is the wider of the two, so it shows
    // as an edge either side of it.
    expect(Math.max(...widths.map((one) => one.width))).toBeGreaterThan(
      Math.min(...widths.map((one) => one.width)),
    );
  });

  /**
   * Three renders every opaque object before every transparent one, and
   * `renderOrder` only sorts within each of those two lists. So a translucent
   * backing is painted over the opaque accent line whatever order the two are
   * given, and what shows through is the accent at the joins, where the wider
   * backing leaves a notch. That is a dark band with regular coloured flecks in
   * it, which is what a dashed line looks like and what the marquee was
   * mistaken for twice.
   */
  it("keeps both marquee lines opaque, so the backing cannot be drawn over the accent", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    for (const one of lines(drawn(zones.root, 0))) {
      expect((one as THREE.Mesh).material).toHaveProperty("transparent", false);
    }
  });

  it("keeps the dark line only a shade wider, so it is an edge and not a line of its own", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    const widths = lines(drawn(zones.root, 0)).map(
      (one) =>
        ((one as THREE.Mesh).material as unknown as { linewidth: number })
          .linewidth,
    );
    const white = Math.min(...widths);
    const dark = Math.max(...widths);
    // Two pixels between them is one pixel of dark either side of the white.
    expect(dark - white).toBe(2);
    expect(white).toBeGreaterThan(dark / 2);
  });

  it("draws the marquee in neither the zone's blue nor a path's green", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    const colours = lines(drawn(zones.root, 0)).map((one) =>
      ((one as THREE.Mesh).material as THREE.LineBasicMaterial).color.getHex(),
    );
    expect(colours).not.toContain(0x38bdf8);
    expect(colours).not.toContain(0x86efac);
    // The accent over dark, so the box still reads where the ground is pale.
    expect(colours).toContain(0x0f172a);
  });

  /**
   * `THREE.Color.setStyle` answers a colour it cannot parse with a warning and
   * no colour at all, which leaves the material white. So a marquee drawn white
   * is not a marquee anybody chose: it is the theme read failing quietly, which
   * is exactly what the old drawing looked like and what this stopped being.
   *
   * There is no document here, so what is under test is the fallback path,
   * which is the one whose colour is written in a form three does not read.
   */
  it("takes a real colour from the theme, rather than the white a failed read leaves", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    const colours = lines(drawn(zones.root, 0)).map((one) =>
      ((one as THREE.Mesh).material as THREE.LineBasicMaterial).color.getHex(),
    );
    expect(colours).not.toContain(0xffffff);
    // Something other than the backing, or the accent line is not drawn at all.
    expect(colours.filter((c) => c !== 0x0f172a)).toHaveLength(1);
  });

  it("does not clash with the plate under a selected unit, which is its own blue", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID)], null);

    const colours = lines(drawn(zones.root, 0)).map((one) =>
      ((one as THREE.Mesh).material as THREE.LineBasicMaterial).color.getHex(),
    );
    expect(colours).not.toContain(0x7dd3fc);
  });

  it("gives two zones two shades, so a map of them is not one blue shape", () => {
    const zones = layer();
    zones.draw([box("ridge"), box("keep")], null);

    const shadeOf = (at: number) =>
      sheets(drawn(zones.root, at)).map((one) =>
        (
          (one as THREE.Mesh).material as THREE.MeshBasicMaterial
        ).color.getHex(),
      )[0];

    expect(shadeOf(0)).not.toBe(shadeOf(1));
  });

  it("gives a zone the same shade whatever else is on the map", () => {
    const alone = layer();
    alone.draw([box("ridge")], null);
    const crowded = layer();
    // Drawn second, and after a zone that did not exist the first time. A shade
    // read off the position in the list would move here, and an author who
    // deleted one zone would find every other one had changed colour.
    crowded.draw([box("keep"), box("ridge")], null);

    const shadeOf = (root: THREE.Object3D, at: number) =>
      sheets(drawn(root, at)).map((one) =>
        (
          (one as THREE.Mesh).material as THREE.MeshBasicMaterial
        ).color.getHex(),
      )[0];

    expect(shadeOf(crowded.root, 1)).toBe(shadeOf(alone.root, 0));
  });

  it("keeps every shade a blue, rather than reaching a path's green", () => {
    const zones = layer();
    const ids = ["ridge", "keep", "yard", "pass", "landing", "perimeter"];
    zones.draw(
      ids.map((id) => box(id)),
      null,
    );

    for (let at = 0; at < ids.length; at++) {
      const colour = sheets(drawn(zones.root, at)).map(
        (one) =>
          ((one as THREE.Mesh).material as THREE.MeshBasicMaterial).color,
      )[0];
      const hsl = { h: 0, s: 0, l: 0 };
      colour.getHSL(hsl);
      const base = { h: 0, s: 0, l: 0 };
      new THREE.Color(0x38bdf8).getHSL(base);
      // A hue is a circle, so the distance is the shorter way round it.
      const turned = Math.min(
        Math.abs(hsl.h - base.h),
        1 - Math.abs(hsl.h - base.h),
      );
      // The spread is 22 degrees either way. Anything wider would reach the
      // green a path is drawn in.
      expect(turned * 360).toBeLessThanOrEqual(22.001);
    }
  });

  it("gives the marquee no key, so nothing can select it or take hold of it", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID), box("z1")], null);

    expect(zones.has(`zone:${MARQUEE_ZONE_ID}`)).toBe(false);
    expect(zones.has("zone:z1")).toBe(true);
  });

  it("leaves a zone being dragged out exactly as it was, marquee or no marquee", () => {
    const alone = layer();
    alone.draw([box("draft-zone")], null);
    const beside = layer();
    beside.draw([box(MARQUEE_ZONE_ID), box("draft-zone")], null);

    const shape = (parts: THREE.Object3D[]) =>
      parts.map((one) => [
        one.type,
        (
          (one as THREE.Mesh).material as THREE.MeshBasicMaterial
        ).color.getHex(),
        ((one as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity,
      ]);
    // Asserted non-empty first, or two zones that drew nothing would agree.
    expect(shape(drawn(alone.root, 0)).length).toBeGreaterThan(1);
    expect(shape(drawn(beside.root, 1))).toEqual(shape(drawn(alone.root, 0)));
  });

  it("takes the marquee away when it is drawn without one", () => {
    const zones = layer();
    zones.draw([box(MARQUEE_ZONE_ID), box("z1")], null);
    zones.draw([box("z1")], null);

    expect(zones.root.children).toHaveLength(1);
    expect(sheets(drawn(zones.root, 0)).length).toBeGreaterThan(0);
  });
});
