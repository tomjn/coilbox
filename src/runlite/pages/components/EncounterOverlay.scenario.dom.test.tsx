// @vitest-environment happy-dom
/**
 * The Warpath briefing for a scenario location (issue #3515): it says the
 * fight is a scenario and shows its name and description, and it says so when
 * the scenario a node names could not be read from the map.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeScenario } from "../../../conquest/model";
import type { RogueliteRun, RunNode } from "../../model";

const h = vi.hoisted(() => ({ gutter: vi.fn(), gate: vi.fn() }));

vi.mock("../../../content/config", () => ({
  useUnitsyncUnitDataset: () => ({ dataset: null }),
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: null }),
}));
vi.mock("../../../challenge/SubstitutedMapNote", () => ({
  SubstitutedMapNote: () => null,
}));
vi.mock("./UnitLimitNote", () => ({
  UnitLimitNote: () => <p>unit limit note</p>,
}));
vi.mock("../../../conquest/pages/components/BattleOverlayParts", () => ({
  BattleCheckingNotice: () => null,
  BattleResultPrompt: () => null,
  BattleGutter: (props: unknown) => {
    h.gutter(props);
    return null;
  },
  BattleLaunchGate: (props: unknown) => {
    h.gate(props);
    return null;
  },
}));
vi.mock("../../runlite-run", () => ({
  useRunEncounter: () => ({
    phase: "briefing",
    installedGame: { name: "Test Game 2.0" },
    ais: [],
    gameOffer: null,
    limit: { kind: "loading" },
    snapshot: () => null,
    lastSnapshot: null,
  }),
}));

import { EncounterOverlay } from "./EncounterOverlay";

const node: RunNode = {
  id: "ironcoast",
  type: "battle",
  col: 3,
  row: 0,
  location: "ironcoast",
  scenario: "ironcoast-siege.json",
  battle: {
    mapName: "Comet Catcher Redux",
    enemyAiCount: 2,
    handicap: 10,
    techTier: 3,
  },
};
const run = {
  settings: { game: { shortname: "TG" } },
  progress: { perks: [] },
} as unknown as RogueliteRun;
const siege = {
  file: "ironcoast-siege.json",
  media: {},
  doc: {
    name: "Siege",
    description: "The player must hold the keep before the clock runs out.",
    setup: { mapName: "Comet Catcher Redux" },
  },
} as unknown as NodeScenario;

function show(scenario?: NodeScenario) {
  render(
    <EncounterOverlay
      run={run}
      node={node}
      scenario={scenario}
      onResolved={async () => {}}
      onRestoreMap={async () => {}}
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  h.gutter.mockClear();
  h.gate.mockClear();
});
afterEach(cleanup);

describe("the Warpath briefing for a scenario location", () => {
  it("says it is a scenario and shows its name and description", () => {
    show(siege);
    expect(screen.getByText("Scenario")).toBeTruthy();
    expect(screen.getByText("Siege")).toBeTruthy();
    expect(
      screen.getByText(
        "This location is a scenario, not a skirmish. The player must hold the keep before the clock runs out. Win it to clear the location.",
      ),
    ).toBeTruthy();
  });

  it("leaves out what only a skirmish has", () => {
    show(siege);
    expect(screen.queryByText("Opposition")).toBeNull();
    expect(screen.queryByText("Tech tier")).toBeNull();
    expect(screen.queryByText("unit limit note")).toBeNull();
    expect(h.gutter.mock.calls[0][0].installedGame).toBe(false);
    // The unit data is still loading, and the scenario does not wait on it.
    expect(h.gate.mock.calls[0][0].hold).toBeUndefined();
    expect(h.gate.mock.calls[0][0].aisAvailable).toBe(true);
  });

  it("says so when the scenario could not be read and a skirmish stands in", () => {
    show(undefined);
    expect(screen.getByText(/the scenario could not be read/)).toBeTruthy();
    expect(screen.getByText("Opposition")).toBeTruthy();
    expect(screen.queryByText("Scenario")).toBeNull();
    expect(h.gate.mock.calls[0][0].hold).toMatchObject({ busy: true });
  });
});
