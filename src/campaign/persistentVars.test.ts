import { describe, expect, it } from "vitest";
import { newScenario } from "../scenario/create";
import type { Scenario } from "../scenario/model";
import type { ProgressFile } from "./model";
import { launchVars, returnedVars, savedVars } from "./persistentVars";

/** Issue #5294. */

function scenario(): Scenario {
  return {
    ...newScenario("Carry"),
    vars: { rescued: 0, wave: 0 },
    persistentVars: ["rescued"],
  };
}

const file: ProgressFile = {
  schemaVersion: 1,
  campaigns: {
    c: {
      completedMissionIds: [],
      updatedAt: "",
      vars: { rescued: 3, wave: 7, odd: "x" as unknown as number },
    },
  },
};

describe("savedVars", () => {
  it("keeps only finite numbers", () => {
    expect(savedVars(file, "c")).toEqual({ rescued: 3, wave: 7 });
  });

  it("is empty for a campaign never played", () => {
    expect(savedVars(file, "other")).toEqual({});
  });
});

describe("launchVars", () => {
  it("hands over the saved value of each persistent var only", () => {
    expect(launchVars(scenario(), file, "c", "tok")).toEqual({
      run: "tok",
      values: { rescued: 3 },
    });
  });

  it("is undefined for a scenario that marks nothing", () => {
    expect(
      launchVars({ ...scenario(), persistentVars: undefined }, file, "c", "t"),
    ).toBeUndefined();
  });

  it("hands over no values before anything is saved", () => {
    expect(launchVars(scenario(), file, "new", "t")?.values).toEqual({});
  });
});

describe("returnedVars", () => {
  const json = (value: unknown) => JSON.stringify(value);

  it("reads this launch's persistent vars", () => {
    expect(
      returnedVars(
        json({ run: "tok", vars: { rescued: 5, wave: 2 } }),
        "tok",
        scenario(),
      ),
    ).toEqual({ rescued: 5 });
  });

  it("refuses another launch's file", () => {
    expect(
      returnedVars(
        json({ run: "old", vars: { rescued: 5 } }),
        "tok",
        scenario(),
      ),
    ).toBeNull();
  });

  it("refuses a file that is not JSON", () => {
    expect(returnedVars("{", "tok", scenario())).toBeNull();
  });

  it("drops a value that is not a number", () => {
    expect(
      returnedVars(
        json({ run: "tok", vars: { rescued: "5" } }),
        "tok",
        scenario(),
      ),
    ).toEqual({});
  });
});
