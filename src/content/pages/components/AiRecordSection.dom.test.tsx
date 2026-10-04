// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StatAi, StatRecord } from "../../bindings";
import { AiRecordSection } from "./AiRecordSection";

let seq = 0;

function skirmish(
  ai: Partial<StatAi>,
  won: boolean | undefined,
  gameType = "BAR",
): StatRecord {
  seq += 1;
  return {
    filename: `s${seq}.sdfz`,
    path: `/demos/s${seq}.sdfz`,
    mapName: "Comet",
    gameType,
    engineVersion: "105",
    durationSec: 600,
    startTimeMs: seq * 1000,
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: won !== undefined,
    winningAllyTeams: [0],
    remixed: false,
    players: [{ name: "me", allyTeam: 0, spectator: false, won }],
    ais: [{ name: "AI 1", shortName: "BARb", allyTeam: 1, ...ai }],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
  };
}

const none: ReadonlySet<string> = new Set();

afterEach(cleanup);

describe("AiRecordSection", () => {
  it("shows a row per AI and bonus, with the bonus and the result", () => {
    const records = [
      skirmish({}, true),
      skirmish({ advantage: 0.25 }, true),
      skirmish({ advantage: 0.25 }, false),
      skirmish({ shortName: "SurvivalAI" }, undefined),
    ];
    render(
      <AiRecordSection
        records={records}
        playerName="me"
        refights={none}
        scripted={none}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const boosted = rows.find((r) => within(r).queryByText("+25%"));
    expect(boosted).toBeDefined();
    expect(boosted?.textContent).toContain("BARb");
    expect(boosted?.textContent).toContain("1W · 1L");

    const plain = rows.find(
      (r) =>
        within(r).queryByText("No bonus") && r.textContent?.includes("BARb"),
    );
    expect(plain?.textContent).toContain("1W · 0L");

    const undecided = rows.find((r) => r.textContent?.includes("SurvivalAI"));
    expect(undecided?.textContent).toContain("1 undecided");
    expect(undecided?.textContent).toContain("no result");
  });

  it("shows the empty state when there are no games against AI", () => {
    const scripted = skirmish({}, true);
    render(
      <AiRecordSection
        records={[scripted]}
        playerName="me"
        refights={none}
        scripted={new Set([scripted.filename])}
      />,
    );
    expect(screen.getByText(/No skirmishes against AI yet/)).toBeDefined();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
