// @vitest-environment happy-dom

/**
 * `useRelayPing` and `relayPingLabel` in isolation, with `mpRelayPing`
 * mocked at the IPC seam (issue #2798).
 *
 * What the ticket cares about: a measurement starts only while `enabled`, it
 * repeats on its own schedule, a null answer and a rejected call both read
 * as "could not measure" rather than as an error or as the relay being
 * down, and turning `enabled` off stops the polling.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ping = vi.fn();

vi.mock("./bindings", () => ({
  mpRelayPing: (args: { serverKey: string }) => ping(args),
}));

import { RELAY_PING_EVERY_MS, relayPingLabel, useRelayPing } from "./relayPing";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ping.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRelayPing", () => {
  it("asks nothing while disabled", async () => {
    const { result } = renderHook(() => useRelayPing("alice@bar:8200", false));
    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS * 3);
    expect(ping).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it("asks for the given server key once enabled, and reports the answer", async () => {
    ping.mockResolvedValue({ milliseconds: 42 });
    const { result } = renderHook(() => useRelayPing("alice@bar:8200", true));

    await waitFor(() => expect(result.current).toBe(42));
    expect(ping).toHaveBeenCalledWith({ serverKey: "alice@bar:8200" });
  });

  it("asks again after the poll interval, not before", async () => {
    ping.mockResolvedValue({ milliseconds: 10 });
    renderHook(() => useRelayPing("alice@bar:8200", true));
    await waitFor(() => expect(ping).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS / 2);
    expect(ping).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS);
    await waitFor(() => expect(ping).toHaveBeenCalledTimes(2));
  });

  // The relay's own STUN staying quiet is a null answer, not a thrown error,
  // and it has to read the same as one.
  it("reports null when the relay does not answer", async () => {
    ping.mockResolvedValue({ milliseconds: null });
    const { result } = renderHook(() => useRelayPing("alice@bar:8200", true));
    await waitFor(() => expect(result.current).toBeNull());
  });

  // A command that failed outright (no connection, no relay to ask about)
  // must not be told apart from a relay that stayed quiet: both are "could
  // not measure", never "the relay is down".
  it("reports null when the command itself fails", async () => {
    ping.mockRejectedValue(new Error("not connected"));
    const { result } = renderHook(() => useRelayPing("alice@bar:8200", true));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("stops polling once disabled again", async () => {
    ping.mockResolvedValue({ milliseconds: 10 });
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useRelayPing("alice@bar:8200", enabled),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(ping).toHaveBeenCalledTimes(1));

    rerender({ enabled: false });
    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS * 3);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe("relayPingLabel", () => {
  it("says it is measuring before the first answer", () => {
    expect(relayPingLabel(undefined)).toBe("Measuring the ping to the relay…");
  });

  it("says the ping could not be measured, and does not say the relay is down", () => {
    const label = relayPingLabel(null);
    expect(label).toBe("The relay's ping could not be measured.");
    expect(label.toLowerCase()).not.toContain("down");
  });

  it("gives a rounded figure once one is measured", () => {
    expect(relayPingLabel(41.6)).toBe("About 42 ms to the relay.");
  });
});
