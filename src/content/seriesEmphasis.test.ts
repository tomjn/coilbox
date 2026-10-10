import { describe, expect, it, vi } from "vitest";
import type { DemoInfo } from "./bindings";
import { storedHighlightMe } from "./highlightMe";
import { playerTeam, seriesTeams } from "./matchStats";
import {
  activeTeams,
  createEmphasisStore,
  isEmphasised,
  sameTeams,
} from "./seriesEmphasis";

describe("emphasis store", () => {
  it("starts with nothing emphasised", () => {
    const s = createEmphasisStore();
    expect(activeTeams(s.getState())).toBeNull();
    expect(isEmphasised(s.getState(), [1])).toBe(false);
  });

  it("lets hover beat selection and selection beat the resting emphasis", () => {
    const s = createEmphasisStore();
    s.setPlot({ charted: [1, 2, 3], resting: [1] });
    expect(activeTeams(s.getState())).toEqual([1]);
    s.toggleSelected([2]);
    expect(activeTeams(s.getState())).toEqual([2]);
    s.hover([3]);
    expect(activeTeams(s.getState())).toEqual([3]);
    s.hover(null);
    expect(activeTeams(s.getState())).toEqual([2]);
    s.toggleSelected([2]);
    expect(activeTeams(s.getState())).toEqual([1]);
  });

  it("selecting a different series replaces the selection", () => {
    const s = createEmphasisStore();
    s.toggleSelected([1]);
    s.toggleSelected([2]);
    expect(s.getState().selected).toEqual([2]);
  });

  it("matches a side's line to any of its members", () => {
    const s = createEmphasisStore();
    s.hover([4]);
    expect(isEmphasised(s.getState(), [3, 4])).toBe(true);
    expect(isEmphasised(s.getState(), [5])).toBe(false);
    expect(isEmphasised(s.getState(), undefined)).toBe(false);
  });

  it("notifies on a change and stays quiet when nothing changed", () => {
    const s = createEmphasisStore();
    const listener = vi.fn();
    const off = s.subscribe(listener);
    s.hover([1]);
    s.hover([1]);
    expect(listener).toHaveBeenCalledTimes(1);
    s.setPlot({ charted: [1], resting: null });
    s.setPlot({ charted: [1], resting: null });
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    s.hover(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("compares team sets by content", () => {
    expect(sameTeams([1, 2], [1, 2])).toBe(true);
    expect(sameTeams([1, 2], [1])).toBe(false);
    expect(sameTeams(null, null)).toBe(true);
    expect(sameTeams(null, [])).toBe(false);
  });
});

describe("series to teams", () => {
  const info = {
    players: [
      { name: "me", spectator: false, team: 0, allyTeam: 0 },
      { name: "you", spectator: false, team: 1, allyTeam: 1 },
      { name: "ally", spectator: false, team: 2, allyTeam: 1 },
      { name: "watcher", spectator: true, team: 3, allyTeam: 0 },
    ],
    ais: [{ name: "bot", team: 4, allyTeam: 1 }],
  } as unknown as DemoInfo;

  it("names one team for a player's line and every member for a side's", () => {
    expect(seriesTeams({ id: "team2" }, info)).toEqual([2]);
    expect(seriesTeams({ id: "ally1" }, info)).toEqual([1, 2, 4]);
    expect(seriesTeams({ id: "nonsense" }, info)).toEqual([]);
  });

  it("finds a seated player's team, never a spectator's", () => {
    expect(playerTeam(info, "me")).toBe(0);
    expect(playerTeam(info, "watcher")).toBeUndefined();
    expect(playerTeam(info, "nobody")).toBeUndefined();
  });
});

describe("highlight me preference", () => {
  it("is off unless a valid value is stored", () => {
    expect(storedHighlightMe(null)).toBe(false);
    expect(storedHighlightMe("junk")).toBe(false);
    expect(storedHighlightMe("false")).toBe(false);
    expect(storedHighlightMe("true")).toBe(true);
  });
});
