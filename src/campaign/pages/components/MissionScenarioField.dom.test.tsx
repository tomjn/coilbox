// @vitest-environment happy-dom
/**
 * Which document a campaign mission shows as its mission Lua (issue #2163).
 *
 * Attaching copies the whole scenario into the mission, so from that moment
 * there are two documents with the same id: the copy the campaign plays, and
 * the one the author went on editing in the builder. The difference between
 * them is the thing somebody opens this to see, so the case worth pinning is
 * the stale one.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The stored scenarios come off disk through the plugin, which a test has no
// business standing up. What matters here is the comparison the field makes
// between what is stored and what the mission carries.
const { useScenarios } = vi.hoisted(() => ({ useScenarios: vi.fn() }));
vi.mock("@/scenario/scenarios", () => ({ useScenarios }));

import { newScenario } from "@/scenario/create";
import type { Scenario } from "@/scenario/model";
import { attachScenario } from "../../missionScenario";
import type { CampaignMission } from "../../model";
import { MissionScenarioField } from "./MissionScenarioField";

/** A scenario with one zone whose name says which version of it this is. */
function versioned(zoneName: string, updatedAt: string): Scenario {
  return {
    ...newScenario("Beachhead"),
    id: "beachhead",
    updatedAt,
    zones: [
      {
        id: "landing",
        name: zoneName,
        shape: "circle",
        center: { x: 512, z: 512 },
        radius: 300,
      },
    ],
  };
}

const mission: CampaignMission = {
  id: "m1",
  title: "Beachhead",
  briefing: "",
  objectives: [],
  snapshot: newScenario("Beachhead").setup,
  disabledUnits: [],
  skippable: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a campaign mission's compiled scenario", () => {
  it("shows the copy attached to the mission, not the scenario edited since", () => {
    const attached = versioned("As attached", "2026-01-01T00:00:00.000Z");
    const editedSince = versioned("Renamed since", "2026-02-01T00:00:00.000Z");
    useScenarios.mockReturnValue({
      scenarios: [{ scenario: editedSince }],
      loading: false,
    });

    render(
      <MissionScenarioField
        mission={attachScenario(mission, attached)}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mission Lua/ }));

    const lua = screen
      .getAllByTestId("mission-lua-line-text")
      .map((el) => el.textContent)
      .join("\n");
    expect(lua).toContain('"As attached"');
    expect(lua).not.toContain('"Renamed since"');
  });

  it("offers nothing to read when no scenario is attached", () => {
    useScenarios.mockReturnValue({ scenarios: [], loading: false });

    render(<MissionScenarioField mission={mission} onChange={() => {}} />);

    expect(screen.queryByRole("button", { name: /Mission Lua/ })).toBeNull();
  });
});
