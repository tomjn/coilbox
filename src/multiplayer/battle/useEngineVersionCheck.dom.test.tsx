// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const contentVerifyEngine = vi.hoisted(() => vi.fn());
vi.mock("@/content/bindings", () => ({ contentVerifyEngine }));

import { useEngineVersionCheck } from "./useEngineVersionCheck";

afterEach(() => contentVerifyEngine.mockReset());

describe("useEngineVersionCheck", () => {
  it("runs nothing when every engine has reported its version", () => {
    const { result } = renderHook(() => useEngineVersionCheck([], vi.fn()));
    expect(contentVerifyEngine).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("asks every engine without a version, then has the caller look again", async () => {
    contentVerifyEngine.mockResolvedValue({
      engine: { syncVersion: "2026.07.01-102-g6e5c5a0" },
    });
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useEngineVersionCheck(["/a/spring", "/b/spring"], onVerified),
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(contentVerifyEngine.mock.calls).toEqual([
      [{ path: "/a/spring" }],
      [{ path: "/b/spring" }],
    ]);
    expect(result.current.size).toBe(0);
  });

  it("names an engine that answers without a version", async () => {
    contentVerifyEngine.mockResolvedValue({ engine: {} });
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useEngineVersionCheck(["/a/spring"], onVerified),
    );
    await waitFor(() => expect(result.current.has("/a/spring")).toBe(true));
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("names an engine that will not run, and still reads the others", async () => {
    contentVerifyEngine
      .mockRejectedValueOnce(new Error("not an engine"))
      .mockResolvedValueOnce({ engine: { syncVersion: "2026.09.01" } });
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useEngineVersionCheck(["/bad/spring", "/good/spring"], onVerified),
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect([...result.current]).toEqual(["/bad/spring"]);
  });

  it("asks each engine once, however often the list comes back", async () => {
    contentVerifyEngine.mockResolvedValue({ engine: {} });
    const { rerender, result } = renderHook(
      ({ list }) => useEngineVersionCheck(list, vi.fn()),
      { initialProps: { list: ["/a/spring"] } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ list: ["/a/spring"] });
    rerender({ list: ["/a/spring", "/b/spring"] });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(contentVerifyEngine).toHaveBeenCalledTimes(2);
  });
});
