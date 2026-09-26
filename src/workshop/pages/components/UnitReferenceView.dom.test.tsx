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
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { type UnitReferenceRow, unitReferenceRow } from "../../unitReference";
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
