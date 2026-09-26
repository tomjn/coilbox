import { describe, expect, it } from "vitest";
import {
  applyBatchOperation,
  applyBatchRounding,
  applyBatchRows,
  batchChangeCount,
  computeBatchRows,
} from "./batchEdit";

describe("applyBatchOperation", () => {
  it("multiplies", () => {
    expect(applyBatchOperation(200, { kind: "multiply", factor: 0.9 })).toBe(
      180,
    );
  });

  it("offsets", () => {
    expect(applyBatchOperation(200, { kind: "offset", amount: -20 })).toBe(180);
  });

  it("drops floating point noise from a percentage change (issue #3113)", () => {
    // 340 * 1.1 is 374.00000000000006 in a double, which would be written
    // into the project and the game's Lua as is.
    expect(applyBatchOperation(340, { kind: "multiply", factor: 1.1 })).toBe(
      374,
    );
    expect(applyBatchOperation(0.1, { kind: "offset", amount: 0.2 })).toBe(0.3);
  });

  it("sets a value outright (issue #3113)", () => {
    expect(applyBatchOperation(200, { kind: "set", value: 75 })).toBe(75);
  });
});

describe("applyBatchRounding", () => {
  it("leaves the value alone for none", () => {
    expect(applyBatchRounding(47.3, { kind: "none" })).toBe(47.3);
  });

  it("rounds to the nearest whole number", () => {
    expect(applyBatchRounding(47.6, { kind: "integer" })).toBe(48);
  });

  it("rounds to the nearest multiple of a step", () => {
    expect(applyBatchRounding(47, { kind: "nearest", step: 5 })).toBe(45);
    expect(applyBatchRounding(48, { kind: "nearest", step: 5 })).toBe(50);
  });

  it("leaves the value alone for a non-positive step", () => {
    expect(applyBatchRounding(47, { kind: "nearest", step: 0 })).toBe(47);
    expect(applyBatchRounding(47, { kind: "nearest", step: -5 })).toBe(47);
  });
});

describe("computeBatchRows", () => {
  const units = {
    armcom: { metalCost: 900 },
    armflash: { metalCost: 50 },
    armpw: { name: "peewee" }, // no metalCost at all
    armstring: { metalCost: "cheap" }, // present but not numeric
  };

  it("reads the def's value when there is no override", () => {
    const rows = computeBatchRows(
      ["armcom"],
      ["metalCost"],
      units,
      {},
      { kind: "multiply", factor: 0.5 },
      { kind: "none" },
    );
    expect(rows).toEqual([
      {
        unit: "armcom",
        before: 900,
        after: 450,
        path: "metalCost",
        changed: true,
      },
    ]);
  });

  it("reads an override written under the def's own lowercase key", () => {
    // A game like Balanced Annihilation declares `maxdamage`, and the first
    // batch writes its override under that spelling. A second batch has to
    // start from that override, not from the game's number underneath it.
    const rows = computeBatchRows(
      ["armpw"],
      ["health", "maxDamage"],
      { armpw: { maxdamage: 300 } },
      { armpw: { maxdamage: 330 } },
      { kind: "multiply", factor: 2 },
      { kind: "none" },
    );
    expect(rows[0]).toMatchObject({
      before: 330,
      after: 660,
      path: "maxdamage",
    });
  });

  it("prefers an existing override to the def's own value", () => {
    const rows = computeBatchRows(
      ["armcom"],
      ["metalCost"],
      units,
      { armcom: { metalCost: 500 } },
      { kind: "offset", amount: 10 },
      { kind: "none" },
    );
    expect(rows[0]).toMatchObject({ before: 500, after: 510, changed: true });
  });

  it("skips a unit with no candidate key at all, as missing", () => {
    const rows = computeBatchRows(
      ["armpw"],
      ["metalCost"],
      units,
      {},
      { kind: "multiply", factor: 2 },
      { kind: "none" },
    );
    expect(rows).toEqual([
      { unit: "armpw", skipped: "missing", changed: false },
    ]);
  });

  it("skips a unit whose value is present but not numeric", () => {
    const rows = computeBatchRows(
      ["armstring"],
      ["metalCost"],
      units,
      {},
      { kind: "multiply", factor: 2 },
      { kind: "none" },
    );
    expect(rows).toEqual([
      { unit: "armstring", skipped: "not-numeric", changed: false },
    ]);
  });

  it("resolves a case-insensitive def key, and the second candidate when the first is absent", () => {
    const rows = computeBatchRows(
      ["armflash"],
      ["buildCostMetal", "METALCOST"],
      units,
      {},
      { kind: "offset", amount: 1 },
      { kind: "none" },
    );
    expect(rows[0]).toMatchObject({ before: 50, after: 51, path: "metalCost" });
  });

  it("marks a row unchanged rather than dropping it, when the operation lands back on the same value", () => {
    const rows = computeBatchRows(
      ["armcom"],
      ["metalCost"],
      units,
      {},
      { kind: "multiply", factor: 1 },
      { kind: "none" },
    );
    expect(rows[0]).toMatchObject({ before: 900, after: 900, changed: false });
  });
});

describe("batchChangeCount", () => {
  it("counts only the rows that would change", () => {
    const rows = computeBatchRows(
      ["armcom", "armflash", "armpw"],
      ["metalCost"],
      {
        armcom: { metalCost: 900 },
        armflash: { metalCost: 50 },
        armpw: {},
      },
      {},
      { kind: "multiply", factor: 1 },
      { kind: "none" },
    );
    expect(batchChangeCount(rows)).toBe(0);
    expect(
      batchChangeCount(
        computeBatchRows(
          ["armcom", "armflash", "armpw"],
          ["metalCost"],
          {
            armcom: { metalCost: 900 },
            armflash: { metalCost: 50 },
            armpw: {},
          },
          {},
          { kind: "multiply", factor: 2 },
          { kind: "none" },
        ),
      ),
    ).toBe(2);
  });
});

describe("applyBatchRows", () => {
  const units = {
    armcom: { metalCost: 900 },
    armflash: { metalCost: 50 },
  };

  it("writes a changed row as an override", () => {
    const rows = computeBatchRows(
      ["armcom"],
      ["metalCost"],
      units,
      {},
      { kind: "multiply", factor: 0.5 },
      { kind: "none" },
    );
    const next = applyBatchRows({}, rows, units);
    expect(next).toEqual({ armcom: { metalCost: 450 } });
  });

  it("drops an override back to nothing when the batch lands it back on the inherited value", () => {
    const rows = computeBatchRows(
      ["armcom"],
      ["metalCost"],
      units,
      { armcom: { metalCost: 100 } },
      { kind: "offset", amount: 800 },
      { kind: "none" },
    );
    const next = applyBatchRows({ armcom: { metalCost: 100 } }, rows, units);
    expect(next).toEqual({});
  });

  it("leaves skipped and unchanged rows alone", () => {
    const rows = computeBatchRows(
      ["armcom", "armflash"],
      ["metalCost"],
      units,
      {},
      { kind: "multiply", factor: 1 },
      { kind: "none" },
    );
    expect(applyBatchRows({}, rows, units)).toEqual({});
  });

  it("applies several units in one pass", () => {
    const rows = computeBatchRows(
      ["armcom", "armflash"],
      ["metalCost"],
      units,
      {},
      { kind: "offset", amount: -10 },
      { kind: "none" },
    );
    expect(applyBatchRows({}, rows, units)).toEqual({
      armcom: { metalCost: 890 },
      armflash: { metalCost: 40 },
    });
  });
});
