import { describe, expect, it } from "vitest";
import { CHART_PALETTE } from "@/lib/chartPalette";
import { BASES, contrast, hsl, type Rgb } from "@/lib/contrast.testhelper";
import { rgbToHex } from "@/play/participants";
import type { DemoInfo, DemoTrailer, TeamStatSample } from "./bindings";
import { storedColorMode } from "./chartColorMode";
import {
  allySeries,
  autoColorMode,
  type ChartColorMode,
  colorSeries,
  partlyHidden,
  shownSeries,
  teamSeries,
} from "./matchStats";

type Seat = {
  team: number;
  ally: number;
  rgb?: [number, number, number];
};

/** Colours never read a figure, so a sample is only its frame. */
function sample(frame: number): TeamStatSample {
  return { frame } as TeamStatSample;
}

function match(seats: Seat[]): { trailer: DemoTrailer; info: DemoInfo } {
  const trailer: DemoTrailer = {
    winningAllyTeams: [],
    teamStatPeriodSec: 15,
    teams: seats.map((s) => ({
      team: s.team,
      samples: [sample(0), sample(450)],
    })),
  };
  const info = {
    winningAllyTeams: [],
    winnersKnown: false,
    players: seats.map((s) => ({
      name: `p${s.team}`,
      spectator: false,
      team: s.team,
      allyTeam: s.ally,
      rgbColor: s.rgb,
    })),
    ais: [],
  } as unknown as DemoInfo;
  return { trailer, info };
}

const colours = (
  seats: Seat[],
  mode: ChartColorMode,
  view: "players" | "teams" = "players",
  theme: "dark" | "light" = "dark",
) => {
  const { trailer, info } = match(seats);
  const lines =
    view === "teams" ? allySeries(trailer, info) : teamSeries(trailer, info);
  return colorSeries(lines, trailer, info, mode, theme);
};

const hexToRgb = (h: string): Rgb => [
  Number.parseInt(h.slice(1, 3), 16) / 255,
  Number.parseInt(h.slice(3, 5), 16) / 255,
  Number.parseInt(h.slice(5, 7), 16) / 255,
];

const red: [number, number, number] = [1, 0, 0];
const blue: [number, number, number] = [0, 0, 1];

describe("colorSeries in palette mode", () => {
  const four: Seat[] = [0, 1, 2, 3].map((t) => ({
    team: t,
    ally: t % 2,
    rgb: red,
  }));

  it("gives each team the slot its number holds and ignores the game's colours", () => {
    expect(colours(four, "palette").map((s) => s.color)).toEqual(
      CHART_PALETTE.slice(0, 4),
    );
  });

  it("does not repaint the others when a team is not drawn", () => {
    const { trailer, info } = match(four);
    const all = colorSeries(
      teamSeries(trailer, info),
      trailer,
      info,
      "palette",
      "dark",
    );
    const fewer = colorSeries(
      teamSeries(trailer, info).filter((s) => s.id !== "team1"),
      trailer,
      info,
      "palette",
      "dark",
    );
    for (const s of fewer)
      expect(s.color).toBe(all.find((a) => a.id === s.id)?.color);
  });

  it("is the same in either theme", () => {
    expect(colours(four, "palette", "players", "light")).toEqual(
      colours(four, "palette", "players", "dark"),
    );
  });

  it("gives a side the slot of its first member", () => {
    const sides = colours(four, "palette", "teams");
    expect(sides.map((s) => [s.id, s.color])).toEqual([
      ["ally0", CHART_PALETTE[0]],
      ["ally1", CHART_PALETTE[1]],
    ]);
  });

  it("colours by side once there are more teams than slots", () => {
    const many: Seat[] = Array.from({ length: 12 }, (_, t) => ({
      team: t,
      ally: t % 3,
    }));
    const players = colours(many, "palette");
    expect(players).toHaveLength(12);
    for (const s of players) {
      const team = Number(s.id.slice(4));
      expect(s.color).toBe(CHART_PALETTE[team % 3]);
    }
    const sides = colours(many, "palette", "teams");
    expect(sides.map((s) => s.color)).toEqual(CHART_PALETTE.slice(0, 3));
  });
});

describe("colorSeries in game mode", () => {
  it("keeps the game's colour where it is already legible", () => {
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: red },
      { team: 1, ally: 1, rgb: blue },
    ];
    expect(colours(seats, "game", "players", "light")[0].color).toBe(
      rgbToHex(red),
    );
  });

  it("corrects lightness only where the colour is illegible", () => {
    const navy: [number, number, number] = [0.1, 0.14, 0.49];
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: navy },
      { team: 1, ally: 1, rgb: red },
    ];
    const before = rgbToHex(navy);
    const after = colours(seats, "game", "players", "dark")[0].color;
    expect(after).not.toBe(before);
    const hue = (h: string) => {
      const [r, g, b] = hexToRgb(h);
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      const k =
        max === r
          ? ((g - b) / d + 6) % 6
          : max === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      return k * 60;
    };
    expect(Math.abs(hue(after) - hue(before))).toBeLessThan(3);
  });

  it("leaves every corrected colour at 3:1 on the card of every preset", () => {
    // WCAG 2.2 SC 1.4.11 Non-text Contrast, the floor for a chart line. Dark
    // cards are `hsl(base-hue, base-sat * 5%, 10%)`, the light card is white.
    const dark: [number, number, number][] = [
      [0.1, 0.14, 0.49],
      [0.19, 0.06, 0.19],
      [0.04, 0.23, 0.04],
      [0.25, 0, 0],
      [0.13, 0.13, 0.13],
    ];
    const light: [number, number, number][] = [
      [1, 1, 0.6],
      [0.9, 0.95, 1],
      [0.85, 0.85, 0.85],
      [1, 0.8, 0.5],
    ];
    const failures: string[] = [];
    for (const [theme, set] of [
      ["dark", dark],
      ["light", light],
    ] as const)
      for (const rgb of set) {
        const seats: Seat[] = [
          { team: 0, ally: 0, rgb },
          { team: 1, ally: 1, rgb: red },
        ];
        const fixed = hexToRgb(
          colours(seats, "game", "players", theme)[0].color,
        );
        for (const [name, h, s] of BASES) {
          const card = theme === "light" ? [1, 1, 1] : hsl(h, s * 0.05, 0.1);
          const ratio = contrast(fixed, card as Rgb);
          if (ratio < 3) failures.push(`${theme} ${name} ${rgb}: ${ratio}`);
        }
      }
    expect(failures).toEqual([]);
  });

  it("treats colours that are all the same as absent", () => {
    const seats: Seat[] = [0, 1, 2].map((t) => ({
      team: t,
      ally: t,
      rgb: red,
    }));
    expect(colours(seats, "game").map((s) => s.color)).toEqual(
      CHART_PALETTE.slice(0, 3),
    );
  });

  it("keeps a lone seat's colour, which cannot disagree with anyone", () => {
    const lone = colours(
      [{ team: 0, ally: 0, rgb: red }],
      "game",
      "players",
      "light",
    );
    expect(lone[0].color).toBe(rgbToHex(red));
  });
});

describe("storedColorMode", () => {
  it("reads the two modes and treats anything else as never chosen", () => {
    expect(storedColorMode("game")).toBe("game");
    expect(storedColorMode("palette")).toBe("palette");
    expect(storedColorMode(null)).toBeNull();
    expect(storedColorMode("sepia")).toBeNull();
  });
});

describe("autoColorMode", () => {
  const pick = (seats: Seat[], theme: "dark" | "light" = "dark") => {
    const { trailer, info } = match(seats);
    return autoColorMode(
      teamSeries(trailer, info),
      allySeries(trailer, info),
      info,
      theme,
    );
  };
  const rgb = (hex: string): [number, number, number] => hexToRgb(hex);

  it("keeps the game's colours when they read well and stay apart", () => {
    const seats: Seat[] = ["#ff8000", "#2080ff", "#e0e000", "#ff40c0"].map(
      (h, t) => ({ team: t, ally: t, rgb: rgb(h) }),
    );
    expect(pick(seats)).toBe("game");
  });

  it("falls back to the palette when a colour is near black on a dark card", () => {
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: [0.02, 0.02, 0.02] },
      { team: 1, ally: 1, rgb: rgb("#ff8000") },
    ];
    expect(pick(seats, "dark")).toBe("palette");
  });

  it("falls back to the palette when a colour is white on a light card", () => {
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: [1, 1, 1] },
      { team: 1, ally: 1, rgb: rgb("#ff8000") },
    ];
    expect(pick(seats, "light")).toBe("palette");
  });

  it("falls back to the palette when two colours are near identical", () => {
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: rgb("#20c020") },
      { team: 1, ally: 1, rgb: rgb("#28c828") },
    ];
    expect(pick(seats)).toBe("palette");
  });

  it("falls back to the palette when every colour is the same", () => {
    const seats: Seat[] = [0, 1, 2].map((t) => ({
      team: t,
      ally: t,
      rgb: red,
    }));
    expect(pick(seats)).toBe("palette");
  });

  it("falls back to the palette when two colours differ only for normal vision", () => {
    // Delta E 21 for normal vision, 4.7 under deutan simulation.
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: rgb("#ff3000") },
      { team: 1, ally: 1, rgb: rgb("#a08000") },
    ];
    expect(pick(seats)).toBe("palette");
  });

  it("follows the theme", () => {
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: rgb("#ffe040") },
      { team: 1, ally: 1, rgb: rgb("#2080ff") },
    ];
    expect(pick(seats, "dark")).toBe("game");
    expect(pick(seats, "light")).toBe("palette");
  });

  it("picks game colours for a team game whose sides and players all read", () => {
    const seats: Seat[] = [
      { team: 0, ally: 0, rgb: rgb("#ff8000") },
      { team: 1, ally: 0, rgb: rgb("#2080ff") },
      { team: 2, ally: 1, rgb: rgb("#e0e000") },
    ];
    expect(pick(seats)).toBe("game");
  });
});

describe("unchecking a team in the roster", () => {
  const seats: Seat[] = [
    { team: 0, ally: 0, rgb: [1, 0, 0] },
    { team: 1, ally: 0, rgb: [0, 1, 0] },
    { team: 2, ally: 1, rgb: [0, 0, 1] },
    { team: 3, ally: 1, rgb: [1, 1, 0] },
  ];
  const charted = [0, 1, 2, 3];

  /** Painted from the whole match, then narrowed, as the chart does it. */
  function narrowed(
    hidden: number[],
    mode: ChartColorMode,
    view: "players" | "teams",
  ) {
    const { trailer, info } = match(seats);
    const lines =
      view === "teams" ? allySeries(trailer, info) : teamSeries(trailer, info);
    const painted = colorSeries(lines, trailer, info, mode, "dark");
    return {
      painted,
      shown: shownSeries(painted, info, charted, hidden),
      partial: partlyHidden(
        shownSeries(painted, info, charted, hidden),
        info,
        charted,
        hidden,
      ),
    };
  }

  for (const mode of ["palette", "game"] as const) {
    for (const view of ["players", "teams"] as const) {
      it(`removes the line and repaints nobody (${mode}, ${view})`, () => {
        const hidden = view === "teams" ? [0, 1] : [1];
        const { painted, shown } = narrowed(hidden, mode, view);
        expect(shown.length).toBeLessThan(painted.length);
        for (const s of shown)
          expect(s.color).toBe(painted.find((p) => p.id === s.id)?.color);
      });
    }
  }

  it("removes a player's line when that team is unchecked", () => {
    const { shown } = narrowed([1], "palette", "players");
    expect(shown.map((s) => s.id)).toEqual(["team0", "team2", "team3"]);
  });

  it("keeps a side's line while any member is checked, at the full side total", () => {
    const { painted, shown, partial } = narrowed([0], "palette", "teams");
    expect(shown.map((s) => s.id)).toEqual(["ally0", "ally1"]);
    // The very same line, so its samples still add up every member.
    expect(shown[0]).toBe(painted[0]);
    expect(partial.map((s) => s.id)).toEqual(["ally0"]);
  });

  it("removes a side's line once every member is unchecked", () => {
    const { shown, partial } = narrowed([0, 1], "palette", "teams");
    expect(shown.map((s) => s.id)).toEqual(["ally1"]);
    expect(partial).toEqual([]);
  });

  it("hands back the same lines when nothing is unchecked", () => {
    const { painted, shown } = narrowed([], "palette", "players");
    expect(shown).toBe(painted);
  });
});
