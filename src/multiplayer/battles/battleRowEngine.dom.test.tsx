// @vitest-environment happy-dom

/**
 * A battle on another engine (Open Annihilation) carries an engine badge and no
 * minimap, since the thumbnail comes from local unitsync. A Recoil row is as it
 * was. The filter and profile scoping are covered in `battleFilters.test.ts`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

vi.mock("../openAnnihilation", () => ({
  useOpenAnnihilation: () => [{ path: "/oa", version: "OA" }],
}));

vi.mock("./BattleRowMapThumb", () => ({
  BattleRowMapThumb: () => <div data-testid="minimap" />,
}));

const recoil = {
  id: 4,
  host: "Host",
  title: "Recoil room",
  map: "Some Map",
  modname: "Game",
  engine: "spring",
  maxPlayers: 8,
  spectatorCount: 0,
  passworded: false,
  locked: false,
  members: {},
  bots: {},
  playerCount: 1,
} as unknown as Battle;

const oa = {
  ...recoil,
  id: 5,
  title: "[OA] Skirmish",
  modname: "Total Annihilation",
  engine: "Open Annihilation",
} as Battle;

function row(battle: Battle) {
  render(
    <ul>
      <BattleRow
        battle={battle}
        joined={false}
        canJoin={true}
        onJoin={vi.fn()}
        onLeave={() => {}}
      />
    </ul>,
  );
}

afterEach(cleanup);

describe("battle row engine", () => {
  it("badges an Open Annihilation battle and drops its minimap", () => {
    row(oa);
    expect(screen.getByText("Open Annihilation")).toBeTruthy();
    expect(screen.queryByTestId("minimap")).toBeNull();
  });

  it("holds the thumbnail's place with the OA icon in a same-sized square", () => {
    row(oa);
    const square = screen.getByTestId("oa-row-icon").parentElement;
    expect(square?.className).toContain("w-14");
    expect(square?.className).toContain("aspect-square");
  });

  it("shows a Recoil battle with its minimap and no badge", () => {
    row(recoil);
    expect(screen.getByTestId("minimap")).toBeTruthy();
    expect(screen.queryByTestId("oa-row-icon")).toBeNull();
    expect(screen.queryByText("spring")).toBeNull();
    expect(screen.queryByText("Open Annihilation")).toBeNull();
  });

  it("gives a battle on some other engine a badge and neither picture", () => {
    row({ ...recoil, engine: "Another Engine" });
    expect(screen.getByText("Another Engine")).toBeTruthy();
    expect(screen.queryByTestId("minimap")).toBeNull();
    expect(screen.queryByTestId("oa-row-icon")).toBeNull();
  });
});

describe("battle row title", () => {
  it("drops the [OA] mark from an Open Annihilation battle", () => {
    row({ ...oa, title: "[OA] Test Game" });
    expect(screen.getByText("Test Game")).toBeTruthy();
    expect(screen.queryByText(/\[OA\]/)).toBeNull();
    expect(screen.getByRole("button", { name: "Join Test Game" })).toBeTruthy();
  });

  it("names an Open Annihilation battle with only the mark by its id", () => {
    row({ ...oa, title: "[OA]" });
    expect(screen.getByText("battle 5")).toBeTruthy();
  });

  it("keeps the mark on a Recoil battle", () => {
    row({ ...recoil, title: "[OA] Something" });
    expect(screen.getByText("[OA] Something")).toBeTruthy();
  });
});
