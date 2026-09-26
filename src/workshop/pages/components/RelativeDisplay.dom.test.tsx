// @vitest-environment happy-dom
/**
 * Where a change that follows the game shows its rule (issue #3174): the
 * field row, the Changes page and the Reference table's edited cell.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedField } from "@/content/unitFields";
import type { RelativeEdits } from "../../relativeEdits";
import type { FieldRow } from "../../unitSections";
import { ChangesPanel } from "./ChangesPanel";
import { ReferenceEditableCell } from "./ReferenceEditableCell";
import { UnitFieldRow } from "./UnitFieldRow";

afterEach(cleanup);

const field: ResolvedField = {
  path: "health",
  key: "health",
  known: true,
  described: true,
  label: "Health",
  type: "number",
};

const row = (over: Partial<FieldRow>): FieldRow => ({
  path: "health",
  field,
  label: "Health",
  present: true,
  inherited: 280,
  value: 322,
  state: "overridden",
  ...over,
});

const relative: RelativeEdits = {
  armpw: {
    health: {
      factor: 1.15,
      offset: 0,
      rounding: { kind: "integer" },
      base: 280,
    },
  },
};

describe("the field row", () => {
  it("shows the rule beside the number", () => {
    render(
      <UnitFieldRow
        row={row({})}
        relative="+15% of 280 = 322"
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(
      screen.getByText("Follows the game: +15% of 280 = 322"),
    ).toBeTruthy();
  });

  it("offers reset for a rule whose number equals the game's", () => {
    const onReset = vi.fn();
    render(
      <UnitFieldRow
        row={row({ value: 280, state: "inherited" })}
        relative="+0.1% of 280 = 280"
        onChange={() => {}}
        onReset={onReset}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Health to the inherited value",
      }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("says nothing extra for a fixed number", () => {
    render(
      <UnitFieldRow row={row({})} onChange={() => {}} onReset={() => {}} />,
    );
    expect(screen.queryByText(/Follows the game/)).toBeNull();
  });
});

describe("the Changes page", () => {
  it("shows the rule beside the project's number", () => {
    render(
      <MemoryRouter>
        <ChangesPanel
          projectId="p1"
          ledger={{
            units: [
              {
                unit: "armpw",
                changes: [
                  {
                    description: "health",
                    fieldPath: "health",
                    files: [],
                    tweakSlot: null,
                    tweakMiss: null,
                    uncompiledReason: null,
                  },
                ],
              },
            ],
            notes: [],
          }}
          loading={false}
          error={null}
          gameUnits={{ armpw: { health: 280 } }}
          units={{ armpw: { health: 280 } }}
          clones={{}}
          overrides={{ armpw: { health: 322 } }}
          relative={relative}
          nameOf={(key) => key}
          picOf={() => undefined}
          picsPending={false}
          factionOf={() => undefined}
          onRevertField={() => {}}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Follows the game: +15% of 280 = 322"),
    ).toBeTruthy();
  });
});

describe("the Reference table's edited cell", () => {
  it("says the rule on hover with the game's value", () => {
    render(
      <ReferenceEditableCell
        cell={{ path: "health", value: 322, gameValue: 280, edited: true }}
        rule="+15% of 280 = 322"
        shown={322}
        label="Health"
        unitName="Peewee"
        onDraft={() => {}}
        onCommit={() => {}}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-label")).toContain(
      "Follows the game: +15% of 280 = 322",
    );
  });
});
