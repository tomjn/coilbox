// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const play = vi.hoisted(() => ({ running: false }));
vi.mock("./PlayProvider", () => ({ usePlay: () => play }));

import { useYieldToGame } from "./useYieldToGame";

const setFocus = (focused: boolean) => {
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  window.dispatchEvent(new Event(focused ? "focus" : "blur"));
};

afterEach(() => {
  vi.restoreAllMocks();
  play.running = false;
});

describe("useYieldToGame", () => {
  it("does not yield with no game running, even in the background", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { result } = renderHook(() => useYieldToGame());
    expect(result.current).toBe(false);
  });

  it("does not yield while coilbox is in front during a game", () => {
    play.running = true;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(() => useYieldToGame());
    expect(result.current).toBe(false);
  });

  it("yields when coilbox loses focus during a game, and stops on return", () => {
    play.running = true;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(() => useYieldToGame());
    act(() => setFocus(false));
    expect(result.current).toBe(true);
    act(() => setFocus(true));
    expect(result.current).toBe(false);
  });

  it("yields when coilbox is hidden during a game", () => {
    play.running = true;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { result } = renderHook(() => useYieldToGame());
    expect(result.current).toBe(true);
  });
});
