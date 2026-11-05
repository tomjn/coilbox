// @vitest-environment happy-dom

/**
 * The Game tab holds the unit definition's settings, Built by among them
 * (issue #4534). Each section is covered by its own test, so they are stood in
 * for here and only where they sit is checked.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { GamePanel } from "./GamePanel";

vi.mock("./MovementSection", () => ({
  MovementSection: () => <p>Movement</p>,
}));
vi.mock("./BuiltBySection", () => ({
  BuiltBySection: () => <p>Built by</p>,
}));
vi.mock("./WorthSection", () => ({ WorthSection: () => <p>Worth</p> }));
vi.mock("./WeaponsSection", () => ({ WeaponsSection: () => <p>Weapons</p> }));
vi.mock("./StatsSection", () => ({ StatsSection: () => <p>Stats</p> }));
vi.mock("./GameFitSection", () => ({
  GameFitSection: () => <p>Fit to the game</p>,
}));

afterEach(cleanup);

const pack: LoadedPack = {
  manifest: {} as LoadedPack["manifest"],
  library: { packs: [], atlases: [], dir: "", problems: [] },
  parts: [],
  byId: new Map(),
  vertices: new Float32Array(),
  indices: new Uint16Array(),
};

const project = newProject({
  id: "p",
  rootPieceId: "root",
  name: "Sky fort",
  packId: "lego",
  packVersion: "1",
  now: "2026-11-05T00:00:00Z",
});

function show(over: Partial<React.ComponentProps<typeof GamePanel>> = {}) {
  return render(
    <GamePanel
      project={project}
      pack={pack}
      raw={null}
      onMovementChange={vi.fn()}
      onWorthChange={vi.fn()}
      {...over}
    />,
  );
}

describe("GamePanel", () => {
  it("shows Built by beside movement, worth, weapons, stats and fit", () => {
    show({ onBuiltByChange: vi.fn(), onWeaponChange: vi.fn() });
    for (const name of [
      "Movement",
      "Built by",
      "Worth",
      "Weapons",
      "Stats",
      "Fit to the game",
    ]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("leaves Built by out when nothing is given to save it", () => {
    show();
    expect(screen.queryByText("Built by")).toBeNull();
  });
});
