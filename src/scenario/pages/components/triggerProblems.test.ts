import { describe, expect, it } from "vitest";
import type { MissionIssue } from "../../validate";
import {
  entryFieldProblem,
  paramProblem,
  triggerFieldProblem,
} from "./triggerProblems";

describe("paramProblem", () => {
  it("finds the issue whose path names exactly this parameter", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].conditions[0].params.zone',
        message: 'no zone called "north"',
      },
    ];

    expect(
      paramProblem(
        issues,
        { triggerId: "open", list: "conditions", index: 0 },
        "zone",
      ),
    ).toBe('no zone called "north"');
  });

  it("finds an issue nested under the parameter, an amount's own var", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].actions[0].params.value.var',
        message: 'no variable called "score"',
      },
    ];

    expect(
      paramProblem(
        issues,
        { triggerId: "open", list: "actions", index: 0 },
        "value",
      ),
    ).toBe('no variable called "score"');
  });

  it("finds an issue nested under an orders parameter's own order", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].actions[0].params.orders[1].target',
        message: 'nothing called "boss" for an order to aim at',
      },
    ];

    expect(
      paramProblem(
        issues,
        { triggerId: "open", list: "actions", index: 0 },
        "orders",
      ),
    ).toBe('nothing called "boss" for an order to aim at');
  });

  it("does not claim a parameter whose name is only a prefix of another's", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].conditions[0].params.group2',
        message: "no group given",
      },
    ];

    expect(
      paramProblem(
        issues,
        { triggerId: "open", list: "conditions", index: 0 },
        "group",
      ),
    ).toBeNull();
  });

  it("does not claim a parameter of a different step or a different trigger", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].conditions[1].params.zone',
        message: "elsewhere",
      },
      {
        path: 'triggers["close"].conditions[0].params.zone',
        message: "elsewhere too",
      },
    ];

    expect(
      paramProblem(
        issues,
        { triggerId: "open", list: "conditions", index: 0 },
        "zone",
      ),
    ).toBeNull();
  });

  it("joins more than one issue on the same parameter into one line", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].conditions[0].params.zone',
        message: "first thing",
      },
      {
        path: 'triggers["open"].conditions[0].params.zone',
        message: "second thing",
      },
    ];

    expect(
      paramProblem(
        issues,
        { triggerId: "open", list: "conditions", index: 0 },
        "zone",
      ),
    ).toBe("first thing second thing");
  });

  it("says nothing when no issue names the parameter", () => {
    expect(
      paramProblem(
        [],
        { triggerId: "open", list: "conditions", index: 0 },
        "zone",
      ),
    ).toBeNull();
  });
});

describe("triggerFieldProblem", () => {
  it("finds the issue at a trigger's own field", () => {
    const issues: MissionIssue[] = [
      {
        path: 'triggers["open"].difficulty',
        message: "it is only there from hard up and only up to easy",
        severity: "warning",
      },
    ];

    expect(triggerFieldProblem(issues, "open", "difficulty")).toBe(
      "it is only there from hard up and only up to easy",
    );
  });

  it("does not claim another trigger's same field", () => {
    const issues: MissionIssue[] = [
      { path: 'triggers["close"].difficulty', message: "elsewhere" },
    ];

    expect(triggerFieldProblem(issues, "open", "difficulty")).toBeNull();
  });
});

describe("entryFieldProblem", () => {
  it("finds the issue at an actor's own team", () => {
    const issues: MissionIssue[] = [
      { path: 'actors["hero"].team', message: 'no team called "ghost"' },
    ];

    expect(entryFieldProblem(issues, "actors", "hero", "team")).toBe(
      'no team called "ghost"',
    );
  });

  it("finds the issue at a group's own difficulty range", () => {
    const issues: MissionIssue[] = [
      {
        path: 'groups["wave"].difficulty',
        message: "it is only there from hard up and only up to easy",
        severity: "warning",
      },
    ];

    expect(entryFieldProblem(issues, "groups", "wave", "difficulty")).toBe(
      "it is only there from hard up and only up to easy",
    );
  });

  it("finds the issue at one of a group's own order targets, by index", () => {
    const issues: MissionIssue[] = [
      {
        path: 'groups["wave"].orders[1].target',
        message: 'nothing called "boss" for an order to aim at',
      },
    ];

    expect(
      entryFieldProblem(issues, "groups", "wave", "orders[1].target"),
    ).toBe('nothing called "boss" for an order to aim at');
  });

  it("does not claim a different order's target in the same group", () => {
    const issues: MissionIssue[] = [
      { path: 'groups["wave"].orders[0].target', message: "elsewhere" },
    ];

    expect(
      entryFieldProblem(issues, "groups", "wave", "orders[1].target"),
    ).toBeNull();
  });

  it("does not claim another entry's same field", () => {
    const issues: MissionIssue[] = [
      { path: 'actors["villain"].team', message: "elsewhere" },
    ];

    expect(entryFieldProblem(issues, "actors", "hero", "team")).toBeNull();
  });

  it("does not claim a different registry's entry with the same id", () => {
    const issues: MissionIssue[] = [
      { path: 'groups["hero"].team', message: "elsewhere" },
    ];

    expect(entryFieldProblem(issues, "actors", "hero", "team")).toBeNull();
  });
});
