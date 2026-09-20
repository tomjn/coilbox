// @vitest-environment happy-dom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const contentVerifyEngine = vi.hoisted(() => vi.fn());
vi.mock("@/content/bindings", () => ({ contentVerifyEngine }));

import { useEngineVersionCheck } from "./useEngineVersionCheck";

afterEach(() => contentVerifyEngine.mockReset());

describe("useEngineVersionCheck", () => {
  it("leaves a verified engine alone", () => {
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useEngineVersionCheck(undefined, onVerified),
    );
    expect(contentVerifyEngine).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it("asks the engine for its version, then has the caller look again", async () => {
    contentVerifyEngine.mockResolvedValue({
      engine: { syncVersion: "2026.07.01-102-g6e5c5a0" },
    });
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useEngineVersionCheck("/engine/spring", onVerified),
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(contentVerifyEngine).toHaveBeenCalledWith({
      path: "/engine/spring",
    });
    expect(result.current).toBe(false);
  });

  it("reports an engine that answers without a version", async () => {
    contentVerifyEngine.mockResolvedValue({ engine: {} });
    const onVerified = vi.fn();
    const { result } = renderHook(() =>
      useEngineVersionCheck("/engine/spring", onVerified),
    );
    await waitFor(() => expect(result.current).toBe(true));
    expect(onVerified).not.toHaveBeenCalled();
  });

  it("reports an engine that will not run", async () => {
    contentVerifyEngine.mockRejectedValue(new Error("timed out"));
    const { result } = renderHook(() =>
      useEngineVersionCheck("/engine/spring", vi.fn()),
    );
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("asks once per engine, not once per render", async () => {
    contentVerifyEngine.mockResolvedValue({ engine: {} });
    const onVerified = vi.fn();
    const { rerender, result } = renderHook(() =>
      useEngineVersionCheck("/engine/spring", onVerified),
    );
    await waitFor(() => expect(result.current).toBe(true));
    rerender();
    expect(contentVerifyEngine).toHaveBeenCalledTimes(1);
  });
});
