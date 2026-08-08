import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricKey,
  TeamStatSample,
} from "../../bindings";
import { modeRows, teamSeries, valueTable } from "../../matchStats";
import { MatchStatsTable } from "./MatchStatsTable";

/**
 * The table is the fallback for a reader the chart is nothing at all to, so
 * what it renders is checked as markup rather than trusted: a caption that
 * names it, a header cell per column, and a header cell per row carrying the
 * match time.
 *
 * Rendered to a string, because vitest runs in node with no DOM. That is enough
 * to read the elements and their `scope`, which is what a screen reader is
 * given.
 */

function sample(frame: number): TeamStatSample {
  return {
    frame,
    metalUsed: 0,
    energyUsed: 0,
    metalProduced: 0,
    energyProduced: 0,
    metalExcess: 0,
    energyExcess: 0,
    metalReceived: 0,
    energyReceived: 0,
    metalSent: 0,
    energySent: 0,
    damageDealt: 0,
    damageReceived: 0,
    unitsProduced: 0,
    unitsDied: 0,
    unitsReceived: 0,
    unitsSent: 0,
    unitsCaptured: 0,
    unitsOutCaptured: 0,
    unitsKilled: 0,
  };
}

/** No metric is named here either: the key comes from the sample's own fields. */
const KEY = Object.keys(sample(0)).filter((k) => k !== "frame")[0] as MetricKey;

function at(frame: number, value: number): TeamStatSample {
  const s = sample(frame);
  s[KEY] = value;
  return s;
}

const metric: Metric = {
  key: KEY,
  label: "Damage dealt",
  group: "military",
  unit: "count",
  roster: true,
  headline: true,
  surfaced: true,
};

/**
 * Two seats, sampled every 15 seconds from frame 1800, and the second stops
 * being recorded before the first. The times are not the row numbers and the
 * figures are all different, so nothing here can be right by coincidence. One
 * seat is in the millions and the other is a float, which is the pair the
 * chart's own formatter would print as `1.05M` and `478`.
 */
const trailer: DemoTrailer = {
  winningAllyTeams: [],
  teamStatPeriodSec: 15,
  teams: [
    {
      team: 0,
      samples: [at(1800, 1_050_000), at(2250, 2_100_000), at(2700, 3_150_000)],
    },
    {
      team: 1,
      samples: [at(1800, 477.93275451660156), at(2250, 7424.070068359375)],
    },
  ],
};

const info: DemoInfo = {
  engineVersion: "105",
  startTimeMs: 0,
  durationSec: 600,
  wallclockSec: 600,
  mapName: "Greenhaven",
  gameType: "Beyond All Reason test",
  winningAllyTeams: [],
  winnersKnown: false,
  numAllyTeams: 2,
  allyTeams: [],
  players: [
    { name: "sprung", spectator: false, team: 0 },
    { name: "mate", spectator: false, team: 1 },
  ],
  ais: [],
  modOptions: {},
};

function markup(mode: "cumulative" | "perMinute" = "cumulative"): string {
  const series = teamSeries(trailer, info);
  const rows = modeRows(series, KEY, 1 / 30, mode);
  const table = valueTable(series, rows, { metric, mode, view: "players" });
  return renderToStaticMarkup(createElement(MatchStatsTable, { table }));
}

/** Every `<th>`, with its scope and its text. */
function headers(html: string): { scope: string; text: string }[] {
  return [...html.matchAll(/<th[^>]*scope="(col|row)"[^>]*>(.*?)<\/th>/g)].map(
    (m) => ({ scope: m[1], text: m[2].replace(/<[^>]*>/g, "") }),
  );
}

describe("the value table's markup", () => {
  it("is a table, not a grid of divs", () => {
    const html = markup();
    expect(html).toContain("<table");
    expect(html).toContain("<tbody");
  });

  it("is named by a caption that says what is in it", () => {
    const html = markup();
    expect(html).toMatch(
      /<caption[^>]*>Damage dealt in total, by player, over match time<\/caption>/,
    );
  });

  it("names its scrolling region with that same caption", () => {
    // A scrolled box has to be reachable and named, and pointing at the caption
    // keeps one string rather than two that can drift apart.
    const id = /<caption[^>]*id="([^"]+)"/.exec(markup())?.[1];
    expect(id).toBeTruthy();
    expect(markup()).toContain(`aria-labelledby="${id}"`);
  });

  it("heads every column with a real header cell", () => {
    const cols = headers(markup()).filter((h) => h.scope === "col");
    expect(cols.map((h) => h.text)).toEqual(["Time", "sprung", "mate"]);
  });

  it("heads every row with the match time it belongs to", () => {
    // Sampling starts at frame 1800, so a row numbered from its position in the
    // list reads 0:00, 0:15, 0:30 and every one of these fails.
    const rows = headers(markup()).filter((h) => h.scope === "row");
    expect(rows.map((h) => h.text)).toEqual(["1:00", "1:15", "1:30"]);
  });

  it("prints the figures rather than the chart's shorthand", () => {
    const html = markup();
    // What the axis and the tooltip would say instead: 1.05M, 2.1M, 3.15M, 478.
    const printed = ["1,050,000", "2,100,000", "3,150,000", "477.93"];
    for (const value of printed) expect(html).toContain(`>${value}</td>`);
    expect(html).not.toContain("M</td>");
  });

  it("says a line has no reading rather than printing a zero there", () => {
    // The second seat stops after 1:15, and its last cell is the one that has
    // to say so out loud.
    const cells = [...markup().matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(
      (m) => m[1],
    );
    expect(cells.at(-1)).toContain("no reading");
    expect(cells.at(-1)).not.toContain(">0<");
  });

  it("prints the rates when the rate is what was asked for", () => {
    // 1,050,000 to 2,100,000 in a quarter of a minute is 4,200,000 a minute,
    // and 477.93 to 7,424.07 in the same quarter minute is 27,784.55.
    const rows = [...markup("perMinute").matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(
      (m) => m[1].replace(/<[^>]*>/g, "|"),
    );
    expect(rows[1]).toContain("4,200,000");
    expect(rows[1]).toContain("27,784.55");
    // The running totals themselves are the answer to the other question.
    expect(rows[1]).not.toContain("2,100,000");
  });
});
