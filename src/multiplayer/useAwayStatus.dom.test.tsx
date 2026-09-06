// @vitest-environment happy-dom

/**
 * The stateful half of away status (issue #333): resolving `ingame`/`manualAway`
 * into the wire pair, deduping the send against `sentStatusRef`, resetting on a
 * new connection, and staying silent on a protocol with nothing client-wide to
 * publish. The pure resolve/dedupe helpers have their own tests in
 * awayStatus.test.ts. This file is what proves the hook wires them up.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async () => {
  const react = await import("react");
  return {
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

const sent: Array<{ serverKey: string; ingame: boolean; away: boolean }> = [];

vi.mock("./bindings", () => ({
  mpSetStatus: vi.fn(
    async (args: { serverKey: string; ingame: boolean; away: boolean }) => {
      sent.push(args);
      return { sent: true };
    },
  ),
}));

import { useAwayStatus } from "./useAwayStatus";

beforeEach(() => {
  sent.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAwayStatus", () => {
  it("sends MYSTATUS once the connection is ready", async () => {
    const { result } = renderHook(() =>
      useAwayStatus("AF@server:8201", "tasserver", "ready"),
    );
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({
      serverKey: "AF@server:8201",
      ingame: false,
      away: false,
    });
    expect(result.current.status).toEqual({ ingame: false, away: false });
  });

  it("dedupes: an unrelated re-render doesn't resend an unchanged status", async () => {
    const { result, rerender } = renderHook(
      ({ phase }: { phase: "ready" }) =>
        useAwayStatus("AF@server:8201", "tasserver", phase),
      { initialProps: { phase: "ready" } },
    );
    await waitFor(() => expect(sent).toHaveLength(1));

    rerender({ phase: "ready" });
    await act(async () => {});
    expect(sent).toHaveLength(1);
    expect(result.current.status).toEqual({ ingame: false, away: false });
  });

  it("setIngame flips the ingame bit and sends the new pair", async () => {
    const { result } = renderHook(() =>
      useAwayStatus("AF@server:8201", "tasserver", "ready"),
    );
    await waitFor(() => expect(sent).toHaveLength(1));

    act(() => result.current.setIngame(true));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({
      serverKey: "AF@server:8201",
      ingame: true,
      away: false,
    });
  });

  it("setManualAway is sticky: it flips the away bit and stays set", async () => {
    const { result } = renderHook(() =>
      useAwayStatus("AF@server:8201", "tasserver", "ready"),
    );
    await waitFor(() => expect(sent).toHaveLength(1));

    act(() => result.current.setManualAway(true));
    await waitFor(() => expect(result.current.manualAway).toBe(true));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({
      serverKey: "AF@server:8201",
      ingame: false,
      away: true,
    });
  });

  it("resets ingame and manual-away on a new connection", async () => {
    const { result, rerender } = renderHook(
      ({ activeKey }: { activeKey: string | null }) =>
        useAwayStatus(activeKey, "tasserver", "ready"),
      { initialProps: { activeKey: "AF@server:8201" as string | null } },
    );
    await waitFor(() => expect(sent).toHaveLength(1));
    act(() => result.current.setManualAway(true));
    await waitFor(() => expect(result.current.manualAway).toBe(true));

    rerender({ activeKey: "AF@server2:8201" });
    await waitFor(() => expect(result.current.manualAway).toBe(false));
    expect(result.current.status).toEqual({ ingame: false, away: false });
  });

  it("never publishes on a Tachyon connection, which has nothing client-wide to send", async () => {
    renderHook(() => useAwayStatus("AF@tachyon:443", "tachyon", "ready"));
    await act(async () => {});
    expect(sent).toHaveLength(0);
  });

  it("stays silent until the connection reaches ready", async () => {
    const { rerender } = renderHook(
      ({ phase }: { phase: "awaitGreeting" | "ready" | null }) =>
        useAwayStatus("AF@server:8201", "tasserver", phase),
      { initialProps: { phase: null as "awaitGreeting" | "ready" | null } },
    );
    await act(async () => {});
    expect(sent).toHaveLength(0);

    rerender({ phase: "ready" });
    await waitFor(() => expect(sent).toHaveLength(1));
  });
});
