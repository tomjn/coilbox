// @vitest-environment happy-dom
/**
 * The reference table and the comparison view (issue #1316), exercised as a
 * person would drive them: search, sort, select two units, compare, and see
 * only the fields that differ.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { resolvedDef, type UnitOverrides } from "../../overrides";
import { setReferenceValue } from "../../referenceEdit";
import { type UnitReferenceRow, unitReferenceRow } from "../../unitReference";
import type { ReferenceEditing } from "./ReferenceBulkEdit";
import { UnitReferenceView } from "./UnitReferenceView";

afterEach(cleanup);

// The scatter plot (issue #3115) navigates a dot's click with `useNavigate`,
// which needs a router in context even when a test never clicks a dot.
function renderView(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function rows(): UnitReferenceRow[] {
  return [
    unitReferenceRow(
      "armtank",
      "Tank",
      {
        health: 1000,
        metalCost: 200,
        weapons: [{ name: "armtank_laser" }],
        weapondefs: {
          laser: {
            weaponType: "Cannon",
            range: 300,
            reloadTime: 2,
            damage: { default: 50 },
          },
        },
      },
      {},
    ),
    unitReferenceRow(
      "corcom",
      "Commander",
      { health: 3000, metalCost: 1000 },
      {},
    ),
  ];
}

describe("UnitReferenceView", () => {
  it("lists every unit and searches by name", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    expect(screen.getByText("Tank")).toBeTruthy();
    expect(screen.getByText("Commander")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Search units/), {
      target: { value: "tank" },
    });
    expect(screen.getByText("Tank")).toBeTruthy();
    expect(screen.queryByText("Commander")).toBeNull();
  });

  it("filters by a stat comparison", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Search units/), {
      target: { value: "hp > 2000" },
    });
    expect(screen.getByText("Commander")).toBeTruthy();
    expect(screen.queryByText("Tank")).toBeNull();
  });

  it("selects two units and compares only the fields where they differ", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select Tank to compare"));
    fireEvent.click(screen.getByLabelText("Select Commander to compare"));

    expect(screen.getByText("2 units selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));

    const drawer = within(screen.getByRole("dialog"));
    // Health and metal cost differ between the two units, so both are shown.
    expect(drawer.getByText("Health")).toBeTruthy();
    expect(drawer.getByText("Metal cost")).toBeTruthy();
    // Speed is undefined for both, so it is left out.
    expect(drawer.queryByText("Speed")).toBeNull();
  });

  it("disables Compare with fewer than two selected", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    fireEvent.click(screen.getByLabelText("Select Tank to compare"));
    expect(
      (screen.getByRole("button", { name: "Compare" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("UnitReferenceTable sorting", () => {
  it("sorts by a numeric column on header click", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Health/ }));
    const table = screen.getAllByRole("table")[0];
    const bodyRows = within(table).getAllByRole("row").slice(1);
    // Ascending: Tank (1000) before Commander (3000).
    expect(within(bodyRows[0]).getByText("Tank")).toBeTruthy();
  });
});

describe("UnitReferenceTable rename (issue #3110)", () => {
  it("calls the alpha damage column volley damage", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    expect(screen.getByRole("button", { name: /Volley damage/ })).toBeTruthy();
    expect(screen.queryByText(/Alpha damage/)).toBeNull();
  });
});

describe("UnitReferenceTable faction column and filter (issue #3110)", () => {
  const factionOf = (key: string) => (key === "armtank" ? "Arm" : "Core");

  it("is absent with no factionOf", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    expect(screen.queryByText("Faction")).toBeNull();
  });

  it("shows each row's faction and a filter beside the search box", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
        factionOf={factionOf}
      />,
    );
    expect(screen.getByText("Faction")).toBeTruthy();
    expect(screen.getByText("Arm")).toBeTruthy();
    expect(screen.getByText("Core")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Filter by faction"));
    fireEvent.click(screen.getByRole("option", { name: "Core" }));
    expect(screen.getByText("Commander")).toBeTruthy();
    expect(screen.queryByText("Tank")).toBeNull();
  });
});

describe("UnitReferenceView collection filter (issue #3146)", () => {
  const collections = {
    all: {
      tanks: { id: "tanks", name: "Tanks", units: ["armtank"] },
    },
    unitsOf: (id: string) =>
      id === "tanks" ? new Set(["armtank"]) : undefined,
  };

  it("is absent with no collections", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    expect(screen.queryByLabelText("Filter by collection")).toBeNull();
  });

  it("narrows the table to one collection's units", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
        collections={collections}
      />,
    );
    fireEvent.click(screen.getByLabelText("Filter by collection"));
    fireEvent.click(screen.getByRole("option", { name: "Tanks" }));
    expect(screen.getByText("Tank")).toBeTruthy();
    expect(screen.queryByText("Commander")).toBeNull();
    expect(screen.getByText("1 of 2 units")).toBeTruthy();
  });
});

describe("UnitReferenceView select every shown row (issue #3113)", () => {
  it("selects only the rows the filters leave on the table", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Search units/), {
      target: { value: "hp > 2000" },
    });
    fireEvent.click(screen.getByLabelText("Select every unit shown"));
    expect(screen.getByText("1 unit selected")).toBeTruthy();

    // Clearing the search keeps the selection, and the header box now reads
    // as "not every shown unit", so a second press adds the rest.
    fireEvent.change(screen.getByPlaceholderText(/Search units/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByLabelText("Select every unit shown"));
    expect(screen.getByText("2 units selected")).toBeTruthy();

    // With every shown unit selected, it clears them.
    fireEvent.click(screen.getByLabelText("Select every unit shown"));
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});

describe("UnitReferenceView editing (issue #3113)", () => {
  const units: Record<string, Record<string, unknown>> = {
    armtank: { health: 1000, metalCost: 200 },
    corcom: { health: 3000, metalCost: 1000 },
  };
  const names: Record<string, string> = {
    armtank: "Tank",
    corcom: "Commander",
  };

  /** A page that owns its overrides, counting each write the way the undo
   *  history would record a step. */
  function Harness({ onWrite }: { onWrite: () => void }) {
    const [overrides, setOverrides] = useState<UnitOverrides>({});
    const rowOf = (key: string, o: UnitOverrides) =>
      unitReferenceRow(key, names[key], resolvedDef(units[key], o[key]), {});
    const editing: ReferenceEditing = {
      units,
      overrides,
      updateOverrides: (update) => {
        onWrite();
        setOverrides(update);
      },
      draftRow: (key, columnId, value) =>
        rowOf(key, setReferenceValue(overrides, units, key, columnId, value)),
    };
    return (
      <UnitReferenceView
        rows={Object.keys(units).map((key) => rowOf(key, overrides))}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
        editing={editing}
      />
    );
  }

  it("is read only without a project to write to", () => {
    renderView(
      <UnitReferenceView
        rows={rows()}
        renderName={(r) => r.name}
        unitHref={(r) => `/unit/${r.key}`}
      />,
    );
    expect(screen.queryByLabelText(/^Edit Health for Tank/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Select Tank to compare"));
    expect(screen.queryByRole("button", { name: "Change values" })).toBeNull();
  });

  it("edits a cell in place and moves derived columns while typing", () => {
    let writes = 0;
    renderView(<Harness onWrite={() => writes++} />);
    fireEvent.click(screen.getByLabelText(/^Edit Health for Tank/));
    const box = screen.getByLabelText("Health for Tank");
    fireEvent.change(box, { target: { value: "2000" } });
    // Cost per HP is 200 / 2000 before anything is written.
    expect(screen.getByText("0.1")).toBeTruthy();
    expect(writes).toBe(0);

    fireEvent.keyDown(box, { key: "Enter" });
    expect(writes).toBe(1);
    const cell = screen.getByLabelText(/^Edit Health for Tank/);
    expect(cell.textContent).toBe("2,000");
    expect(cell.className).toContain("text-primary");
  });

  it("puts a cell back on Escape without writing", () => {
    let writes = 0;
    renderView(<Harness onWrite={() => writes++} />);
    fireEvent.click(screen.getByLabelText(/^Edit Health for Tank/));
    const box = screen.getByLabelText("Health for Tank");
    fireEvent.change(box, { target: { value: "2000" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(writes).toBe(0);
    expect(screen.getByLabelText(/^Edit Health for Tank/).textContent).toBe(
      "1,000",
    );
  });

  it("raises the selection's health by 10% with a preview, as one write", () => {
    let writes = 0;
    renderView(<Harness onWrite={() => writes++} />);
    fireEvent.click(screen.getByLabelText("Select every unit shown"));
    fireEvent.click(screen.getByRole("button", { name: "Change values" }));
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "10" },
    });

    const preview = within(screen.getByRole("list", { name: "Preview" }));
    expect(preview.getByText(/1000 → 1100/)).toBeTruthy();
    expect(preview.getByText(/3000 → 3300/)).toBeTruthy();
    expect(screen.getByText("2 of 2 units change")).toBeTruthy();
    expect(writes).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Apply to 2 units/ }));
    expect(writes).toBe(1);
    expect(screen.getByLabelText(/^Edit Health for Tank/).textContent).toBe(
      "1,100",
    );
    expect(
      screen.getByLabelText(/^Edit Health for Commander/).textContent,
    ).toBe("3,300");
  });
});
