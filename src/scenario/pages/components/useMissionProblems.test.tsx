// @vitest-environment happy-dom
/**
 * The two things issue #2162 asks of the editor's validation: that it waits for
 * the typing to stop, and that it says which problems stop the mission playing.
 *
 * No browser and no engine. The validator runs on the document itself, so a
 * scenario built here is the whole input.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// validate.ts reaches the plugin through bindings.ts, whose plugin-sdk import
// Vitest's node resolver cannot load from the published dist. Stubbed the way
// validate.test.ts stubs it. Nothing here reads a compiled mission back.
vi.mock("../../bindings", () => ({
  scenarioReadMission: vi.fn(),
  scenarioEvalMission: vi.fn(),
}));

import { newScenario } from "../../create";
import type { Scenario } from "../../model";
import {
  missionProblemsIn,
  PROBLEM_DEBOUNCE_MS,
  useMissionProblems,
} from "./useMissionProblems";

/** A scenario whose one trigger watches a zone that is not in the document. */
function pointsAtAMissingZone(): Scenario {
  return {
    ...newScenario("Broken"),
    triggers: [
      {
        id: "open",
        enabled: true,
        repeat: false,
        conditions: {
          op: "all",
          conditions: [{ type: "units_in_zone", params: { zone: "deleted" } }],
        },
        actions: [],
      },
    ],
  };
}

describe("splitting what is wrong with a mission", () => {
  it("says a reference that does not resolve stops the mission playing", () => {
    const problems = missionProblemsIn(pointsAtAMissingZone());

    expect(problems.blocking).toHaveLength(1);
    expect(problems.blocking[0].message).toContain('no zone called "deleted"');
    expect(problems.warnings).toEqual([]);
  });

  it("keeps an objective nobody has written yet out of what blocks a launch", () => {
    const scenario: Scenario = {
      ...newScenario("Unwritten"),
      objectives: [{ id: "first", kind: "primary", text: "", hidden: false }],
    };

    const problems = missionProblemsIn(scenario);

    expect(problems.blocking).toEqual([]);
    expect(problems.warnings).toHaveLength(1);
    expect(problems.warnings[0].path).toContain("objectives");
  });

  it("finds nothing wrong with a scenario that has nothing in it yet", () => {
    expect(missionProblemsIn(newScenario("Empty"))).toEqual({
      blocking: [],
      warnings: [],
    });
  });
});

describe("validating while the author types", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing until the edits stop", () => {
    const { result } = renderHook(() =>
      useMissionProblems(pointsAtAMissingZone()),
    );

    expect(result.current.blocking).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(PROBLEM_DEBOUNCE_MS);
    });

    expect(result.current.blocking).toHaveLength(1);
  });

  it("validates once for a run of edits rather than once each", () => {
    let runs = 0;
    /** A document that counts being validated. The compile step reads
     *  `triggers` once per run, so a getter on it is one count per run. */
    const counted = (name: string): Scenario => {
      const { triggers, ...rest } = pointsAtAMissingZone();
      return Object.defineProperty({ ...rest, name }, "triggers", {
        get() {
          runs += 1;
          return triggers;
        },
      }) as Scenario;
    };

    const { rerender } = renderHook(
      ({ document }: { document: Scenario }) => useMissionProblems(document),
      { initialProps: { document: counted("Broken") } },
    );
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        vi.advanceTimersByTime(PROBLEM_DEBOUNCE_MS / 4);
      });
      rerender({ document: counted(`Broken ${i}`) });
    }

    expect(runs).toBe(0);

    act(() => {
      vi.advanceTimersByTime(PROBLEM_DEBOUNCE_MS);
    });

    expect(runs).toBe(1);
  });

  it("holds the problems it found while nothing about them changes", () => {
    const scenario = pointsAtAMissingZone();
    const { result, rerender } = renderHook(
      ({ document }: { document: Scenario }) => useMissionProblems(document),
      { initialProps: { document: scenario } },
    );
    act(() => {
      vi.advanceTimersByTime(PROBLEM_DEBOUNCE_MS);
    });
    const first = result.current;

    // A fresh object each time, the way the page hands one over on every edit.
    rerender({ document: { ...scenario, name: "Renamed" } });
    act(() => {
      vi.advanceTimersByTime(PROBLEM_DEBOUNCE_MS);
    });

    expect(result.current).toBe(first);
  });

  it("has nothing to say about a scenario that has not loaded", () => {
    const { result } = renderHook(() => useMissionProblems(null));

    act(() => {
      vi.advanceTimersByTime(PROBLEM_DEBOUNCE_MS);
    });

    expect(result.current).toEqual({ blocking: [], warnings: [] });
  });
});
