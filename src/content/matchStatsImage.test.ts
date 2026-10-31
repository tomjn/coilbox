/**
 * Issue #3836. The picture is built from the same series and rows the chart
 * draws, says what it is of, and carries none of the live chart's hover layers.
 */
import { describe, expect, it } from "vitest";
import type { DemoInfo, Metric, MetricKey } from "./bindings";
import type { ChartRow, ChartSeries } from "./matchStats";
import {
  type MatchStatsImageInput,
  matchStatsCaption,
  matchStatsImage,
  matchStatsImageFileName,
  niceTicks,
  timeTicks,
} from "./matchStatsImage";

const measure = (text: string) => text.length * 7;

const info = {
  gameId: "abc123",
  mapName: "Tabula & <Co>",
  startTimeMs: Date.UTC(2026, 9, 31, 14, 3, 30),
  players: [
    { name: "Alice", team: 0, allyTeam: 0, spectator: false },
    { name: "Bob", team: 1, allyTeam: 0, spectator: false },
    { name: "Cara", team: 2, allyTeam: 1, spectator: false },
    { name: "Watcher", team: 3, allyTeam: 1, spectator: true },
  ],
  ais: [{ name: "AI 1", shortName: "BARb", team: 3, allyTeam: 1 }],
} as unknown as DemoInfo;

const metric = {
  key: "exampleMetric" as MetricKey,
  label: "Metal produced",
  group: "economy",
  unit: "metal",
} as Metric;

function line(id: string, label: string, color: string): ChartSeries {
  return { id, label, color, samples: [] };
}

function rowsFor(ids: string[], points = 5): ChartRow[] {
  return Array.from({ length: points }, (_, i) => {
    const row: ChartRow = { timeSec: i * 60 };
    ids.forEach((id, n) => {
      row[id] = (i + 1) * 1000 * (n + 1);
    });
    return row;
  });
}

function input(
  count: number,
  over: Partial<MatchStatsImageInput> = {},
): MatchStatsImageInput {
  const series = Array.from({ length: count }, (_, i) =>
    line(
      `team${i}`,
      `Player ${i}`,
      `#${(i * 37 + 16).toString(16).padStart(2, "0")}3366`,
    ),
  );
  return {
    info,
    metric,
    mode: "cumulative",
    view: "players",
    series,
    rows: rowsFor(series.map((s) => s.id)),
    ...over,
  };
}

const paths = (svg: string) =>
  [...svg.matchAll(/<path [^>]*>/g)].map((m) => m[0]);

describe("matchStatsCaption", () => {
  it("names the map, date, players, metric, view, value mode and game id", () => {
    const c = matchStatsCaption({
      info,
      metric,
      mode: "perMinute",
      view: "teams",
    });
    expect(c.title).toBe("Metal produced");
    expect(c.facts).toEqual([
      { label: "Map", value: "Tabula & <Co>" },
      { label: "Date", value: "2026-10-31 14:03 UTC" },
      { label: "Players", value: "Alice, Bob vs Cara, BARb" },
      { label: "View", value: "Teams" },
      { label: "Values", value: "Per minute" },
      { label: "Game id", value: "abc123" },
    ]);
  });

  it("writes the cumulative players view", () => {
    const c = matchStatsCaption({
      info,
      metric,
      mode: "cumulative",
      view: "players",
    });
    expect(c.facts.find((f) => f.label === "View")?.value).toBe("Players");
    expect(c.facts.find((f) => f.label === "Values")?.value).toBe("Cumulative");
  });

  it("leaves out a fact the replay has no answer for", () => {
    const bare = { ...info, gameId: undefined, startTimeMs: 0 } as DemoInfo;
    const labels = matchStatsCaption({
      info: bare,
      metric,
      mode: "cumulative",
      view: "players",
    }).facts.map((f) => f.label);
    expect(labels).not.toContain("Date");
    expect(labels).not.toContain("Game id");
  });
});

describe("matchStatsImage", () => {
  it("writes the caption into the picture, escaped", () => {
    const { svg } = matchStatsImage(input(3), measure);
    expect(svg).toContain(">Metal produced</text>");
    expect(svg).toContain("Tabula &amp; &lt;Co&gt;");
    expect(svg).toContain("2026-10-31 14:03 UTC");
    expect(svg).toContain("Alice, Bob vs Cara, BARb");
    expect(svg).toContain(">Players</text>");
    expect(svg).toContain(">Cumulative</text>");
    expect(svg).toContain(">abc123</text>");
    expect(svg).not.toContain("Tabula & <Co>");
  });

  it("drops characters XML cannot hold", () => {
    const bad = { ...info, mapName: "Ma\u0000p\ud800" } as DemoInfo;
    const { svg } = matchStatsImage(input(2, { info: bad }), measure);
    // The label "Map" and the cleaned value "Map".
    expect(svg.match(/>Map<\/text>/g)).toHaveLength(2);
    expect(svg).not.toContain("\u0000");
    expect(svg).not.toContain("\ud800");
  });

  it("draws one path per line in the line's own colour", () => {
    const i = input(3);
    const found = paths(matchStatsImage(i, measure).svg);
    expect(found).toHaveLength(3);
    i.series.forEach((s, n) => {
      expect(found[n]).toContain(`data-series="${s.id}"`);
      expect(found[n]).toContain(`stroke="${s.color}"`);
    });
  });

  it("draws every line the same, with no hit line, halo or dimming", () => {
    // The input has no emphasis in it, so a hover or a selected line on screen
    // cannot reach the picture. What it would have added is checked for here.
    const { svg } = matchStatsImage(input(4), measure);
    expect(svg).not.toContain("transparent");
    expect(svg).not.toContain("currentColor");
    expect(svg).not.toContain("opacity");
    for (const p of paths(svg)) expect(p).toContain('stroke-width="2"');
    expect(svg).not.toContain('stroke-width="12"');
    expect(svg).not.toContain('stroke-width="9"');
    expect(svg).not.toContain('stroke-width="3.5"');
    expect(paths(svg)).toHaveLength(4);
  });

  it("uses concrete colours for ticks and grid", () => {
    const { svg } = matchStatsImage(input(2), measure);
    for (const fill of svg.matchAll(/(?:fill|stroke)="([^"]*)"/g))
      expect(fill[1]).toMatch(/^(none|#[0-9a-f]{6}|#[0-9a-f]{3})$/i);
  });

  it("names the font with system fonts only", () => {
    const { svg } = matchStatsImage(input(2), measure);
    expect(svg).toContain('font-family="system-ui');
    expect(svg).not.toContain("@font-face");
  });

  it("labels each line at its end when there are four or fewer", () => {
    const { svg } = matchStatsImage(input(4), measure);
    expect(svg.match(/data-end-label=/g)).toHaveLength(4);
    expect(svg).not.toContain("data-legend=");
  });

  it("uses a legend and no end labels past four lines", () => {
    const { svg, height } = matchStatsImage(input(12), measure);
    expect(svg.match(/data-legend=/g)).toHaveLength(12);
    expect(svg).not.toContain("data-end-label=");
    expect(height).toBeGreaterThan(matchStatsImage(input(4), measure).height);
  });

  it("wraps a long player list inside the picture", () => {
    const many = {
      ...info,
      players: Array.from({ length: 16 }, (_, n) => ({
        name: `Commander number ${n}`,
        team: n,
        allyTeam: n % 2,
        spectator: false,
      })),
      ais: [],
    } as unknown as DemoInfo;
    const short = matchStatsImage(input(2), measure);
    const tall = matchStatsImage(input(2, { info: many }), measure);
    expect(tall.height).toBeGreaterThan(short.height);
  });

  it("lifts the pen over a gap in a line's values", () => {
    const i = input(2);
    i.rows[2].team0 = null;
    const d = /data-series="team0" d="([^"]*)"/.exec(
      matchStatsImage(i, measure).svg,
    )?.[1];
    expect(d?.match(/M/g)).toHaveLength(2);
  });

  it("formats per minute figures as the chart does", () => {
    const series = [line("team0", "Alice", "#336699")];
    const rows: ChartRow[] = [
      { timeSec: 0, team0: 0 },
      { timeSec: 60, team0: 2.4 },
    ];
    const { svg } = matchStatsImage(
      input(1, { series, rows, mode: "perMinute" }),
      measure,
    );
    // The top tick is 2.5. The cumulative formatter would round it to 3.
    expect(svg).toContain(">2.5</text>");
    expect(svg).toContain(">0.5</text>");
  });

  it("draws a chart with no values without failing", () => {
    const series = [line("team0", "Alice", "#336699")];
    const { svg } = matchStatsImage(input(1, { series, rows: [] }), measure);
    expect(svg.startsWith("<svg")).toBe(true);
  });
});

describe("ticks", () => {
  it("rounds the value axis up from zero", () => {
    expect(niceTicks(4200)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
  });

  it("copes with nothing to scale", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });

  it("spaces time ticks for the match's length", () => {
    expect(timeTicks(240)).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240]);
    expect(timeTicks(2400).length).toBeLessThanOrEqual(9);
    expect(timeTicks(2400)[1]).toBe(300);
  });
});

describe("matchStatsImageFileName", () => {
  it("says the map, date, metric, view and mode", () => {
    expect(matchStatsImageFileName(info, metric, "teams", "perMinute")).toBe(
      "tabula-co-2026-10-31-metal-produced-teams-per-minute.png",
    );
  });

  it("falls back when nothing slugs", () => {
    const bare = { ...info, mapName: "", startTimeMs: 0 } as DemoInfo;
    const blank = { ...metric, label: "" } as Metric;
    expect(matchStatsImageFileName(bare, blank, "players", "cumulative")).toBe(
      "players-cumulative.png",
    );
  });
});
