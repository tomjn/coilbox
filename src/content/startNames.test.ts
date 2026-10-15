import { describe, expect, it } from "vitest";
import type { PlaceRecord } from "./mapRecords";
import {
  resolveNames,
  type StoredName,
  startRows,
  tidyName,
  withNames,
  withoutName,
} from "./startNames";

const SCALE = 100;
const cluster = (key: string, x: number, z: number) => ({
  key,
  kind: "cluster" as const,
  x,
  z,
});
const declared = (n: number, x: number, z: number) => ({
  key: `d${n}`,
  kind: "declared" as const,
  x,
  z,
});
const name = (key: string, text: string, x = 0, z = 0): StoredName => ({
  key,
  name: text,
  x,
  z,
});

describe("finding a stored name again", () => {
  it("finds a name by the position's key", () => {
    const stored = [name("d2", "Hill"), name("c3:7", "Front", 350, 750)];
    const got = resolveNames(
      stored,
      [declared(1, 0, 0), declared(2, 500, 500), cluster("c3:7", 350, 750)],
      SCALE,
    );
    expect(got.byPlace.get("d2")?.name).toBe("Hill");
    expect(got.byPlace.get("c3:7")?.name).toBe("Front");
    expect(got.byPlace.has("d1")).toBe(false);
    expect(got.orphans).toEqual([]);
  });

  it("finds a group by the nearest centre when its key has moved", () => {
    const stored = [name("c3:7", "Front", 395, 750)];
    const got = resolveNames(stored, [cluster("c4:7", 410, 760)], SCALE);
    expect(got.byPlace.get("c4:7")?.name).toBe("Front");
    expect(got.orphans).toEqual([]);
  });

  it("keeps a name as an orphan when no group is within the grouping distance", () => {
    const stored = [name("c3:7", "Front", 300, 750)];
    const got = resolveNames(stored, [cluster("c9:9", 900, 900)], SCALE);
    expect(got.byPlace.size).toBe(0);
    expect(got.orphans).toEqual(stored);
  });

  it("keeps a name for a position nobody started on as an orphan", () => {
    const stored = [name("d4", "Island")];
    const got = resolveNames(stored, [declared(1, 0, 0)], SCALE);
    expect(got.orphans).toEqual(stored);
  });

  it("never gives a declared position's name to a group, or a group's to a declared position", () => {
    const stored = [
      name("d4", "Island", 100, 100),
      name("c1:1", "Pond", 100, 100),
    ];
    const got = resolveNames(
      stored,
      [declared(1, 100, 100), cluster("c2:2", 110, 110)],
      SCALE,
    );
    expect(got.byPlace.has("d1")).toBe(false);
    expect(got.byPlace.get("c2:2")?.name).toBe("Pond");
    expect(got.orphans.map((e) => e.name)).toEqual(["Island"]);
  });

  it("takes the key before a nearer centre", () => {
    const exact = name("c1:1", "Exact", 0, 0);
    const near = name("c5:5", "Near", 105, 105);
    const got = resolveNames([near, exact], [cluster("c1:1", 100, 100)], SCALE);
    expect(got.byPlace.get("c1:1")).toBe(exact);
    expect(got.orphans).toEqual([near]);
  });

  it("gives a group to the nearer of two stored names and orphans the other", () => {
    const far = name("c8:8", "Far", 160, 100);
    const near = name("c9:9", "Near", 110, 100);
    const got = resolveNames([far, near], [cluster("c1:1", 100, 100)], SCALE);
    expect(got.byPlace.get("c1:1")).toBe(near);
    expect(got.orphans).toEqual([far]);
  });

  it("does not look by centre on a map with no size", () => {
    const stored = [name("c3:7", "Front", 400, 750)];
    const got = resolveNames(stored, [cluster("c4:7", 410, 760)], null);
    expect(got.orphans).toEqual(stored);
  });

  it("gives the same answer whatever order the names are stored in", () => {
    const a = name("c8:8", "A", 100, 100);
    const b = name("c9:9", "B", 100, 100);
    const places = [cluster("c1:1", 100, 100)];
    expect(resolveNames([a, b], places, SCALE).byPlace.get("c1:1")?.name).toBe(
      resolveNames([b, a], places, SCALE).byPlace.get("c1:1")?.name,
    );
  });
});

describe("naming, renaming and clearing", () => {
  const places = [declared(1, 0, 0), cluster("c3:7", 350, 750)];
  const none = resolveNames([], places, SCALE);

  it("stores a name with the key and centre the position has now", () => {
    expect(withNames([], none, [places[1]], "  Front  ")).toEqual([
      { key: "c3:7", name: "Front", x: 350, z: 750 },
    ]);
  });

  it("keeps the name as typed, without folding case or markup", () => {
    expect(tidyName(" <b>Back</b> door ")).toBe("<b>Back</b> door");
  });

  it("renames in place and does not leave the old name behind", () => {
    const first = withNames([], none, [places[1]], "Front");
    const second = withNames(
      first,
      resolveNames(first, places, SCALE),
      [places[1]],
      "Ridge",
    );
    expect(second.map((e) => e.name)).toEqual(["Ridge"]);
  });

  it("clears a name when it is empty once trimmed", () => {
    const first = withNames([], none, [places[0], places[1]], "Front");
    const resolved = resolveNames(first, places, SCALE);
    expect(
      withNames(first, resolved, [places[1]], "   ").map((e) => e.key),
    ).toEqual(["d1"]);
    expect(withNames(first, resolved, [places[0], places[1]], "")).toEqual([]);
  });

  it("moves a name found by nearest centre onto the new key when it is renamed", () => {
    const stored = [name("c3:7", "Front", 340, 750)];
    const moved = [cluster("c4:7", 410, 760)];
    const next = withNames(
      stored,
      resolveNames(stored, moved, SCALE),
      moved,
      "Front 2",
    );
    expect(next).toEqual([{ key: "c4:7", name: "Front 2", x: 410, z: 760 }]);
  });

  it("leaves an orphan alone when another position is renamed", () => {
    const orphan = name("c9:9", "Gone", 900, 900);
    const resolved = resolveNames([orphan], places, SCALE);
    const next = withNames([orphan], resolved, [places[0]], "Hill");
    expect(next.map((e) => e.name)).toEqual(["Gone", "Hill"]);
  });

  it("deletes an orphan, and only that one", () => {
    const a = name("c9:9", "Gone", 900, 900);
    const b = name("d1", "Hill");
    expect(withoutName([a, b], a)).toEqual([b]);
  });
});

describe("positions that share a name", () => {
  const record = (
    key: string,
    number: number,
    taken: number,
    won: number,
  ): PlaceRecord => ({
    place: {
      key,
      kind: key.startsWith("d") ? "declared" : "cluster",
      number,
      x: number * 100,
      z: 0,
      radius: 0,
    },
    taken,
    known: taken,
    won,
    sides: [
      { taken, known: taken, won },
      { taken: 0, known: 0, won: 0 },
    ],
    byAi: 1,
  });
  const places = [
    record("d1", 1, 5, 3),
    record("c2:2", 3, 3, 1),
    record("d2", 2, 2, 0),
  ];

  it("shows every position as its own row with no names", () => {
    expect(startRows(places, new Map()).map((r) => r.number)).toEqual([
      1, 3, 2,
    ]);
  });

  it("makes one row of positions with one name, adding their counts", () => {
    const rows = startRows(
      places,
      new Map([
        ["c2:2", "Back"],
        ["d2", "back"],
      ]),
    );
    expect(rows.map((r) => [r.number, r.name, r.taken, r.won])).toEqual([
      [1, null, 5, 3],
      [3, "Back", 5, 1],
    ]);
    const back = rows[1];
    expect(back.places.map((p) => p.key)).toEqual(["c2:2", "d2"]);
    expect(back.sides[0]).toEqual({ taken: 5, known: 5, won: 1 });
    expect(back.byAi).toBe(2);
  });

  it("does not change the positions it is given", () => {
    startRows(
      places,
      new Map([
        ["c2:2", "Back"],
        ["d2", "Back"],
      ]),
    );
    expect(places[1].taken).toBe(3);
    expect(places[1].sides[0].taken).toBe(3);
  });
});
