// @vitest-environment happy-dom

/**
 * The replay page's match clock (#5305): the range it runs over with and
 * without a recorded track, and what happens to the time when a track takes
 * the range over.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  durationRange,
  MatchClockProvider,
  useMatchClock,
  useSettledFrame,
} from "./useMatchClock";

afterEach(cleanup);

function open(durationSec: number, url = "/replay") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>
      <MatchClockProvider durationSec={durationSec}>
        {children}
      </MatchClockProvider>
    </MemoryRouter>
  );
  return renderHook(
    () => ({ ...useMatchClock(), settledFrame: useSettledFrame() }),
    { wrapper },
  );
}

const TRACK = { firstFrame: 30, lastFrame: 900, framesPerSecond: 30 };

describe("a replay with no recording", () => {
  it("has a clock whose range is its duration, at 30 frames a second", () => {
    const { result } = open(125);
    expect(result.current.range).toEqual({
      firstFrame: 0,
      lastFrame: 3750,
      framesPerSecond: 30,
      source: "duration",
    });
    expect(result.current.clock.frame).toBe(0);
  });

  it("opens at the address's time, held inside the duration", () => {
    expect(open(125, "/replay?frame=600").result.current.clock.frame).toBe(600);
    cleanup();
    expect(open(125, "/replay?frame=99999").result.current.clock.frame).toBe(
      3750,
    );
  });

  it("has an empty range when the replay gives no duration", () => {
    expect(durationRange(Number.NaN).lastFrame).toBe(0);
    expect(durationRange(-5).lastFrame).toBe(0);
  });

  it("can be played and seeked like a recorded one", () => {
    const { result } = open(125);
    act(() => result.current.playback.seek(450));
    expect(result.current.clock.frame).toBe(450);
    expect(result.current.settledFrame).toBe(450);
    act(() => result.current.playback.seek(99999));
    expect(result.current.clock.frame).toBe(3750);
  });
});

describe("a recording that loads after the page opens", () => {
  it("takes the range, and puts a clock nobody moved at the address's time inside the track", () => {
    // Frame 10 is inside the duration but before the track's first frame.
    const { result } = open(125, "/replay?frame=10");
    expect(result.current.clock.frame).toBe(10);
    act(() => {
      result.current.adoptTrack(TRACK);
    });
    expect(result.current.range).toEqual({ ...TRACK, source: "track" });
    expect(result.current.clock.frame).toBe(30);
    expect(result.current.settledFrame).toBe(30);
  });

  it("goes to the address's time when the duration held it short", () => {
    // A track may run past the replay's whole seconds.
    const { result } = open(20, "/replay?frame=800");
    expect(result.current.clock.frame).toBe(600);
    act(() => {
      result.current.adoptTrack(TRACK);
    });
    expect(result.current.clock.frame).toBe(800);
  });

  it("keeps a time somebody chose, held inside the track", () => {
    const { result } = open(125);
    act(() => result.current.playback.seek(2000));
    act(() => {
      result.current.adoptTrack(TRACK);
    });
    expect(result.current.clock.frame).toBe(900);
  });

  it("keeps the speed, and gives the range back when the track goes", () => {
    const { result } = open(125);
    act(() => result.current.playback.setSpeed(4));
    let stop = () => {};
    act(() => {
      stop = result.current.adoptTrack(TRACK);
    });
    expect(result.current.playback.getSnapshot().speed).toBe(4);
    // The new playback holds the clock to the track.
    act(() => result.current.playback.seek(0));
    expect(result.current.clock.frame).toBe(30);
    act(() => result.current.playback.seek(500));

    act(() => stop());
    expect(result.current.range.source).toBe("duration");
    expect(result.current.clock.frame).toBe(500);
  });
});
