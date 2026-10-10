import { describe, expect, it, vi } from "vitest";
import type { DemoInfo } from "./bindings";
import { storedHighlightMe } from "./highlightMe";
import { playerTeam, seriesTeams } from "./matchStats";
import {
  activeTeams,
  checkState,
  createEmphasisStore,
  isEmphasised,
  isShown,
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

describe("the checked set", () => {
  const plotted = () => {
    const s = createEmphasisStore();
    s.setPlot({ charted: [0, 1, 2, 3], resting: null });
    return s;
  };

  it("starts with every charted team checked", () => {
    const s = plotted();
    expect(s.getState().hidden).toEqual([]);
    expect(isShown(s.getState(), 2)).toBe(true);
    expect(checkState(s.getState(), [0, 1])).toBe(true);
  });

  it("unchecks one team and leaves the others", () => {
    const s = plotted();
    s.setShown([1], false);
    expect(isShown(s.getState(), 1)).toBe(false);
    expect(isShown(s.getState(), 0)).toBe(true);
    s.setShown([1], true);
    expect(s.getState().hidden).toEqual([]);
  });

  it("reads a side as checked, unchecked or indeterminate", () => {
    const s = plotted();
    const side = [0, 1];
    expect(checkState(s.getState(), side)).toBe(true);
    s.setShown([0], false);
    expect(checkState(s.getState(), side)).toBe("indeterminate");
    s.setShown([1], false);
    expect(checkState(s.getState(), side)).toBe(false);
    s.setShown(side, true);
    expect(checkState(s.getState(), side)).toBe(true);
  });

  it("does not count a team the chart does not draw", () => {
    const s = plotted();
    // Team 9 has no line, so a side of [3, 9] is checked or not by team 3 alone.
    expect(checkState(s.getState(), [3, 9])).toBe(true);
    s.setShown([3], false);
    expect(checkState(s.getState(), [3, 9])).toBe(false);
  });

  it("keeps the hidden set sorted and free of repeats, and is quiet when nothing changes", () => {
    const s = plotted();
    const listener = vi.fn();
    s.subscribe(listener);
    s.setShown([2, 0], false);
    s.setShown([0], false);
    expect(s.getState().hidden).toEqual([0, 2]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores emphasis on a team with no line, so nothing fades for no reason", () => {
    const s = plotted();
    s.toggleSelected([1]);
    s.setShown([1], false);
    expect(activeTeams(s.getState())).toBeNull();
    s.setShown([1], true);
    expect(activeTeams(s.getState())).toEqual([1]);
  });

  it("drops a hover on the team just unchecked, which would never see its leave", () => {
    const s = plotted();
    s.hover([1]);
    s.setShown([1], false);
    expect(s.getState().hovered).toBeNull();
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
