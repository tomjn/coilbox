import { describe, expect, it } from "vitest";

import type { UnitCheckReport } from "@/content/bindings";

import { describeCheck, describeMove, describeOtherErrors } from "./unitCheck";

function unfinished(exit: Partial<UnitCheckReport["exit"]>): UnitCheckReport {
  return {
    outcome: "unfinished",
    spawnedPieces: 5,
    doneFrame: null,
    movedElmos: null,
    moveClass: null,
    problems: [],
    warnings: [],
    fatal: [],
    otherErrors: 0,
    exit: {
      code: null,
      signal: null,
      timedOut: false,
      cancelled: false,
      wallSeconds: 1,
      ...exit,
    },
    logPath: "/log",
  };
}

describe("describeCheck for a check that did not finish", () => {
  it("says it was stopped before anything else, because the kill is its own", () => {
    expect(
      describeCheck(unfinished({ cancelled: true, signal: 9 }), "probe_unit"),
    ).toBe("The check was stopped.");
  });

  it("says the engine ran out of time", () => {
    expect(
      describeCheck(unfinished({ timedOut: true, signal: 9 }), "probe_unit"),
    ).toBe("The engine ran out of time and was stopped.");
  });

  it("names the signal of a crash and the code of an exit", () => {
    expect(describeCheck(unfinished({ signal: 11 }), "probe_unit")).toBe(
      "The engine crashed with signal 11 before the check finished.",
    );
    expect(describeCheck(unfinished({ code: 1 }), "probe_unit")).toBe(
      "The engine stopped with code 1 before the check finished.",
    );
  });
});

describe("describeOtherErrors", () => {
  it("says nothing when every error was about the unit", () => {
    expect(describeOtherErrors(unfinished({}))).toBeNull();
  });

  it("counts one and many", () => {
    expect(describeOtherErrors({ ...unfinished({}), otherErrors: 1 })).toBe(
      "1 other error in the log is not about this unit.",
    );
  });
});

describe("describeMove", () => {
  it("says nothing for a unit with no move class", () => {
    expect(describeMove(unfinished({}))).toBeNull();
  });

  it("says how far it drove and on which class", () => {
    expect(
      describeMove({
        ...unfinished({}),
        movedElmos: 212,
        moveClass: "wheeledtank2",
      }),
    ).toBe("Moved 212 elmos on wheeledtank2 when ordered to.");
  });
});
