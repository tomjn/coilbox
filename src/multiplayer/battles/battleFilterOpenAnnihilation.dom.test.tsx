// @vitest-environment happy-dom

/**
 * The Filters popover hides Open Annihilation battles, and the list it feeds
 * loses them. The predicate itself is covered in `battleFilters.test.ts`.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Battle } from "../bindings";
import { BattleFilterPopover } from "./BattleFilterPopover";
import { type BattleFilters, filterSortBattles } from "./battleFilters";

const battle = (id: number, engine: string) =>
  ({
    id,
    host: "host",
    title: `Battle ${id}`,
    map: "Map",
    modname: "Game",
    engine,
    maxPlayers: 8,
    playerCount: 1,
    passworded: false,
    locked: false,
    members: {},
  }) as unknown as Battle;

const battles = [battle(1, "spring"), battle(2, "Open Annihilation")];

function Harness() {
  const [filters, setFilters] = useState<BattleFilters>({
    search: "",
    hideEmpty: false,
    hideLockedPassworded: false,
    hideFull: false,
    hideOpenAnnihilation: false,
    sortKey: "players",
    sortDir: "desc",
  });
  return (
    <>
      <BattleFilterPopover filters={filters} setFilters={setFilters} />
      <p data-testid="shown">
        {filterSortBattles(battles, filters)
          .map((b) => b.id)
          .sort()
          .join(",")}
      </p>
    </>
  );
}

afterEach(cleanup);

describe("Open Annihilation filter", () => {
  it("hides Open Annihilation battles when toggled, and shows them again", () => {
    render(<Harness />);
    expect(screen.getByTestId("shown").textContent).toBe("1,2");

    fireEvent.click(
      screen.getByRole("button", { name: "Filters and sorting" }),
    );
    const toggle = screen.getByRole("button", { name: "Open Annihilation" });
    expect(toggle.textContent).toBe("OA");
    expect(toggle.getAttribute("title")).toBe("Open Annihilation");

    fireEvent.click(toggle);
    expect(screen.getByTestId("shown").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Open Annihilation" }));
    expect(screen.getByTestId("shown").textContent).toBe("1,2");
  });
});
