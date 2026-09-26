// @vitest-environment happy-dom
/**
 * The strip's game-vs-project comparison (issue #3114): a tile whose number
 * an edit moved shows both, and one an edit left alone shows the plain
 * number it always did.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { unitDerivedStats, type WeaponInput } from "../../derivedStats";
import { DerivedStatsStrip } from "./DerivedStatsStrip";

afterEach(cleanup);

const ECONOMY = { health: 1000, metalCost: 200, buildTime: 100 };

function weapon(damage: number): WeaponInput {
  return { def: { damage: { default: damage }, reloadTime: 1 } };
}

describe("DerivedStatsStrip", () => {
  it("shows a tile's game value, its new value and the difference when an edit moved it", () => {
    const gameStats = unitDerivedStats({ def: ECONOMY }, [weapon(50)]);
    const stats = unitDerivedStats({ def: ECONOMY }, [weapon(65)]);
    render(<DerivedStatsStrip stats={stats} gameStats={gameStats} />);

    // 50 dps -> 65 dps, a rise of 15, worth stating as "+15" rather than
    // leaving the sign to colour alone.
    const dpsValue = screen.getByText("DPS").nextSibling as HTMLElement;
    expect(dpsValue.textContent).toBe("50 → 65(+15)");
    expect(dpsValue.querySelector(".text-destructive")).toBeNull();
    expect(dpsValue.querySelector(".text-emerald-600")).not.toBeNull();
  });

  it("leaves a tile plain when the edit did not move it", () => {
    const gameStats = unitDerivedStats({ def: ECONOMY }, [weapon(50)]);
    const stats = unitDerivedStats({ def: ECONOMY }, [weapon(65)]);
    render(<DerivedStatsStrip stats={stats} gameStats={gameStats} />);

    // Cost per HP is metalCost / health, unmoved by a weapon-only edit.
    const costValue = screen.getByText("Cost per HP")
      .nextSibling as HTMLElement;
    expect(costValue.textContent).toBe("0.2");
  });

  it("colours a cost rise as the worse direction, since lower cost per HP is better", () => {
    const gameStats = unitDerivedStats(
      { def: { health: 1000, metalCost: 200 } },
      [],
    );
    const stats = unitDerivedStats(
      { def: { health: 1000, metalCost: 300 } },
      [],
    );
    render(<DerivedStatsStrip stats={stats} gameStats={gameStats} />);

    const costValue = screen.getByText("Cost per HP")
      .nextSibling as HTMLElement;
    expect(costValue.textContent).toBe("0.2 → 0.3(+0.1)");
    expect(costValue.querySelector(".text-destructive")).not.toBeNull();
  });

  it("draws nothing to compare against when the game has no matching stats", () => {
    const stats = unitDerivedStats({ def: ECONOMY }, [weapon(65)]);
    render(<DerivedStatsStrip stats={stats} />);

    const dpsValue = screen.getByText("DPS").nextSibling as HTMLElement;
    expect(dpsValue.textContent).toBe("65");
  });
});
