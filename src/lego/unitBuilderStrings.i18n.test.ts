/**
 * Issue #4603: the unit builder's non-component text comes out of the Lingui
 * catalog at the time it is read. The catalog here is a fixture, not a real
 * translation. It renames two strings so a translated one can be told from the
 * English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { afterEach, describe, expect, it } from "vitest";
import type { UnitCheckReport } from "@/content/bindings";
import { ROLES } from "./animPresets";
import { PROBLEM_SOURCES } from "./problems";
import { describeCheck, describeOtherErrors } from "./unitCheck";

const fixture = {
  [msg`Body`.id]: "Fixture body",
  [msg`The check was stopped.`.id]: "Fixture stopped",
};

afterEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function otherErrors(count: number): UnitCheckReport {
  return { otherErrors: count } as unknown as UnitCheckReport;
}

describe("the unit builder's text", () => {
  it("reads a table label in the language active when it is read", () => {
    const role = ROLES.find((r) => r.id === "base");
    expect(role?.label).toBe("Body");
    i18n.loadAndActivate({ locale: "fr", messages: fixture });
    expect(role?.label).toBe("Fixture body");
    expect(PROBLEM_SOURCES[0].label).toBe("Pieces");
  });

  it("translates a message built in a function", () => {
    const report = {
      outcome: "unfinished",
      exit: { cancelled: true, timedOut: false, signal: null, code: null },
    } as unknown as UnitCheckReport;
    expect(describeCheck(report, "unit")).toBe("The check was stopped.");
    i18n.loadAndActivate({ locale: "fr", messages: fixture });
    expect(describeCheck(report, "unit")).toBe("Fixture stopped");
  });

  it("picks the plural form for 1 and for 3", () => {
    expect(describeOtherErrors(otherErrors(1))).toBe(
      "1 other error in the log is not about this unit.",
    );
    expect(describeOtherErrors(otherErrors(3))).toBe(
      "3 other errors in the log are not about this unit.",
    );
  });
});
