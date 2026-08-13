/**
 * How a footprint is drawn, which is the whole of issue #1491.
 *
 * The drawing is three.js and is not tested. The decision behind it is, because
 * the bug was that two of the three states were drawn the same: a building the
 * check approved of and one it could not judge were both a quiet grey square,
 * so a check that had stopped working looked exactly like a check that was
 * passing everything.
 */

import { describe, expect, it } from "vitest";

import type { Standing } from "@/blueprint/footprint";
import { footprintStyle } from "./footprintsLayer";

const style = (standing: Standing, overlapping = false) =>
  footprintStyle({ standing, overlapping });

const held = (standing: Standing, overlapping = false) =>
  footprintStyle({ standing, overlapping }, "held");

const offered = (standing: Standing, overlapping = false) =>
  footprintStyle({ standing, overlapping }, "offered");

describe("footprintStyle", () => {
  it("draws a building the ground takes as a quiet filled square", () => {
    const fine = style("fine");
    expect(fine.fill).toBeGreaterThan(0);
    expect(fine.dashed).toBe(false);
  });

  it("draws a refusal filled and bold, in its own colour per reason", () => {
    const clash = style("fine", true);
    const slope = style("slope");
    expect(clash.fill).toBeGreaterThan(style("fine").fill);
    expect(slope.fill).toBeGreaterThan(style("fine").fill);
    expect(clash.color).not.toBe(slope.color);
    expect(clash.dashed).toBe(false);
    expect(slope.dashed).toBe(false);
  });

  /** Issue #1459. A building in the wrong depth of water is a refusal of its
   *  own: it is fixed by moving it into the water, or out of it, and no amount
   *  of flatter ground helps. */
  it("draws a building at the wrong depth in its own refusal colour", () => {
    const depth = style("too-deep");
    expect(depth.fill).toBeGreaterThan(0);
    expect(depth.dashed).toBe(false);
    for (const other of [
      style("slope"),
      style("no-def"),
      style("fine", true),
    ]) {
      expect(depth.color).not.toBe(other.color);
    }
  });

  /**
   * Issue #1552. Both ends of the band are the water refusing the building, so
   * both are cyan: a fifth colour would be a fifth thing to learn for a
   * difference the sentence already carries, and it would say the two are
   * unrelated when they are the same rule read from opposite sides.
   */
  it("draws both ends of the band in the one water colour", () => {
    expect(style("too-shallow")).toEqual(style("too-deep"));
  });

  /** The state that did not exist. Dashed and unfilled, so it cannot be read as
   *  either of the other two at a glance. */
  it("draws a building with no verdict as an empty dashed square", () => {
    for (const reason of ["no-ground", "no-units", "no-slope"] as const) {
      const none = style(reason);
      expect(none.dashed).toBe(true);
      expect(none.fill).toBe(0);
    }
  });

  it("keeps a building with no verdict distinct from both the others", () => {
    const none = style("no-ground");
    for (const other of [style("fine"), style("slope"), style("fine", true)]) {
      expect(none.dashed).not.toBe(other.dashed);
    }
  });

  /**
   * Issue #1445. A building whose unit the game has not got will never be
   * built, so it is a refusal rather than a missing answer, and it is its own
   * refusal: nothing about moving it or finding flatter ground helps.
   */
  it("draws a unit the game has not got as its own kind of refusal", () => {
    const absent = style("no-def");
    expect(absent.dashed).toBe(false);
    expect(absent.fill).toBeGreaterThan(style("fine").fill);
    expect(absent.color).not.toBe(style("slope").color);
    expect(absent.color).not.toBe(style("fine", true).color);
    expect(absent.color).not.toBe(style("fine").color);
  });

  /** A clash is the author's own doing and the ground under it may well be
   *  fine once the pair is pulled apart, so it wins over anything else. */
  it("lets a clash win over a verdict it has not got", () => {
    expect(style("no-ground", true)).toEqual(style("fine", true));
  });

  /** A floater is not unjudged. The ground under it decides nothing, so it is
   *  drawn like any other building nobody has anything to say about. */
  it("draws a floater as a settled building", () => {
    expect(style("floats")).toEqual(style("fine"));
  });
});

/**
 * Issue #1512. A building being dragged is the one the author is positioning,
 * so it is picked out of the squares around it the way the selection ring used
 * to pick it out, and it says the same three states as any other building while
 * it is in the air.
 */
describe("footprintStyle, held by the pointer", () => {
  it("picks the held building out of the ones standing around it", () => {
    expect(held("fine").color).not.toBe(style("fine").color);
    expect(held("fine").fill).toBeGreaterThan(style("fine").fill);
    expect(held("fine").outline).toBeGreaterThan(style("fine").outline);
  });

  /** The whole reason for carrying the marks live: red is the answer to where
   *  this is being dropped, so being held cannot paint over it. */
  it("keeps a refusal's own colour while it is being held", () => {
    expect(held("fine", true).color).toBe(style("fine", true).color);
    expect(held("slope").color).toBe(style("slope").color);
    expect(held("no-def").color).toBe(style("no-def").color);
    expect(held("fine", true).fill).toBeGreaterThan(style("fine", true).fill);
  });

  /** A held building nothing has judged is still a building nothing has
   *  judged: the empty dashed square is the statement, not the colour. */
  it("keeps an unjudged building empty and dashed", () => {
    expect(held("no-ground").dashed).toBe(true);
    expect(held("no-ground").fill).toBe(0);
    expect(held("no-ground").color).toBe(held("fine").color);
  });
});

/**
 * Issues #1541 and #1543. A spot being offered is drawn beside the building
 * rather than instead of it: a turn's destination stands next to where the
 * building is now, and a nudge's spot next to the layout under the pointer.
 *
 * So it is an outline with nothing filled in. Two filled squares half a build
 * square apart read as one smeared square, and the offered one is not somewhere
 * anything is standing yet.
 */
describe("footprintStyle, a spot being offered", () => {
  it("draws an offer as an outline with nothing filled in", () => {
    expect(offered("fine").fill).toBe(0);
    expect(offered("fine").dashed).toBe(false);
    expect(offered("fine").outline).toBeGreaterThan(style("fine").outline);
  });

  it("tells an offered spot from a building standing on one", () => {
    expect(offered("fine").color).not.toBe(style("fine").color);
  });

  /** The whole point of drawing the spot: a turn that will land the building
   *  in its neighbour says so before it is taken. */
  it("keeps a refusal's own colour in an offer", () => {
    expect(offered("fine", true).color).toBe(style("fine", true).color);
    expect(offered("slope").color).toBe(style("slope").color);
    expect(offered("too-deep").color).toBe(style("too-deep").color);
    expect(offered("too-shallow").color).toBe(style("too-shallow").color);
    expect(offered("no-def").color).toBe(style("no-def").color);
  });

  /** An offer nothing has judged is still nothing anything has judged, and the
   *  dashes are what say so. */
  it("keeps an unjudged offer dashed", () => {
    expect(offered("no-ground").dashed).toBe(true);
    expect(offered("no-ground").fill).toBe(0);
  });
});
