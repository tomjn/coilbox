// @vitest-environment happy-dom
/**
 * The briefing for a scenario location (issue #3515): it says the fight is a
 * scenario and shows the scenario's name and description, and it drops the
 * rows that only describe a skirmish.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "../../model";

const h = vi.hoisted(() => ({
  scenario: undefined as { name: string; description: string } | undefined,
  gutter: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({ open: vi.fn() }),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogos: () => ({}) }));
vi.mock("../../../content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [], maps: [] } }),
  useUnitsyncUnitDataset: () => ({ dataset: null }),
  useUnitsyncGameInfo: () => ({ info: null }),
}));
vi.mock("../../../content/pages/components/UnitPicker", () => ({
  UnitPicker: () => null,
}));
vi.mock("../../../play/config", () => ({
  usePreferredTarget: () => ({ target: null }),
}));
vi.mock("../../../challenge/SubstitutedMapNote", () => ({
  SubstitutedMapNote: () => null,
}));
vi.mock("./RunSetup", () => ({ FactionDot: () => null }));
vi.mock("./BattleOverlayParts", () => ({
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
vi.mock("../../run", () => ({
  useConquestBattleRun: () => ({
    phase: "briefing",
    installedGame: { name: "Test Game 2.0" },
    ais: [],
    scenario: h.scenario,
    snapshot: () => null,
    lastSnapshot: null,
  }),
}));

import { BattleOverlay } from "./BattleOverlay";

const node: GalaxyNode = {
  id: "highmoor",
  name: "Highmoor",
  pos: [0, 0],
  owner: "neutral",
  difficulty: 3,
  battle: { mapName: "Comet Catcher Redux" },
};
const galaxy = {
  id: "two-shores",
  game: { shortname: "TG" },
  factions: [{ id: "west", name: "Western League", color: "#d9a441" }],
  nodes: [node],
  links: [],
} as unknown as GalaxyDoc;
const state = {
  playerFactionId: "west",
  owners: { highmoor: "neutral" },
  incursions: [],
  status: "active",
} as unknown as ConquestState;

function show() {
  render(
    <BattleOverlay
      galaxy={galaxy}
      node={node}
      state={state}
      mode="attack"
      onRestoreMap={async () => {}}
      onClose={() => {}}
    />,
  );
}

beforeEach(() => {
  h.scenario = undefined;
  h.gutter.mockClear();
  h.gate.mockClear();
});
afterEach(cleanup);

describe("the briefing for a scenario location", () => {
  beforeEach(() => {
    h.scenario = {
      name: "Siege",
      description: "The player must hold the keep before the clock runs out.",
    };
  });

  it("says it is a scenario and shows its name and description", () => {
    show();
    expect(screen.getByText("Scenario")).toBeTruthy();
    expect(screen.getByText("Siege")).toBeTruthy();
    expect(
      screen.getByText(
        "This location is a scenario, not a skirmish. The player must hold the keep before the clock runs out. Win it to take Highmoor.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Comet Catcher Redux")).toBeTruthy();
  });

  it("does not describe a garrison, which the scenario replaces", () => {
    show();
    expect(screen.queryByText("Opposition")).toBeNull();
  });

  it("offers no preset to save and waits on no skirmish AI", () => {
    show();
    expect(h.gutter.mock.calls[0][0].installedGame).toBe(false);
    expect(h.gate.mock.calls[0][0].aisAvailable).toBe(true);
  });

  it("reads well when the scenario has no description", () => {
    h.scenario = { name: "Siege", description: "" };
    show();
    expect(
      screen.getByText(
        "This location is a scenario, not a skirmish. Win it to take Highmoor.",
      ),
    ).toBeTruthy();
  });
});

describe("the briefing for a skirmish", () => {
  it("is as it was", () => {
    show();
    expect(screen.getByText("Opposition")).toBeTruthy();
    expect(screen.queryByText("Scenario")).toBeNull();
    expect(h.gutter.mock.calls[0][0].installedGame).toBe(true);
    expect(h.gate.mock.calls[0][0].aisAvailable).toBe(false);
  });
});
