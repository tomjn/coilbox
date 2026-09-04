// @vitest-environment happy-dom
/**
 * What the add-step dropdown shows under a condition or action's label
 * (issue #2286). Before this, a type with no description fell back to its
 * parameter names joined with commas, so an author choosing between two
 * actions read a schema key list as the explanation of one of them.
 *
 * `OptionSelect` is a Radix `Select`, whose dropdown only renders once opened,
 * so it is mocked here (the same way `leftoverRelayAgent.dom.test.tsx` mocks
 * it) to read the `description` each option was built with directly, rather
 * than driving a Radix popover open in happy-dom.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newScenario } from "../../create";
import type { ExtensionTypes } from "../../extensions";
import { AddStep } from "./TriggerSteps";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    options,
  }: {
    options: { value: string; description?: string }[];
  }) => (
    <ul>
      {options.map((o) => (
        <li key={o.value}>{o.description}</li>
      ))}
    </ul>
  ),
}));

afterEach(cleanup);

const noExtensions: ExtensionTypes = {
  conditions: {},
  actions: {},
  problems: [],
};

describe("the add-step dropdown's descriptions (issue #2286)", () => {
  it("shows a built-in action's own description rather than its parameter names", () => {
    render(
      <AddStep
        list="actions"
        scenario={newScenario("Test")}
        extensions={noExtensions}
        unitDefs={[]}
        gate={{}}
        onAdd={() => {}}
      />,
    );

    expect(
      screen.getByText(/Hands a group's units to another team/),
    ).toBeTruthy();
    expect(screen.queryByText("group, team")).toBeNull();
  });

  it("says a game-declared type has no description rather than listing its parameter keys", () => {
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

    render(
      <AddStep
        list="conditions"
        scenario={newScenario("Test")}
        extensions={extensions}
        unitDefs={[]}
        gate={{}}
        onAdd={() => {}}
      />,
    );

    expect(screen.getByText("No description.")).toBeTruthy();
    expect(screen.queryByText("foo")).toBeNull();
  });

  it("shows a game-declared type's own description when it ships one", () => {
    const extensions: ExtensionTypes = {
      conditions: {
        custom_condition: {
          type: "custom_condition",
          label: "Custom condition",
          description: "Something Splinter Faction's research points do.",
          spec: { foo: { kind: "number" } },
        },
      },
      actions: {},
      problems: [],
    };

    render(
      <AddStep
        list="conditions"
        scenario={newScenario("Test")}
        extensions={extensions}
        unitDefs={[]}
        gate={{}}
        onAdd={() => {}}
      />,
    );

    expect(
      screen.getByText("Something Splinter Faction's research points do."),
    ).toBeTruthy();
    expect(screen.queryByText("No description.")).toBeNull();
  });
});
