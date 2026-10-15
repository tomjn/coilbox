// @vitest-environment happy-dom
/**
 * The labels and accessible names a trigger step's parameter fields build
 * (issue #2274). Before this, every field showed its schema key verbatim
 * ("unitDefs", "min") and every optional number's placeholder was the bare
 * word "default". This pins the string building so it cannot regress back to
 * either silently.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import type { ExtensionTypes } from "../../extensions";
import { NO_EXTENSIONS } from "../../extensions";
import type { TriggerStep } from "../../model";
import { StepRow } from "./TriggerSteps";

afterEach(cleanup);

const noop = () => {};

/**
 * One step row, in a fresh scenario, with the props these tests never vary
 * filled in. `list` is the list the step sits in.
 */
function renderStep(
  step: TriggerStep,
  list: "conditions" | "actions" = "conditions",
  extensions: ExtensionTypes = NO_EXTENSIONS,
) {
  return render(
    <StepRow
      step={step}
      at={{ triggerId: "trigger-1", list, index: 0 }}
      scenario={newScenario("Test")}
      extensions={extensions}
      unsupported={undefined}
      units={[]}
      unitsLoading={false}
      issues={[]}
      picking={null}
      onPick={noop}
      onNegate={null}
      onParam={noop}
      onMove={null}
      onRemove={noop}
    />,
  );
}

describe("trigger parameter labels", () => {
  it("shows the plain label instead of the key, and keeps the key in the accessible name when it differs", () => {
    const step: TriggerStep = {
      type: "unit_health_below",
      params: { actor: "", fraction: 0.5 },
    };

    renderStep(step);

    // "fraction" is relabelled, and the key stays in the spoken name.
    expect(screen.getByText("health fraction")).toBeTruthy();
    expect(screen.queryByText("fraction")).toBeNull();
    expect(
      screen.getByLabelText("Unit health below health fraction, fraction"),
    ).toBeTruthy();

    // "actor" is already a good label, so it is shown and spoken once, not
    // doubled up as "actor, actor".
    expect(screen.getByText("actor")).toBeTruthy();
    expect(screen.queryByLabelText(/actor, actor/)).toBeNull();
  });

  it("puts a known runtime default in the placeholder instead of the bare word", () => {
    const step: TriggerStep = {
      type: "camera_pan",
      params: { pos: { x: 0, z: 0 } },
    };

    renderStep(step, "actions");

    const seconds = screen.getByLabelText(
      "Camera pan seconds",
    ) as HTMLInputElement;
    expect(seconds.placeholder).toBe("default 1");

    // "pos" is relabelled to "position" even though it has no wired
    // accessible name of its own (a point is picked on the map, not typed).
    expect(screen.getByText("position")).toBeTruthy();
    expect(screen.queryByText("pos")).toBeNull();
  });

  it("falls back to the schema key for a game-declared parameter that ships no label", () => {
    const extensions: ExtensionTypes = {
      conditions: {
        custom_condition: {
          type: "custom_condition",
          label: "Custom condition",
          spec: { foo: { kind: "number" } },
        },
      },
      actions: {},
      problems: [],
    };
    const step: TriggerStep = { type: "custom_condition", params: { foo: 1 } };

    renderStep(step, "conditions", extensions);

    expect(screen.getByText("foo")).toBeTruthy();
    expect(screen.getByLabelText("Custom condition foo")).toBeTruthy();
  });

  it("names the enum branch's select the same way as the other fields (issue #2299)", () => {
    const step: TriggerStep = {
      type: "var",
      params: { name: "score", op: "eq", value: 0 },
    };

    renderStep(step);

    // "op" is relabelled to "comparison", so the key stays in the spoken name.
    expect(screen.getByLabelText("Var comparison, op")).toBeTruthy();
  });

  /**
   * Issue #3551. Both conditions are edited through the same fields as every
   * other one: a team, a unit picked from the game, a placed unit from the
   * scenario's own actors, and the command from a fixed list.
   */
  it("offers a team, a unit type and a placed unit for a selection, and a command for an order", () => {
    renderStep({ type: "unit_selected", params: {} });
    expect(screen.getByText("team")).toBeTruthy();
    expect(screen.getByText("unit type")).toBeTruthy();
    expect(
      screen.getByLabelText("Unit selected placed unit, actor"),
    ).toBeTruthy();
    cleanup();

    renderStep({ type: "command_given", params: { command: "move" } });
    expect(screen.getByLabelText("Command given command")).toBeTruthy();
    expect(screen.getByText("unit to build")).toBeTruthy();
  });

  it("names the point picker's group rather than either of its two parts (issue #2299)", () => {
    const step: TriggerStep = {
      type: "camera_pan",
      params: { pos: { x: 0, z: 0 } },
    };

    renderStep(step, "actions");

    // "pos" is relabelled to "position", so the key stays in the spoken name
    // the same way #2274 already does for a text or number field.
    expect(
      screen.getByRole("group", { name: "Camera pan position, pos" }),
    ).toBeTruthy();
  });

  it("names the orders list's group rather than any one row inside it (issue #2299)", () => {
    const step: TriggerStep = {
      type: "give_orders",
      params: { group: "", orders: [] },
    };

    renderStep(step, "actions");

    // "orders" has no label of its own, so the key stands in for the friendly
    // name and is not doubled up the way #2274 already covers for "actor".
    expect(
      screen.getByRole("group", { name: "Give orders orders" }),
    ).toBeTruthy();
  });

  it("says a text field is optional instead of the bare word 'default' (issue #2299)", () => {
    const step: TriggerStep = {
      type: "map_marker",
      params: { pos: { x: 0, z: 0 } },
    };

    renderStep(step, "actions");

    const text = screen.getByLabelText("Map marker text") as HTMLInputElement;
    expect(text.placeholder).toBe("optional");
  });
});
