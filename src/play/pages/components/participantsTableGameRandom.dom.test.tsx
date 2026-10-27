// @vitest-environment happy-dom

/**
 * BAR ships a side named Random that the game rolls itself. Offering coilbox's
 * own Random beside it put two Random entries in the faction picker, so the
 * game's one takes its place.
 */

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Participant, RANDOM_SIDE } from "../../config";
import { ParticipantsTable } from "./ParticipantsTable";

// Radix's select draws its options only once open, so a native one stands in.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    options,
  }: {
    value: string;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={() => {}}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

afterEach(cleanup);

const randomBot: Participant = {
  id: "bot",
  kind: "ai",
  name: "Bot",
  ai: { kind: "native", shortName: "BARb", name: "BARb" },
  side: RANDOM_SIDE,
  color: [0.31, 0.55, 1],
  allyTeam: 1,
  spectator: false,
};

function renderWith(sides: { name: string }[]) {
  render(
    <MemoryRouter>
      <ParticipantsTable
        participants={[randomBot]}
        sides={sides as never}
        ais={[]}
        startPosType={1}
        onUpdate={vi.fn()}
        onSetTeam={vi.fn()}
        onRemove={vi.fn()}
        onAddAi={vi.fn()}
        onClearAis={vi.fn()}
        onSetAiBonus={vi.fn()}
        onSetAllAiBonus={vi.fn()}
      />
    </MemoryRouter>,
  );
  // Ally and team use the same select, so pick the one holding the factions.
  const select = [...document.querySelectorAll("select")].find(
    (s) => s.querySelector('option[value="Armada"]') !== null,
  );
  if (!select) throw new Error("no faction select");
  return {
    select,
    labels: [...select.querySelectorAll("option")].map((o) => o.textContent),
  };
}

describe("faction picker Random", () => {
  it("offers coilbox's Random when the game has none", () => {
    const { select, labels } = renderWith([
      { name: "Armada" },
      { name: "Cortex" },
    ]);
    expect(labels).toEqual(["Random", "Armada", "Cortex"]);
    expect(select.value).toBe(RANDOM_SIDE);
  });

  it("offers only the game's Random when it has one, and shows a random row on it", () => {
    const { select, labels } = renderWith([
      { name: "Armada" },
      { name: "Cortex" },
      { name: "Random" },
    ]);
    expect(labels).toEqual(["Armada", "Cortex", "Random"]);
    expect(select.value).toBe("Random");
  });
});
