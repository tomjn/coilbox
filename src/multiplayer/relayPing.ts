import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { mpBattleRelayPing, mpRelayPing } from "./bindings";

/**
 * How often the relay's ping is re-measured while it is worth knowing (issue
 * #2798).
 *
 * Slower than the once-a-second traffic poll in `relayCarrying.ts`, because
 * each measurement is itself a few STUN round trips against the relay
 * rather than a read off a record already on disk, and asking too often
 * would put needless load on the lobby's TURN server for a figure nobody
 * needs updated that fast.
 */
export const RELAY_PING_EVERY_MS = 10_000;

/**
 * What the last measurement said. A number of milliseconds, `null` when the
 * relay's STUN did not answer (which is not evidence the relay is down: a
 * coturn operator can turn plain STUN off with `no-stun` and still relay
 * perfectly well), or `undefined` before the first answer is back.
 */
export type RelayPing = number | null | undefined;

/**
 * The round trip to `serverKey`'s relay, timed every {@link RELAY_PING_EVERY_MS}
 * while `enabled`, and left `undefined` the rest of the time.
 *
 * One hook serves both callers this issue asks for: the Host a battle drawer
 * reads it as a preview beside the relay choice, before anything is open,
 * and the relay pill in the top bar reads it while a relayed battle is open.
 * Neither is told why a measurement failed. The lobby refusing a credential
 * and the relay's own STUN staying quiet both collapse to `null` in
 * `mp_relay_ping`, and that is the only thing either caller is safe to say
 * (issue #2798).
 */
export function useRelayPing(
  serverKey: string | null,
  enabled: boolean,
): RelayPing {
  const [ping, setPing] = useState<RelayPing>(undefined);
  useEffect(() => {
    if (!serverKey || !enabled) {
      setPing(undefined);
      return;
    }
    return pingEvery(() => mpRelayPing({ serverKey }), setPing);
  }, [serverKey, enabled]);
  return ping;
}

/**
 * The joiner's half of the ping to the relay their battle goes through (issue
 * #2869), timed against the address the lobby sent for `battleId`.
 *
 * Measured when the room opens and then every {@link RELAY_PING_EVERY_MS}, the
 * same as the host's figure, so a relay that is slow now is not described by
 * a number from when the player joined. A measurement that fails does not
 * stop the ones after it: a dropped packet or two is the likeliest reason, and
 * the next try replaces the failure.
 *
 * `enabled` is false for a battle the lobby gave no address for, so a lobby
 * that never sends one is never asked.
 */
export function useBattleRelayPing(
  serverKey: string | null,
  battleId: number,
  enabled: boolean,
): RelayPing {
  const [ping, setPing] = useState<RelayPing>(undefined);
  useEffect(() => {
    // Cleared first, so another battle never shows this one's figure while its
    // own is being measured.
    setPing(undefined);
    if (!serverKey || !enabled) return;
    return pingEvery(() => mpBattleRelayPing({ serverKey, battleId }), setPing);
  }, [serverKey, battleId, enabled]);
  return ping;
}

/**
 * Measure now and then every {@link RELAY_PING_EVERY_MS} until the returned
 * function is called, handing each answer to `report`. A command that throws
 * is a measurement that failed, not one that stops the loop.
 */
function pingEvery(
  measure: () => Promise<{ milliseconds: number | null }>,
  report: (ping: number | null) => void,
): () => void {
  let live = true;
  let asking: ReturnType<typeof setTimeout> | undefined;
  const ask = async () => {
    let answer: { milliseconds: number | null } | null = null;
    try {
      answer = await measure();
    } catch {
      // Not knowing is the same "could not measure" as a null answer.
      answer = null;
    }
    if (!live) return;
    report(answer?.milliseconds ?? null);
    asking = setTimeout(ask, RELAY_PING_EVERY_MS);
  };
  void ask();
  return () => {
    live = false;
    clearTimeout(asking);
  };
}

/** The figure or its absence, in one sentence. Pure. */
export function relayPingLabel(ping: RelayPing): string {
  if (ping === undefined) return t`Measuring the ping to the relay…`;
  if (ping === null) return t`The relay's ping could not be measured.`;
  const ms = Math.round(ping);
  return t`About ${ms} ms to the relay.`;
}
