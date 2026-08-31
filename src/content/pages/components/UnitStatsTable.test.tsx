// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitStatsTable } from "./UnitStatsTable";

describe("UnitStatsTable", () => {
  it("shows a stat the def declares", () => {
    render(
      <UnitStatsTable unit={{ name: "armsolar", stats: { metalCost: 155 } }} />,
    );
    expect(screen.getByText("Metal cost")).toBeTruthy();
    expect(screen.getByText("155")).toBeTruthy();
  });

  it("shows no row for a stat the def does not declare", () => {
    // Absent is a fact about the reader, not a claim about the game. A zero here
    // would be putting a number in the game's mouth.
    render(
      <UnitStatsTable unit={{ name: "armsolar", stats: { metalCost: 155 } }} />,
    );
    expect(screen.queryByText("Health")).toBeNull();
  });

  it("lists a weapon's damage, reload, range and kind", () => {
    render(
      <UnitStatsTable
        unit={{
          name: "armflash",
          stats: {
            weapons: [
              {
                damage: 32,
                reload: 0.3,
                range: 230,
                projectile: "LaserCannon",
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("LaserCannon")).toBeTruthy();
    expect(screen.getByText("230")).toBeTruthy();
  });

  it("renders nothing at all for a unit with no stats", () => {
    const { container } = render(
      <UnitStatsTable unit={{ name: "armsolar" }} />,
    );
    expect(container.textContent).toBe("");
  });
});
