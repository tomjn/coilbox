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
const battlePing = vi.fn();

vi.mock("./bindings", () => ({
  mpRelayPing: (args: { serverKey: string }) => ping(args),
  mpBattleRelayPing: (args: { serverKey: string; battleId: number }) =>
    battlePing(args),
}));

import {
  RELAY_PING_EVERY_MS,
  relayPingLabel,
  useBattleRelayPing,
  useRelayPing,
} from "./relayPing";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ping.mockReset();
  battlePing.mockReset();
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

// Issue #2869. The joiner's half, timed against the address the lobby sent for
// their battle.
describe("useBattleRelayPing", () => {
  it("asks nothing for a battle the lobby gave no address for", async () => {
    const { result } = renderHook(() =>
      useBattleRelayPing("alice@bar:8200", 9, false),
    );
    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS * 3);
    expect(battlePing).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it("names the battle, never an address, and reports the figure", async () => {
    battlePing.mockResolvedValue({ milliseconds: 37 });
    const { result } = renderHook(() =>
      useBattleRelayPing("alice@bar:8200", 9, true),
    );

    await waitFor(() => expect(result.current).toBe(37));
    expect(battlePing).toHaveBeenCalledWith({
      serverKey: "alice@bar:8200",
      battleId: 9,
    });
  });

  // A failed measurement is not the last: a dropped packet is the likelier
  // reason, and the next try replaces it.
  it("measures again after a failure", async () => {
    battlePing.mockResolvedValueOnce({ milliseconds: null });
    battlePing.mockResolvedValue({ milliseconds: 25 });
    const { result } = renderHook(() =>
      useBattleRelayPing("alice@bar:8200", 9, true),
    );
    await waitFor(() => expect(result.current).toBeNull());

    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS);
    await waitFor(() => expect(result.current).toBe(25));
  });

  it("reports null when the command itself fails", async () => {
    battlePing.mockRejectedValue(new Error("not connected"));
    const { result } = renderHook(() =>
      useBattleRelayPing("alice@bar:8200", 9, true),
    );
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("starts again for another battle and stops once disabled", async () => {
    battlePing.mockResolvedValue({ milliseconds: 10 });
    const { rerender } = renderHook(
      ({ id, enabled }: { id: number; enabled: boolean }) =>
        useBattleRelayPing("alice@bar:8200", id, enabled),
      { initialProps: { id: 9, enabled: true } },
    );
    await waitFor(() => expect(battlePing).toHaveBeenCalledTimes(1));

    rerender({ id: 10, enabled: true });
    await waitFor(() => expect(battlePing).toHaveBeenCalledTimes(2));
    expect(battlePing).toHaveBeenLastCalledWith({
      serverKey: "alice@bar:8200",
      battleId: 10,
    });

    rerender({ id: 10, enabled: false });
    await vi.advanceTimersByTimeAsync(RELAY_PING_EVERY_MS * 3);
    expect(battlePing).toHaveBeenCalledTimes(2);
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
