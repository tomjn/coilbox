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

  it("shows a Recoil battle with its minimap and no badge", () => {
    row(recoil);
    expect(screen.getByTestId("minimap")).toBeTruthy();
    expect(screen.queryByText("spring")).toBeNull();
    expect(screen.queryByText("Open Annihilation")).toBeNull();
  });
});
