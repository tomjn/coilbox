// @vitest-environment happy-dom
/**
 * The scatter plot's controls (issue #3115): recharts' own `ResponsiveContainer`
 * measures a zero-size box in happy-dom and draws nothing, the same reason
 * `MatchStatsChart.tsx` has no dom test of its own, so this only exercises the
 * axis pickers and log-scale checkbox that sit above the chart. Which point
 * each unit plots to, and which gets a ghost, is `unitScatter.test.ts`.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { unitReferenceRow } from "../../unitReference";
import { UnitScatterPlot } from "./UnitScatterPlot";

afterEach(cleanup);

function rows() {
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
  ];
}

describe("UnitScatterPlot axis choice", () => {
  it("defaults to metal cost against DPS (issue #3115)", () => {
    render(
      <MemoryRouter>
        <UnitScatterPlot rows={rows()} unitHref={() => "/x"} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("X axis").textContent).toBe("Metal cost");
    expect(screen.getByLabelText("Y axis").textContent).toBe("DPS");
  });

  it("offers a log scale toggle for the default cost axis", () => {
    render(
      <MemoryRouter>
        <UnitScatterPlot rows={rows()} unitHref={() => "/x"} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Log scale")).toBeTruthy();
  });

  it("drops the log scale toggle once the axis moves off cost or health", () => {
    render(
      <MemoryRouter>
        <UnitScatterPlot rows={rows()} unitHref={() => "/x"} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByLabelText("X axis"));
    fireEvent.click(screen.getByRole("option", { name: "Sight" }));
    expect(screen.getByLabelText("X axis").textContent).toBe("Sight");
    // Y axis is still DPS, which offers no log scale either, so the
    // checkbox is gone entirely.
    expect(screen.queryByText("Log scale")).toBeNull();
  });
});
