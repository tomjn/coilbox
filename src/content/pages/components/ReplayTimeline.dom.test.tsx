// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useLayoutEffect } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatLine, ReplayPlayer, TimelineEvent } from "../../bindings";
import {
  type ChartAxis,
  playerTeams,
  timelineDomain,
  toEventMarks,
  toMarks,
} from "../../replayTimeline";
import type { EmphasisStore } from "../../seriesEmphasis";
import { ChartAxisProvider, useSetChartAxis } from "../../useChartAxis";
import {
  SeriesEmphasisProvider,
  useSeriesEmphasis,
} from "../../useSeriesEmphasis";
import { ReplayTimeline } from "./ReplayTimeline";

afterEach(cleanup);

const line = (over: Partial<ChatLine>): ChatLine => ({
  frame: 0,
  time: 0,
  player: 0,
  text: "",
  system: false,
  ...over,
});

/** The page's emphasis store, so a test can point at a team the way the roster does. */
let store: EmphasisStore;
function GrabStore({ charted }: { charted: number[] }) {
  const e = useSeriesEmphasis();
  store = e.store;
  useEffect(
    () => e.store.setPlot({ charted, resting: null }),
    [e.store, charted],
  );
  return null;
}

function strip(
  lines: ChatLine[],
  onOpenLine = vi.fn(),
  events: TimelineEvent[] = [],
  players: ReplayPlayer[] = [],
  charted: number[] = [],
) {
  const marks = toMarks(lines);
  const eventMarks = toEventMarks(events);
  render(
    <SeriesEmphasisProvider>
      <GrabStore charted={charted} />
      <ReplayTimeline
        marks={marks}
        events={eventMarks}
        teamOf={playerTeams(players)}
        totalSec={timelineDomain([...marks, ...eventMarks], 600, false)}
        describe={(l) => l.text}
        onOpenLine={onOpenLine}
      />
    </SeriesEmphasisProvider>,
  );
  return onOpenLine;
}

describe("ReplayTimeline", () => {
  it("draws a row per kind present and labels the axis", () => {
    strip([
      line({ frame: 30 * 60, text: "one", dest: { kind: "everyone" } }),
      line({ frame: 30 * 120, text: "two", system: true, player: 255 }),
    ]);
    expect(screen.getByText("Everyone")).toBeTruthy();
    expect(screen.getByText("System")).toBeTruthy();
    expect(screen.queryByText("Allies")).toBeNull();
    expect(screen.getByText("0:00")).toBeTruthy();
    expect(screen.getByText("10:00")).toBeTruthy();
  });

  it("shows a mark's text when it takes keyboard focus", () => {
    strip([line({ frame: 30 * 60, text: "push the left flank" })]);
    expect(screen.queryByText("push the left flank")).toBeNull();
    const mark = screen.getByRole("button", { name: /Everyone, .*1 line/ });
    fireEvent.focus(mark);
    expect(screen.getByText("push the left flank")).toBeTruthy();
  });

  it("stacks a crowd into one mark that counts its lines", () => {
    strip([
      line({ frame: 30 * 60, text: "a" }),
      line({ frame: 30 * 61, text: "b" }),
      line({ frame: 30 * 62, text: "c" }),
    ]);
    const mark = screen.getByRole("button", { name: /3 lines/ });
    fireEvent.focus(mark);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("c")).toBeTruthy();
  });

  it("puts pregame lines in their own slot", () => {
    strip([line({ frame: -1, text: "hi" })]);
    expect(
      screen.getByRole("button", { name: /Before the game/ }),
    ).toBeTruthy();
    expect(screen.getByText("Before")).toBeTruthy();
  });

  it("hands the first line of a mark to the opener when selected", () => {
    const onOpen = strip([
      line({ frame: 30 * 5, text: "x" }),
      line({ frame: 30 * 300, text: "y" }),
    ]);
    fireEvent.click(screen.getAllByRole("button")[1]);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it("draws events in their own labelled rows and reads them out in words", () => {
    strip([line({ frame: 30 * 60, text: "hi" })], vi.fn(), [
      {
        frame: 30 * 120,
        time: 0,
        player: 2,
        playerName: "Ann",
        type: "resigned",
      },
      {
        frame: 30 * 300,
        time: 0,
        player: 3,
        playerName: "Ben",
        type: "playerLeft",
        reason: { kind: "lostConnection" },
      },
    ]);
    expect(screen.getByText("Resigned")).toBeTruthy();
    expect(screen.getByText("Left")).toBeTruthy();
    const mark = screen.getByRole("button", {
      name: /Event, Resigned, .*1 event/,
    });
    fireEvent.focus(mark);
    expect(screen.getByText(/Ann resigned/)).toBeTruthy();
    fireEvent.focus(
      screen.getByRole("button", { name: /Event, Left, .*1 event/ }),
    );
    expect(screen.getByText(/Ben lost connection/)).toBeTruthy();
  });

  it("only reads an event out when selected, since the chat log has nothing to open", () => {
    const onOpen = strip([], vi.fn(), [
      {
        frame: 30 * 120,
        time: 0,
        player: 2,
        playerName: "Ann",
        type: "paused",
        paused: true,
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Event, Pauses/ }));
    expect(screen.getByText(/Ann paused the game/)).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows no event rows for a replay with none", () => {
    strip([line({ frame: 30 * 60, text: "hi" })]);
    expect(screen.queryByText("Resigned")).toBeNull();
    expect(screen.queryByText("Pauses")).toBeNull();
  });

  describe("team emphasis", () => {
    const seat = (
      name: string,
      player: number | undefined,
      team: number,
      spectator = false,
    ): ReplayPlayer =>
      ({ name, player, team, allyTeam: team, spectator }) as ReplayPlayer;
    const players = [
      seat("Ann", 1, 0),
      seat("Ben", 2, 1),
      seat("Cat", undefined, 2),
      seat("Watcher", 3, 0, true),
    ];
    const said = (second: number, speaker: number): ChatLine =>
      line({ frame: 30 * second, player: speaker, text: `p${speaker}` });
    const CHARTED = [0, 1, 2];
    const lit = (b: HTMLElement) => b.dataset.emphasised;
    const faded = (b: HTMLElement) => b.className.includes("opacity-40");

    it("lights a mark with its team and dims the marks of other teams", () => {
      strip([said(60, 1), said(300, 2)], vi.fn(), [], players, CHARTED);
      const [ann, ben] = screen.getAllByRole("button");
      act(() => store.hover([0]));
      expect(lit(ann)).toBe("true");
      expect(faded(ann)).toBe(false);
      expect(lit(ben)).toBe("false");
      expect(faded(ben)).toBe(true);
      act(() => store.hover(null));
      expect(lit(ann)).toBe("false");
      expect(faded(ben)).toBe(false);
    });

    it("lights a mark that holds any lit team", () => {
      strip(
        [said(60, 1), said(61, 2), said(300, 2)],
        vi.fn(),
        [],
        players,
        CHARTED,
      );
      const [both, ben] = screen.getAllByRole("button");
      act(() => store.hover([0]));
      expect(lit(both)).toBe("true");
      expect(faded(ben)).toBe(true);
    });

    it("leaves spectator, server, system and unnumbered marks as they are", () => {
      strip(
        [
          said(60, 1),
          said(120, 3),
          said(180, 255),
          said(240, 9),
          line({ frame: 30 * 300, player: 255, system: true, text: "sys" }),
        ],
        vi.fn(),
        [],
        players,
        CHARTED,
      );
      const [ann, watcher, server, stranger, system] =
        screen.getAllByRole("button");
      act(() => store.hover([0]));
      expect(lit(ann)).toBe("true");
      for (const mark of [watcher, server, stranger, system]) {
        expect(lit(mark)).toBeUndefined();
        expect(faded(mark)).toBe(false);
        fireEvent.pointerEnter(mark);
      }
      // Pointing at them points at no team: the hover is still Ann's.
      expect(store.getState().hovered).toEqual([0]);
    });

    it("treats a player with no number as having no team", () => {
      // Cat is on team 2 but has no `player`, so no line can be tied to her.
      strip([said(60, 1), said(300, 9)], vi.fn(), [], players, CHARTED);
      const [ann, stranger] = screen.getAllByRole("button");
      act(() => store.hover([2]));
      expect(faded(ann)).toBe(true);
      expect(lit(stranger)).toBeUndefined();
      expect(faded(stranger)).toBe(false);
    });

    it("points at its team on pointer enter and clears on leave", () => {
      strip([said(60, 1), said(300, 2)], vi.fn(), [], players, CHARTED);
      const [, ben] = screen.getAllByRole("button");
      fireEvent.pointerEnter(ben);
      expect(store.getState().hovered).toEqual([1]);
      expect(lit(ben)).toBe("true");
      fireEvent.pointerLeave(ben);
      expect(store.getState().hovered).toBeNull();
    });

    it("points at its team on keyboard focus and clears on blur", () => {
      strip([said(60, 1), said(300, 2)], vi.fn(), [], players, CHARTED);
      const [, ben] = screen.getAllByRole("button");
      // happy-dom has no focus-visible state, so say the focus came from the keyboard.
      vi.spyOn(ben, "matches").mockImplementation(
        (selector: string) => selector === ":focus-visible",
      );
      fireEvent.focus(ben);
      expect(store.getState().hovered).toEqual([1]);
      expect(lit(ben)).toBe("true");
      fireEvent.blur(ben);
      expect(store.getState().hovered).toBeNull();
    });

    it("does not point at a team on a focus that is not from the keyboard", () => {
      strip([said(60, 1)], vi.fn(), [], players, CHARTED);
      const mark = screen.getByRole("button");
      vi.spyOn(mark, "matches").mockReturnValue(false);
      fireEvent.focus(mark);
      expect(store.getState().hovered).toBeNull();
    });

    it("does not point at a team the chart has no line for", () => {
      strip([said(60, 1)], vi.fn(), [], players, [1]);
      fireEvent.pointerEnter(screen.getByRole("button"));
      expect(store.getState().hovered).toBeNull();
    });

    it("still reads out and opens a mark while it is lit", () => {
      const onOpen = strip([said(60, 1)], vi.fn(), [], players, CHARTED);
      const mark = screen.getByRole("button");
      fireEvent.pointerEnter(mark);
      expect(screen.getByText("p1")).toBeTruthy();
      fireEvent.click(mark);
      expect(onOpen).toHaveBeenCalledWith(0);
    });
  });

  describe("the chart's axis", () => {
    const grid = () => screen.getByTestId("timeline-grid");

    /** The chart's end of the page, publishing an axis the way the chart column does. */
    function Chart({ axis }: { axis: ChartAxis }) {
      const setAxis = useSetChartAxis();
      useLayoutEffect(() => {
        setAxis(axis);
        return () => setAxis(null);
      }, [setAxis, axis]);
      return null;
    }

    function aligned(lines: ChatLine[], axis: ChartAxis | null) {
      const marks = toMarks(lines);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        left: 100,
        right: 1024,
      } as DOMRect);
      return render(
        <SeriesEmphasisProvider>
          <ChartAxisProvider>
            {axis && <Chart axis={axis} />}
            <ReplayTimeline
              marks={marks}
              totalSec={timelineDomain(marks, 600, false)}
              describe={(l) => l.text}
              onOpenLine={vi.fn()}
            />
          </ChartAxisProvider>
        </SeriesEmphasisProvider>,
      );
    }

    const CHART: ChartAxis = { left: 352, right: 1012, endSec: 300 };

    beforeAll(() => {
      globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });

    afterEach(() => vi.restoreAllMocks());

    it("keeps its own axis on a replay with no statistics", () => {
      aligned([line({ frame: 30 * 60, text: "one" })], null);
      expect(grid().getAttribute("style")).toBeNull();
      expect(grid().className).toContain("grid-cols-[5.5rem_minmax(0,1fr)]");
      expect(screen.getByText("10:00")).toBeTruthy();
    });

    it("keeps its own axis with no provider above it", () => {
      strip([line({ frame: 30 * 60, text: "one" })]);
      expect(grid().getAttribute("style")).toBeNull();
    });

    it("puts its strip under the chart's plot", () => {
      aligned([line({ frame: 30 * 60, text: "one" })], CHART);
      expect(grid().style.gridTemplateColumns).toBe("252px minmax(0,1fr)");
      expect(grid().style.paddingRight).toBe("12px");
      expect(grid().className).not.toContain("grid-cols-");
    });

    it("runs to the chart's end, not its own, so a moment sits under the same moment", () => {
      aligned([line({ frame: 30 * 150, text: "half way" })], CHART);
      expect(screen.queryByText("10:00")).toBeNull();
      expect(screen.getByText("5:00")).toBeTruthy();
      const mark = screen.getByRole("button", { name: /1 line/ });
      expect(mark.style.left).toBe("50%");
    });

    it("keeps a line after the chart's last sample on the strip, in the last column", () => {
      aligned([line({ frame: 30 * 400, text: "gg" })], CHART);
      const mark = screen.getByRole("button", { name: /1 line/ });
      expect(Number.parseFloat(mark.style.left)).toBeLessThan(100);
      expect(Number.parseFloat(mark.style.left)).toBeGreaterThan(98);
    });

    it("moves row labels above the strip when the gap left of the axis is too narrow", () => {
      aligned([line({ frame: 30 * 60, text: "one" })], {
        ...CHART,
        left: 152,
      });
      expect(grid().style.gridTemplateColumns).toBe("52px minmax(0,1fr)");
      expect(screen.getByText("Everyone").className).toContain("col-span-full");
    });

    it("goes back to its own axis when the chart goes away", () => {
      const { rerender } = aligned(
        [line({ frame: 30 * 60, text: "one" })],
        CHART,
      );
      expect(grid().getAttribute("style")).not.toBeNull();
      const marks = toMarks([line({ frame: 30 * 60, text: "one" })]);
      rerender(
        <SeriesEmphasisProvider>
          <ChartAxisProvider>
            <ReplayTimeline
              marks={marks}
              totalSec={600}
              describe={(l) => l.text}
              onOpenLine={vi.fn()}
            />
          </ChartAxisProvider>
        </SeriesEmphasisProvider>,
      );
      expect(grid().getAttribute("style")).toBeNull();
      expect(screen.getByText("10:00")).toBeTruthy();
    });
  });
});
