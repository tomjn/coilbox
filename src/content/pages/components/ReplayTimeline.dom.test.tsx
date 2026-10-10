// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatLine, TimelineEvent } from "../../bindings";
import { timelineDomain, toEventMarks, toMarks } from "../../replayTimeline";
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

function strip(
  lines: ChatLine[],
  onOpenLine = vi.fn(),
  events: TimelineEvent[] = [],
) {
  const marks = toMarks(lines);
  const eventMarks = toEventMarks(events);
  render(
    <ReplayTimeline
      marks={marks}
      events={eventMarks}
      totalSec={timelineDomain([...marks, ...eventMarks], 600, false)}
      describe={(l) => l.text}
      onOpenLine={onOpenLine}
    />,
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
});
