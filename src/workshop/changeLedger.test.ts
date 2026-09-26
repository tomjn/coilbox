/**
 * The pure regrouping this module adds on top of the Rust trace
 * (`ledger.rs`, tested there). Which unit carries which change is not
 * re-tested here. This covers only `ledgerByOutput`'s pivot from that
 * answer to "what is in this file or this BAR slot" (see its own doc
 * comment for why the ledger needs both directions).
 */
import { describe, expect, it } from "vitest";
import type { ChangeLedger, LedgerChange } from "./changeLedger";
import { ledgerByOutput } from "./changeLedger";

function change(over: Partial<LedgerChange> = {}): LedgerChange {
  return {
    description: "Field change: maxDamage",
    fieldPath: "maxDamage",
    files: ["gamedata/unitdefs_post.lua"],
    tweakSlot: null,
    tweakMiss: null,
    uncompiledReason: null,
    ...over,
  };
}

describe("ledgerByOutput", () => {
  it("groups two units' changes under the one file they share", () => {
    const ledger: ChangeLedger = {
      units: [
        { unit: "armflash", changes: [change()] },
        { unit: "armrock", changes: [change({ description: "Switched off" })] },
      ],
      notes: [],
    };
    const rows = ledgerByOutput(ledger);
    const fileRow = rows.find((r) => r.label === "gamedata/unitdefs_post.lua");
    expect(fileRow?.entries.map((e) => e.unit)).toEqual([
      "armflash",
      "armrock",
    ]);
  });

  it("lists a change under both its file and its BAR slot", () => {
    const ledger: ChangeLedger = {
      units: [
        {
          unit: "armcom",
          changes: [
            change({
              tweakSlot: { kind: "tweakdefs", label: "tweakdefs" },
            }),
          ],
        },
      ],
      notes: [],
    };
    const rows = ledgerByOutput(ledger);
    expect(rows.map((r) => r.label).sort()).toEqual([
      "!bset tweakdefs",
      "gamedata/unitdefs_post.lua",
    ]);
  });

  it("splits one unit's changes across two rows when they land in two slots", () => {
    const ledger: ChangeLedger = {
      units: [
        {
          unit: "armlab",
          changes: [
            change({
              description: "Field change: maxDamage",
              tweakSlot: { kind: "tweakdefs", label: "tweakdefs1" },
            }),
            change({
              description: "Build menu: added armpw",
              fieldPath: null,
              tweakSlot: { kind: "tweakdefs", label: "tweakdefs" },
            }),
          ],
        },
      ],
      notes: [],
    };
    const rows = ledgerByOutput(ledger);
    const defsRow = rows.find((r) => r.label === "!bset tweakdefs");
    const secondRow = rows.find((r) => r.label === "!bset tweakdefs1");
    expect(defsRow?.entries).toHaveLength(1);
    expect(secondRow?.entries).toHaveLength(1);
    expect(defsRow?.entries[0].change.description).toBe(
      "Build menu: added armpw",
    );
    expect(secondRow?.entries[0].change.description).toBe(
      "Field change: maxDamage",
    );
  });

  it("leaves a change with no output out of the by-output view entirely", () => {
    const ledger: ChangeLedger = {
      units: [
        {
          unit: "armcom",
          changes: [
            change({
              files: [],
              fieldPath: null,
              description: "Name (en): Commander",
              uncompiledReason: "Not compiled.",
            }),
          ],
        },
      ],
      notes: [],
    };
    expect(ledgerByOutput(ledger)).toEqual([]);
  });
});
