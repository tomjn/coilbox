// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LimitReadiness } from "../../unitLimit";
import { UnitLimitNote } from "./UnitLimitNote";

afterEach(cleanup);

function renderNote(limit: LimitReadiness, startUnit?: string) {
  render(
    <UnitLimitNote
      limit={limit}
      startUnit={startUnit}
      gameName="Zero-K v1.14.8.0"
    />,
  );
}

describe("UnitLimitNote", () => {
  it("tells a run saved with a placeholder start unit that it has no limit", () => {
    renderNote(
      {
        kind: "ready",
        limit: { kind: "none", reason: "start-unit-not-in-data" },
      },
      "update_your_damn_engine",
    );
    expect(
      screen.getByText(
        "update_your_damn_engine, this run's start unit, is not one of the units in Zero-K v1.14.8.0, so coilbox cannot limit your units. Every unit is available.",
      ),
    ).toBeTruthy();
  });

  it("says nothing for a run that has a limit", () => {
    renderNote({ kind: "ready", limit: { kind: "limited", disabled: ["x"] } });
    expect(screen.queryByText(/cannot limit your units/)).toBeNull();
  });

  it("says nothing while the unit data loads, and nothing when it failed", () => {
    renderNote({ kind: "loading" }, "claw_commander");
    renderNote({ kind: "failed" }, "claw_commander");
    expect(screen.queryByText(/cannot limit your units/)).toBeNull();
  });
});
