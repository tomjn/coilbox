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
