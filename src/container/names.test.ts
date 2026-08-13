/**
 * A name for every kind a container can hold (issue #1515).
 *
 * The names were reachable only by building the deep-link plan that carried
 * one, so a screen that wanted to say what it accepts had to write the list out
 * by hand. Both hand written lists had fallen behind the kinds by the time
 * anybody looked.
 */

import { describe, expect, it } from "vitest";
import { CONTAINER_KINDS } from "./container";
import { containerKindName, containerKindsSentence } from "./names";

describe("what a container kind is called", () => {
  it("names every kind, in the singular and without an article", () => {
    for (const kind of CONTAINER_KINDS) {
      const name = containerKindName(kind);
      expect(name).not.toBe("");
      expect(name).toBe(name.toLowerCase());
      expect(name.startsWith("a ")).toBe(false);
    }
  });

  it("calls no two kinds the same thing", () => {
    const names = CONTAINER_KINDS.map(containerKindName);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the kinds, as a sentence", () => {
  it("reads as a list of what a box takes", () => {
    expect(containerKindsSentence()).toBe(
      "a campaign, a singleplayer preset, a challenge, a setup pack, a scenario, a keymap or a base blueprint",
    );
  });

  /** The point of building it: a kind added to `CONTAINER_KINDS` is in the
   *  sentence the moment it is added, rather than whenever somebody notices. */
  it("cannot fall behind the kinds a container can hold", () => {
    for (const kind of CONTAINER_KINDS) {
      expect(containerKindsSentence()).toContain(
        `a ${containerKindName(kind)}`,
      );
    }
  });
});
