// @vitest-environment happy-dom
/**
 * The add-step dropdown's bands (issue #2273). Before this, `AddStep` built one
 * flat option per condition or action, so choosing what a trigger does meant
 * reading the longest undifferentiated list on the page.
 *
 * `OptionSelect` is a Radix `Select`, whose dropdown only renders once opened,
 * so it is mocked here (the same way `TriggerStepDescriptions.test.tsx` does)
 * to read each option's `group` and `description` directly, rather than
 * driving a Radix popover open in happy-dom.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newScenario } from "../../create";
import type { ExtensionTypes } from "../../extensions";
import { ACTION_TYPES, CONDITION_TYPES } from "../../triggerTypes";
import { AddStep } from "./TriggerSteps";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    options,
  }: {
    options: { value: string; group?: string; description?: string }[];
  }) => (
    <ul>
      {options.map((o) => (
        <li key={o.value}>
          {o.group}: {o.description}
        </li>
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

describe("the add-step dropdown's bands (issue #2273)", () => {
  it("bands every action exactly once, keeping its description", () => {
    const { container } = render(
      <AddStep
        list="actions"
        scenario={newScenario("Test")}
        extensions={noExtensions}
        unitDefs={[]}
        gate={{}}
        onAdd={() => {}}
      />,
    );

    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(Object.keys(ACTION_TYPES).length);

    // Every action's own description still renders, now with a band prefix.
    expect(
      items.some((li) =>
        li.textContent?.includes(
          "Units: Hands a group's units to another team",
        ),
      ),
    ).toBe(true);
    expect(
      items.some((li) =>
        li.textContent?.includes(
          "Ending: Ends the mission with a team's side winning",
        ),
      ),
    ).toBe(true);
    expect(
      items.some((li) =>
        li.textContent?.includes("Variables: Sets a variable to a number"),
      ),
    ).toBe(true);
  });

  it("bands every condition exactly once, keeping its description", () => {
    const { container } = render(
      <AddStep
        list="conditions"
        scenario={newScenario("Test")}
        extensions={noExtensions}
        unitDefs={[]}
        gate={{}}
        onAdd={() => {}}
      />,
    );

    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(Object.keys(CONDITION_TYPES).length);
    expect(
      items.some((li) =>
        li.textContent?.includes(
          "Time: True once a set number of seconds has passed",
        ),
      ),
    ).toBe(true);
  });

  it("puts a game-declared type in its own band after the built-in ones", () => {
    const extensions: ExtensionTypes = {
      conditions: {
        custom_condition: {
          type: "custom_condition",
          label: "Custom condition",
          description: "Something the game itself checks.",
          spec: { foo: { kind: "number" } },
        },
      },
      actions: {},
      problems: [],
    };

    const { container } = render(
      <AddStep
        list="conditions"
        scenario={newScenario("Test")}
        extensions={extensions}
        unitDefs={[]}
        gate={{}}
        onAdd={() => {}}
      />,
    );

    const items = Array.from(container.querySelectorAll("li"));
    expect(items).toHaveLength(Object.keys(CONDITION_TYPES).length + 1);
    expect(items[items.length - 1].textContent).toBe(
      "Game types: Something the game itself checks.",
    );
  });
});
