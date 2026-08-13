import { describe, expect, it } from "vitest";
import {
  coveredDefs,
  coveredDefsBySource,
  type Equivalence,
  type EquivalenceTable,
  equivalentOf,
  learnEquivalence,
  mergeEquivalents,
  NO_EQUIVALENTS,
  namesDef,
  orderYoursFirst,
  parseEquivalenceTable,
  sideOfDefInTable,
  sourceIn,
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

/**
 * Issue #1544. The same count split by whose answer it is, because a table that
 * has read a game's published file is mostly the game's and saying the lot came
 * from converting claims credit for answers nobody here gave.
 */
describe("coveredDefsBySource", () => {
  /** Two answers a person gave, one group a game's file brought, and one pair
   *  an older coilbox stored with nothing said about it. */
  const mixed: EquivalenceTable = {
    groups: [
      ...learned.groups,
      {
        Armada: { def: "armanni", from: "game" },
        Cortex: { def: "cordoom", from: "game" },
      },
      { Armada: { def: "armllt" }, Cortex: { def: "corllt" } },
    ],
  };

  it("counts a person's answers apart from a game's", () => {
    expect(coveredDefsBySource(mixed).you).toBe(4);
    expect(coveredDefsBySource(mixed).game).toBe(2);
  });

  it("counts an answer from before it recorded any of this as neither", () => {
    expect(coveredDefsBySource(mixed).unsaid).toBe(2);
  });

  it("adds up to every def the table can answer for", () => {
    const split = coveredDefsBySource(mixed);
    expect(split.all).toBe(coveredDefs(mixed));
    expect(split.you + split.game + split.unsaid).toBe(split.all);
  });

  it("counts a def as the person's wherever else it is named", () => {
    // The same def in two groups, one of them a person's answer. They said it,
    // so it is theirs, the same order of trust as everywhere else here.
    const twice: EquivalenceTable = {
      groups: [
        { Armada: { def: "armsolar", from: "game" }, Cortex: { def: "corsy" } },
        ...learned.groups,
      ],
    };
    expect(coveredDefsBySource(twice).you).toBe(4);
    expect(coveredDefsBySource(twice).game).toBe(0);
  });

  it("counts nothing for a table nobody has filled in", () => {
    expect(coveredDefsBySource(NO_EQUIVALENTS)).toEqual({
      all: 0,
      you: 0,
      game: 0,
      unsaid: 0,
    });
  });
});

/**
 * Issue #1545. Where each group stands, the ones a person answered first. A
 * game's published table brings 87 at once, so their own five are otherwise
 * found by eye.
 */
describe("orderYoursFirst", () => {
  const table: EquivalenceTable = {
    groups: [
      {
        Armada: { def: "armanni", from: "game" },
        Cortex: { def: "cordoom", from: "game" },
      },
      {
        Armada: { def: "armpw", from: "you" },
        Cortex: { def: "corak", from: "you" },
      },
      { Armada: { def: "armllt" }, Cortex: { def: "corllt" } },
      {
        Armada: { def: "armsolar", from: "game" },
        Cortex: { def: "corsolar", from: "you" },
      },
    ],
  };

  it("puts the groups holding an answer a person gave first", () => {
    // The last of them is one merging left half theirs and half the game's,
    // which is theirs enough to be worth finding.
    expect(orderYoursFirst(table)).toEqual([1, 3, 0, 2]);
  });

  it("says where each group stands in the table, so dropping one drops that one", () => {
    expect([...orderYoursFirst(table)].sort()).toEqual([0, 1, 2, 3]);
  });

  it("leaves a table nobody has answered any of in the order it is kept", () => {
    expect(
      orderYoursFirst({ groups: [table.groups[0], table.groups[2]] }),
    ).toEqual([0, 1]);
  });

  it("orders nothing for a table nobody has filled in", () => {
    expect(orderYoursFirst(NO_EQUIVALENTS)).toEqual([]);
  });
});

/**
 * Issue #1547. Which rows a person hunting one building is asking about, so a
 * table long enough to be worth reading is also short enough to answer with.
 */
describe("namesDef", () => {
  const group: Equivalence = {
    Armada: { def: "armpw", from: "you" },
    Cortex: { def: "corak", from: "you" },
  };

  it("finds a row by a def any of its sides calls the thing", () => {
    expect(namesDef(group, "corak")).toBe(true);
    expect(namesDef(group, "armpw")).toBe(true);
  });

  it("finds a row by part of a def, because half a name is what gets typed", () => {
    expect(namesDef(group, "ak")).toBe(true);
  });

  it("reads a def written in any case, because a def is typed however", () => {
    expect(namesDef(group, "CorAk")).toBe(true);
  });

  it("leaves out a row naming nothing of the sort", () => {
    expect(namesDef(group, "legpw")).toBe(false);
  });

  it("takes every row when nothing has been typed, so a blank box hides none", () => {
    expect(namesDef(group, "")).toBe(true);
    expect(namesDef(group, "   ")).toBe(true);
  });

  it("goes by what the game calls a thing rather than what the side is called", () => {
    // Otherwise typing a side's name would take every row it has an answer
    // for, which is most of the table and no help to anybody.
    expect(namesDef(group, "Cortex")).toBe(false);
  });
});

/**
 * Issue #1526. A game's own table folded into this machine's, where a person's
 * own answer always wins, because they are the one who plays it.
 */
describe("mergeEquivalents", () => {
  const theirs: EquivalenceTable = {
    groups: [
      {
        Armada: { def: "armsolar", from: "game" },
        Cortex: { def: "corsolar", from: "game" },
        Legion: { def: "legsolar", from: "game" },
      },
      {
        Armada: { def: "armanni", from: "game" },
        Cortex: { def: "cordoom", from: "game" },
      },
    ],
  };

  it("takes what nobody has said anything about", () => {
    expect(
      equivalentOf("armanni", "Cortex", mergeEquivalents(learned, theirs)),
    ).toBe("cordoom");
  });

  it("leaves an answer a person already gave", () => {
    const mine = learnEquivalence(
      NO_EQUIVALENTS,
      "Armada",
      "armanni",
      "Cortex",
      "corsy",
    );
    expect(
      equivalentOf("armanni", "Cortex", mergeEquivalents(mine, theirs)),
    ).toBe("corsy");
  });

  it("fills in a side a person never answered for", () => {
    expect(
      equivalentOf("armsolar", "Legion", mergeEquivalents(learned, theirs)),
    ).toBe("legsolar");
  });

  it("leaves a group two of a person's own groups both claim", () => {
    const mine: EquivalenceTable = {
      groups: [
        { Armada: { def: "armsolar" }, Cortex: { def: "corsy" } },
        { Legion: { def: "legsolar" }, Cortex: { def: "corak" } },
      ],
    };
    const merged = mergeEquivalents(mine, theirs).groups;
    expect(merged[0]).toEqual(mine.groups[0]);
    expect(merged[1]).toEqual(mine.groups[1]);
  });

  it("changes nothing the second time, so reading it again is free", () => {
    const once = mergeEquivalents(learned, theirs);
    expect(mergeEquivalents(once, theirs)).toBe(once);
  });

  it("takes nothing from a game that shipped nothing", () => {
    expect(mergeEquivalents(learned, NO_EQUIVALENTS)).toBe(learned);
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

/**
 * Issue #1537. Which answers a person gave and which a game's file brought, so
 * somebody hunting a wrong one knows whose it is before they drop it.
 */
describe("where a pairing came from", () => {
  const fromGame: EquivalenceTable = {
    groups: [
      {
        Armada: { def: "armsolar", from: "game" },
        Cortex: { def: "corsolar", from: "game" },
        Legion: { def: "legsolar", from: "game" },
      },
      {
        Armada: { def: "armanni", from: "game" },
        Cortex: { def: "cordoom", from: "game" },
      },
    ],
  };

  it("marks a pair a person picked as theirs, on both sides of it", () => {
    expect(sourceIn(learned.groups[1], "Armada")).toBe("you");
    expect(sourceIn(learned.groups[1], "Cortex")).toBe("you");
  });

  it("marks a group only a game's file knows about as the game's", () => {
    const merged = mergeEquivalents(learned, fromGame);
    const anni = merged.groups.find((group) => group.Armada?.def === "armanni");
    expect(sourceIn(anni ?? {}, "Cortex")).toBe("game");
  });

  it("keeps a person's mark on the side they answered when a game fills the rest", () => {
    const merged = mergeEquivalents(learned, fromGame);
    expect(sourceIn(merged.groups[0], "Armada")).toBe("you");
    expect(sourceIn(merged.groups[0], "Cortex")).toBe("you");
    expect(sourceIn(merged.groups[0], "Legion")).toBe("game");
  });

  it("takes a person's correction of a game's answer as theirs", () => {
    const merged = mergeEquivalents(NO_EQUIVALENTS, fromGame);
    const fixed = learnEquivalence(
      merged,
      "Armada",
      "armanni",
      "Cortex",
      "corsy",
    );
    expect(equivalentOf("armanni", "Cortex", fixed)).toBe("corsy");
    expect(sourceIn(fixed.groups[1], "Cortex")).toBe("you");
  });

  it("says nothing about a side a group has no answer for", () => {
    expect(sourceIn(learned.groups[1], "Legion")).toBeUndefined();
  });

  it("holds a game with a side called source, because a source is not a key beside one", () => {
    const odd = learnEquivalence(
      NO_EQUIVALENTS,
      "source",
      "srcpw",
      "from",
      "frompw",
    );
    expect(equivalentOf("srcpw", "from", odd)).toBe("frompw");
    expect(sourceIn(odd.groups[0], "source")).toBe("you");
  });

  it("reads a table an older coilbox stored, as a source nobody can name now", () => {
    const old = parseEquivalenceTable({
      groups: [{ Armada: "armsolar", Cortex: "corsolar" }],
    });
    expect(equivalentOf("armsolar", "Cortex", old)).toBe("corsolar");
    expect(sourceIn(old.groups[0], "Armada")).toBeUndefined();
  });

  it("reads back a source it wrote", () => {
    const written = JSON.parse(JSON.stringify(learned));
    expect(sourceIn(parseEquivalenceTable(written).groups[0], "Armada")).toBe(
      "you",
    );
  });

  it("keeps the def but drops a source that is not one it writes", () => {
    const odd = parseEquivalenceTable({
      groups: [
        {
          Armada: { def: "armsolar", from: "somebody" },
          Cortex: { def: "corsolar", from: 7 },
        },
      ],
    });
    expect(equivalentOf("armsolar", "Cortex", odd)).toBe("corsolar");
    expect(sourceIn(odd.groups[0], "Armada")).toBeUndefined();
    expect(sourceIn(odd.groups[0], "Cortex")).toBeUndefined();
  });
});
