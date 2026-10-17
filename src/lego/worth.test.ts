import { describe, expect, it } from "vitest";

import { type LegoPiece, type LegoProject, newProject } from "./model";
import type { LegoPartInfo } from "./pack";
import {
  type LegoWorth,
  PLACEHOLDER_WORTH,
  parseWorth,
  worthTotals,
} from "./worth";

function part(
  id: string,
  shape: string,
  size: [number, number, number],
): LegoPartInfo {
  return {
    id,
    shape,
    bbox: {
      min: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
      max: [size[0] / 2, size[1] / 2, size[2] / 2],
    },
  } as LegoPartInfo;
}

const pack = {
  byId: new Map<string, LegoPartInfo>([
    ["block", part("block", "block", [2, 2, 2])],
    ["beam", part("beam", "beam", [1, 1, 4])],
  ]),
};

function piece(over: Partial<LegoPiece> & { id: string }): LegoPiece {
  return {
    name: over.id,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    ...over,
  };
}

function unit(pieces: LegoPiece[], worth?: LegoWorth): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "Test",
    packId: "lego",
    packVersion: "1",
    now: "2026-10-17T00:00:00Z",
  });
  return { ...base, pieces: [...base.pieces, ...pieces], worth };
}

const zero = { health: 0, metal: 0, energy: 0, buildTime: 0, mass: 0 };

const table: LegoWorth = {
  base: { health: 100, metal: 10, energy: 4, buildTime: 20, mass: 1 },
  perVolume: { health: 10, metal: 2, energy: 1, buildTime: 3, mass: 0.5 },
};

describe("worthTotals", () => {
  it("is the flat amount for a unit with no parts", () => {
    expect(worthTotals(unit([], table), pack)).toEqual({
      health: 100,
      metal: 10,
      energy: 4,
      buildTime: 20,
      mass: 1,
    });
  });

  it("adds the per volume rate times each part's volume", () => {
    // One 2 by 2 by 2 block: volume 8.
    const totals = worthTotals(
      unit([piece({ id: "a", partId: "block" })], table),
      pack,
    );
    expect(totals).toEqual({
      health: 180,
      metal: 26,
      energy: 12,
      buildTime: 44,
      mass: 5,
    });
  });

  it("does not change when a part moves or turns", () => {
    const at = (position: [number, number, number]) =>
      worthTotals(
        unit(
          [piece({ id: "a", partId: "block", position, rotation: [1, 2, 3] })],
          table,
        ),
        pack,
      );
    expect(at([50, 0, 0])).toEqual(at([0, 0, 0]));
  });

  it("grows with a part's scale, and a mirror counts as the same size", () => {
    const scaled = worthTotals(
      unit([piece({ id: "a", partId: "block", scale: [2, 1, 1] })], table),
      pack,
    );
    // Volume 16.
    expect(scaled?.health).toBe(100 + 160);
    const mirrored = worthTotals(
      unit([piece({ id: "a", partId: "block", scale: [-2, 1, 1] })], table),
      pack,
    );
    expect(mirrored).toEqual(scaled);
  });

  it("takes a parent's scale into account", () => {
    const totals = worthTotals(
      unit(
        [
          piece({ id: "arm", scale: [1, 3, 1] }),
          piece({ id: "a", parentId: "arm", partId: "block" }),
        ],
        table,
      ),
      pack,
    );
    // Volume 24.
    expect(totals?.health).toBe(100 + 240);
  });

  it("counts an empty piece as worth nothing", () => {
    expect(worthTotals(unit([piece({ id: "flare" })], table), pack)).toEqual(
      worthTotals(unit([], table), pack),
    );
  });

  it("lets a shape replace the per volume rate for the fields it names", () => {
    const withBeam: LegoWorth = {
      ...table,
      shapes: { beam: { health: 100 } },
    };
    // The beam is 1 by 1 by 4, volume 4. Health uses 100 a volume, the rest
    // fall back to the per volume rate.
    const totals = worthTotals(
      unit([piece({ id: "a", partId: "beam" })], withBeam),
      pack,
    );
    expect(totals).toMatchObject({ health: 100 + 400, metal: 10 + 8 });
  });

  it("is null for an imported unit, which has no parts to total", () => {
    const imported = {
      ...unit([piece({ id: "a", meshId: "m" })], table),
      imported: {} as LegoProject["imported"],
    };
    expect(worthTotals(imported, pack)).toBeNull();
  });

  it("rounds, and keeps health and build time above zero for the engine", () => {
    const tiny: LegoWorth = { base: zero, perVolume: zero };
    const totals = worthTotals(unit([], tiny), pack);
    expect(totals).toEqual({
      health: 1,
      metal: 0,
      energy: 0,
      buildTime: 1,
      mass: 0,
    });
    const fractional: LegoWorth = {
      base: { ...zero, health: 10.4, metal: 2.5 },
      perVolume: zero,
    };
    expect(worthTotals(unit([], fractional), pack)).toMatchObject({
      health: 10,
      metal: 3,
    });
  });

  it("uses the placeholder table when the unit has none", () => {
    expect(worthTotals(unit([]), pack)).toEqual(
      worthTotals(unit([], PLACEHOLDER_WORTH), pack),
    );
  });

  it("skips a part the pack no longer has", () => {
    expect(
      worthTotals(unit([piece({ id: "a", partId: "gone" })], table), pack),
    ).toEqual(worthTotals(unit([], table), pack));
  });

  it("survives a parent loop", () => {
    const totals = worthTotals(
      unit(
        [
          piece({ id: "a", parentId: "b", partId: "block" }),
          piece({ id: "b", parentId: "a" }),
        ],
        table,
      ),
      pack,
    );
    expect(totals?.health).toBeGreaterThan(0);
  });
});

describe("parseWorth", () => {
  it("round trips a table", () => {
    const withShape: LegoWorth = {
      ...table,
      shapes: { beam: { health: 5 } },
    };
    expect(parseWorth(JSON.parse(JSON.stringify(withShape)))).toEqual(
      withShape,
    );
  });

  it("drops what is not a table", () => {
    expect(parseWorth(undefined)).toBeNull();
    expect(parseWorth("x")).toBeNull();
    expect(parseWorth({})).toBeNull();
  });

  it("fills a missing amount with zero and drops negative or non finite ones", () => {
    const parsed = parseWorth({
      base: { health: 5, metal: -3, energy: "x", mass: Number.NaN },
      perVolume: { health: 1 },
      shapes: { beam: { health: -1, metal: 2 }, junk: 7 },
    });
    expect(parsed).toEqual({
      base: { health: 5, metal: 0, energy: 0, buildTime: 0, mass: 0 },
      perVolume: { health: 1, metal: 0, energy: 0, buildTime: 0, mass: 0 },
      shapes: { beam: { metal: 2 } },
    });
  });
});
