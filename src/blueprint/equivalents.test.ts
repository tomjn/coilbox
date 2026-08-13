import { describe, expect, it } from "vitest";
import {
  coveredDefs,
  equivalentOf,
  learnEquivalence,
  NO_EQUIVALENTS,
  parseEquivalenceTable,
  sideOfDefInTable,
  tableSides,
} from "./equivalents";

/** What a person would have said after converting one layout of solars and one
 *  Pawn: the first is a pair the naming route also reaches, the second is one it
 *  never can. */
const learned = learnEquivalence(
  learnEquivalence(NO_EQUIVALENTS, "Armada", "armsolar", "Cortex", "corsolar"),
  "Armada",
  "armpw",
  "Cortex",
  "corak",
);

describe("learnEquivalence", () => {
  it("remembers the pair a person picked, both ways round", () => {
    expect(equivalentOf("armpw", "Cortex", learned)).toBe("corak");
    expect(equivalentOf("corak", "Armada", learned)).toBe("armpw");
  });

  it("says nothing about a def nobody has answered for", () => {
    expect(equivalentOf("armllt", "Cortex", learned)).toBeUndefined();
  });

  it("says nothing about a side nobody has answered for", () => {
    expect(equivalentOf("armpw", "Legion", learned)).toBeUndefined();
  });

  it("holds a def written in any case, because a file holds what its author wrote", () => {
    expect(equivalentOf("ArmPw", "Cortex", learned)).toBe("corak");
  });

  it("grows the thing a def already belongs to rather than starting another", () => {
    const three = learnEquivalence(
      learned,
      "Armada",
      "armpw",
      "Legion",
      "legpw",
    );
    expect(three.groups).toHaveLength(2);
    expect(equivalentOf("corak", "Legion", three)).toBe("legpw");
  });

  it("takes a correction over what it was told before", () => {
    const fixed = learnEquivalence(
      learned,
      "Armada",
      "armpw",
      "Cortex",
      "corpyro",
    );
    expect(fixed.groups).toHaveLength(2);
    expect(equivalentOf("armpw", "Cortex", fixed)).toBe("corpyro");
  });

  it("learns nothing from a def standing in for itself", () => {
    expect(
      learnEquivalence(NO_EQUIVALENTS, "Armada", "armpw", "Cortex", "armpw")
        .groups,
    ).toEqual([]);
  });

  it("learns nothing from a side that is the same side", () => {
    expect(
      learnEquivalence(NO_EQUIVALENTS, "Armada", "armpw", "Armada", "armck")
        .groups,
    ).toEqual([]);
  });

  it("learns nothing from a blank", () => {
    expect(
      learnEquivalence(NO_EQUIVALENTS, "Armada", "armpw", "Cortex", " ").groups,
    ).toEqual([]);
    expect(
      learnEquivalence(NO_EQUIVALENTS, "", "armpw", "Cortex", "corak").groups,
    ).toEqual([]);
  });
});

describe("sideOfDefInTable", () => {
  it("says which side a def is, whatever it is called", () => {
    expect(sideOfDefInTable("corak", learned)).toBe("Cortex");
  });

  it("says nothing about a def two sides both use", () => {
    // A game really does give both sides one shipyard, so a def can honestly be
    // in two groups under two sides. Which side it is is then unanswerable.
    const shared = learnEquivalence(
      learned,
      "Cortex",
      "corsy",
      "Armada",
      "corsy",
    );
    expect(sideOfDefInTable("corsy", shared)).toBeUndefined();
  });

  it("says nothing about a def it has never been told about", () => {
    expect(sideOfDefInTable("armllt", learned)).toBeUndefined();
  });
});

describe("tableSides", () => {
  it("names every side it has been told about, first said first", () => {
    expect(tableSides(learned)).toEqual(["Armada", "Cortex"]);
  });

  it("names none for a table nobody has filled in", () => {
    expect(tableSides(NO_EQUIVALENTS)).toEqual([]);
  });
});

describe("coveredDefs", () => {
  it("counts the defs it can answer for", () => {
    expect(coveredDefs(learned)).toBe(4);
    expect(coveredDefs(NO_EQUIVALENTS)).toBe(0);
  });
});

describe("parseEquivalenceTable", () => {
  it("reads back what was written", () => {
    expect(parseEquivalenceTable(JSON.parse(JSON.stringify(learned)))).toEqual(
      learned,
    );
  });

  it("drops a group with nothing to compare, because a pair needs two", () => {
    expect(
      parseEquivalenceTable({ groups: [{ Armada: "armpw" }] }).groups,
    ).toEqual([]);
  });

  it("drops anything that is not a table at all", () => {
    expect(parseEquivalenceTable(null)).toEqual(NO_EQUIVALENTS);
    expect(parseEquivalenceTable({ groups: "yes" })).toEqual(NO_EQUIVALENTS);
    expect(parseEquivalenceTable({ groups: [{ Armada: 7 }] })).toEqual(
      NO_EQUIVALENTS,
    );
  });
});
