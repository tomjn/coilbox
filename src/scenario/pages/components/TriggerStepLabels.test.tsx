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

describe("trigger parameter labels", () => {
  it("shows the plain label instead of the key, and keeps the key in the accessible name when it differs", () => {
    const scenario = newScenario("Test");
    const step: TriggerStep = {
      type: "unit_health_below",
      params: { actor: "", fraction: 0.5 },
    };

    render(
      <StepRow
        step={step}
        at={{ triggerId: "trigger-1", list: "conditions", index: 0 }}
        scenario={scenario}
        extensions={NO_EXTENSIONS}
        unsupported={undefined}
        units={[]}
        unitsLoading={false}
        picking={null}
        onPick={noop}
        onParam={noop}
        onMove={null}
        onRemove={noop}
      />,
    );

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
    const scenario = newScenario("Test");
    const step: TriggerStep = {
      type: "camera_pan",
      params: { pos: { x: 0, z: 0 } },
    };

    render(
      <StepRow
        step={step}
        at={{ triggerId: "trigger-1", list: "actions", index: 0 }}
        scenario={scenario}
        extensions={NO_EXTENSIONS}
        unsupported={undefined}
        units={[]}
        unitsLoading={false}
        picking={null}
        onPick={noop}
        onParam={noop}
        onMove={null}
        onRemove={noop}
      />,
    );

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
    const scenario = newScenario("Test");
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

    render(
      <StepRow
        step={step}
        at={{ triggerId: "trigger-1", list: "conditions", index: 0 }}
        scenario={scenario}
        extensions={extensions}
        unsupported={undefined}
        units={[]}
        unitsLoading={false}
        picking={null}
        onPick={noop}
        onParam={noop}
        onMove={null}
        onRemove={noop}
      />,
    );

    expect(screen.getByText("foo")).toBeTruthy();
    expect(screen.getByLabelText("Custom condition foo")).toBeTruthy();
  });
});
