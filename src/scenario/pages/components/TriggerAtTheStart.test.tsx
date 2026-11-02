// @vitest-environment happy-dom
/**
 * "At the start" in the trigger panel (issue #901): the row an empty condition
 * list draws, and the palette entry that makes one.
 *
 * `OptionSelect` is a Radix `Select`, whose dropdown only renders once opened,
 * so it is mocked to draw each option as a button, the way
 * `TriggerStepGroups.test.tsx` reads them.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newScenario } from "../../create";
import { NO_EXTENSIONS } from "../../extensions";
import { NO_GATE } from "../../gating";
import type { Scenario, ScenarioTrigger } from "../../model";
import { TriggerPanel } from "./TriggerPanel";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    options,
    onValueChange,
  }: {
    options: {
      value: string;
      label: string;
      group?: string;
      trailing?: string;
      disabled?: boolean;
    }[];
    onValueChange: (value: string) => void;
  }) => (
    <div>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          title={[o.group, o.trailing].filter(Boolean).join(" / ")}
          onClick={() => onValueChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  ),
}));

afterEach(cleanup);

const timed: ScenarioTrigger["conditions"] = {
  op: "all",
  conditions: [{ type: "time_elapsed", params: { seconds: 5 } }],
};

function Harness({ trigger }: { trigger: Partial<ScenarioTrigger> }) {
  const [document, setDocument] = useState<Scenario>(() => ({
    ...newScenario("Test"),
    triggers: [
      {
        id: "t1",
        name: "Opening",
        enabled: true,
        repeat: false,
        conditions: { op: "all", conditions: [] },
        actions: [],
        ...trigger,
      },
    ],
  }));
  return (
    <>
      <TriggerPanel
        scenario={document}
        onChange={setDocument}
        units={[]}
        unitsLoading={false}
        gate={NO_GATE}
        extensions={NO_EXTENSIONS}
        note={null}
        issues={[]}
        picking={null}
        onPick={() => {}}
        onUndo={() => {}}
      />
      <output>{JSON.stringify(document.triggers[0])}</output>
    </>
  );
}

/** The panel starts shut, the way it does on the edit page. */
function openPanel(trigger: Partial<ScenarioTrigger>) {
  render(<Harness trigger={trigger} />);
  fireEvent.click(screen.getByRole("button", { name: /^Triggers/ }));
}

/** The row an empty list draws, apart from the palette entry of the same name. */
const emptyRow = (text: string) => screen.getByText(text, { selector: "p" });

const paletteEntry = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "At the start" });

const stored = (): ScenarioTrigger =>
  JSON.parse(screen.getByRole("status").textContent ?? "{}");

describe("a trigger's empty condition list", () => {
  it("draws as at the start, with the palette entry greyed as already set", () => {
    openPanel({});

    // The row itself, the summary in the list, and nothing saying "always".
    expect(emptyRow("At the start")).toBeTruthy();
    expect(screen.getByText(/At the start · 0 actions/)).toBeTruthy();
    expect(screen.queryByText(/always/i)).toBeNull();
    expect(paletteEntry().disabled).toBe(true);
    expect(paletteEntry().title).toBe("Time / Already set");
  });

  it("does not call a repeating trigger at the start", () => {
    openPanel({ repeat: true });

    expect(emptyRow("Always")).toBeTruthy();
    expect(paletteEntry().disabled).toBe(false);
  });

  it("says never under any", () => {
    openPanel({ conditions: { op: "any", conditions: [] } });

    expect(emptyRow("Never")).toBeTruthy();
    expect(paletteEntry().disabled).toBe(false);
  });
});

describe("the palette's at the start entry", () => {
  it("replaces the conditions and arms a fire-once trigger", () => {
    openPanel({ conditions: timed, enabled: false });
    expect(
      screen.queryByText("Time elapsed", { selector: "span" }),
    ).toBeTruthy();

    fireEvent.click(paletteEntry());

    expect(stored().conditions).toEqual({ op: "all", conditions: [] });
    expect(stored().enabled).toBe(true);
    expect(stored().repeat).toBe(false);
    expect(screen.queryByText("Time elapsed", { selector: "span" })).toBeNull();
  });

  it("gives way to a real condition added beside it", () => {
    openPanel({});

    fireEvent.click(screen.getByRole("button", { name: "Time elapsed" }));

    expect(stored().conditions.conditions.map((c) => c.type)).toEqual([
      "time_elapsed",
    ]);
    expect(paletteEntry().disabled).toBe(false);
  });
});
