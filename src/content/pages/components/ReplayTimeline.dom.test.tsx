// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine, ReplayPlayer, TimelineEvent } from "../../bindings";
import {
  playerTeams,
  timelineDomain,
  toEventMarks,
  toMarks,
} from "../../replayTimeline";
import type { EmphasisStore } from "../../seriesEmphasis";
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
      const matches = ben.matches.bind(ben);
      ben.matches = (selector: string) =>
        selector === ":focus-visible" || matches(selector);
      fireEvent.focus(ben);
      expect(store.getState().hovered).toEqual([1]);
      expect(lit(ben)).toBe("true");
      fireEvent.blur(ben);
      expect(store.getState().hovered).toBeNull();
    });

    it("does not point at a team on a focus that is not from the keyboard", () => {
      strip([said(60, 1)], vi.fn(), [], players, CHARTED);
      const mark = screen.getByRole("button");
      mark.matches = () => false;
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
});
