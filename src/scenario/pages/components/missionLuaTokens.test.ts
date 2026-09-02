// @vitest-environment happy-dom
/**
 * The debounce and the mismatch guard around shiki are the two things worth
 * a test here: shiki itself is somebody else's library, and this hook's job
 * is just to not call it too often and not trust a stale or malformed
 * result. `import("shiki")` is mocked so these tests do not pay for shiki's
 * real wasm grammar just to check the wiring around it.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const codeToTokens = vi.fn();
vi.mock("shiki", () => ({
  codeToTokens: (...args: unknown[]) => codeToTokens(...args),
}));

import { RETOKENIZE_DEBOUNCE_MS, useLuaTokens } from "./missionLuaTokens";

/** A one-token-per-character result whose line count matches `lines`. */
function tokensFor(lines: string[]) {
  return {
    tokens: lines.map((text) => [{ content: text, offset: 0 }]),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  codeToTokens.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useLuaTokens", () => {
  it("says nothing until the edit settles, then tokenizes once", async () => {
    const lines = ["local x = 1"];
    codeToTokens.mockResolvedValue(tokensFor(lines));
    const { result } = renderHook(() => useLuaTokens(lines[0], lines));

    expect(result.current).toBeNull();
    expect(codeToTokens).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETOKENIZE_DEBOUNCE_MS);
    });

    expect(codeToTokens).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual(tokensFor(lines).tokens);
  });

  it("tokenizes once for a run of edits, not once each", async () => {
    codeToTokens.mockResolvedValue(tokensFor(["c"]));
    const { rerender } = renderHook(
      ({ code }: { code: string }) => useLuaTokens(code, [code]),
      { initialProps: { code: "a" } },
    );

    act(() => vi.advanceTimersByTime(RETOKENIZE_DEBOUNCE_MS / 2));
    rerender({ code: "ab" });
    act(() => vi.advanceTimersByTime(RETOKENIZE_DEBOUNCE_MS / 2));
    rerender({ code: "abc" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETOKENIZE_DEBOUNCE_MS);
    });

    expect(codeToTokens).toHaveBeenCalledTimes(1);
    expect(codeToTokens).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ lang: "lua" }),
    );
  });

  it("drops a stale result once the code has moved on", async () => {
    const lines = ["a"];
    codeToTokens.mockResolvedValue(tokensFor(lines));
    const { result, rerender } = renderHook(
      ({ code }: { code: string }) => useLuaTokens(code, [code]),
      { initialProps: { code: "a" } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETOKENIZE_DEBOUNCE_MS);
    });
    expect(result.current).toEqual(tokensFor(lines).tokens);

    // The code changes again, so the old tokens must not linger against it.
    rerender({ code: "b" });
    expect(result.current).toBeNull();
  });

  it("falls back to null when the token line count does not match", async () => {
    // Two lines of text, but shiki reports back only one line of tokens.
    codeToTokens.mockResolvedValue(tokensFor(["only one line"]));
    const { result } = renderHook(() => useLuaTokens("a\nb", ["a", "b"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETOKENIZE_DEBOUNCE_MS);
    });

    expect(result.current).toBeNull();
  });

  it("falls back to null when shiki fails to load or tokenize", async () => {
    codeToTokens.mockRejectedValue(new Error("no wasm here"));
    const { result } = renderHook(() => useLuaTokens("a", ["a"]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETOKENIZE_DEBOUNCE_MS);
    });

    expect(result.current).toBeNull();
  });
});
