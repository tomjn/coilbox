/**
 * Put a workshop project's compiled tweak slots into a battle that is already
 * open, one slot at a time, and say for each one whether it landed (issue
 * #1279).
 *
 * A tweak slot is an ordinary mod option whose value happens to be 16 KB of
 * base64, so the room already has both ways of setting one: the founder writes
 * the script tag directly, and everybody else asks the autohost with `!bSet`.
 * `useBattleRoom`'s `sendOption` picks between them. What this module adds is
 * the part a single option edit never needed. A set runs to sixty slots and a
 * megabyte, every hop between here and the game has a flood limit, and a set
 * that lands half way is worse than one that does not land at all, because the
 * match starts on it regardless.
 *
 * So the run is paced, and every slot is confirmed before the next one goes.
 *
 * Confirmation is the battle's own script tags, not chat. SPADS answers an
 * accepted `!bSet` with `SETSCRIPTTAGS game/modoptions/<name>=<value>`
 * (`sendBattleSetting` in `spads.pl`), the server broadcasts that to the room,
 * and coilbox's reducer folds it into `battle.scriptTags`. That is the server
 * saying what the match will actually run on, which is the only thing worth
 * believing. It also means the founder path needs no separate confirmation:
 * `SETSCRIPTTAGS` comes back the same way.
 *
 * A slot whose value is already set is skipped outright, with no command and no
 * wait. That is what makes a second run after a failure cheap, and it is also
 * required for correctness: SPADS answers a re-send of an unchanged value with
 * "already set to value" and returns without echoing anything, so a re-run that
 * sent it anyway would sit and wait for a confirmation that is never coming.
 */

import type { BarSlotPack } from "@/workshop/barPack";
import { MODOPT_PREFIX } from "./battleOptions";

/** One packed slot, ready to send. */
export interface TweakSlot {
  /** The mod option's name, e.g. `tweakdefs` or `tweakdefs3`. */
  name: string;
  /** The base64 payload `bar_pack` produced for it. */
  value: string;
  /** The script tag the battle confirms it under. */
  tagKey: string;
  /** What the whole `!bSet` line costs on the wire. */
  bytes: number;
}

/**
 * Uberserver charges a logged-in user 2000 bytes a second, averaged over a ten
 * second window, and disconnects whoever goes over (`flood_limits['user']` in
 * its `DataHandler.py`). That is the byte rate a run has to stay under, and at
 * 16 KB a slot it is the part that sets the pace.
 */
export const LOBBY_BYTES_PER_SECOND = 2000;

/**
 * SPADS stops reading a user for two minutes once four of their commands land
 * inside four seconds (its `cmdFloodAutoIgnore` setting, applied in
 * `checkCmdFlood`). The window keeps five whole-second buckets and counts the
 * command it is checking, so three commands two seconds apart is the fastest a
 * run can go. A 1.5 second gap trips it, because 0, 1.5, 3.0 and 4.5 all land
 * in buckets 0 to 4.
 */
export const AUTOHOST_COMMAND_GAP_MS = 2000;

/**
 * SPADS' own output budget, `maxBytesSent` of 49000 over a `sendRecordPeriod`
 * of 5 seconds. Past it, it queues rather than sends, which is why a big slot's
 * confirmation can be several seconds behind the command that earned it.
 */
const AUTOHOST_OUTPUT_BYTES_PER_SECOND = 49000 / 5;

/** The wait `useBattleOptions` already gives any option edit's echo. */
export const ECHO_BASE_MS = 8000;

/** How often the run looks at the battle's tags while waiting for an echo. The
 *  mirror behind them refreshes on `SNAPSHOT_BATCH_MS`, so anything faster than
 *  this only re-reads the same answer. */
export const CONFIRM_POLL_MS = 200;

/** How long to leave between sending one slot and sending the next. */
export function slotGapMs(bytes: number, viaAutohost: boolean): number {
  const byteBudget = Math.ceil((bytes * 1000) / LOBBY_BYTES_PER_SECOND);
  return viaAutohost
    ? Math.max(AUTOHOST_COMMAND_GAP_MS, byteBudget)
    : byteBudget;
}

/** How long to wait for a slot's echo before calling it lost. */
export function confirmTimeoutMs(bytes: number, viaAutohost: boolean): number {
  if (!viaAutohost) return ECHO_BASE_MS;
  // An accepted setting costs SPADS its own value twice over: once as
  // SETSCRIPTTAGS, once as the battle-chat line announcing the change. Both
  // come out of the one output budget, and both queue behind it.
  return (
    ECHO_BASE_MS +
    Math.ceil((2 * bytes * 1000) / AUTOHOST_OUTPUT_BYTES_PER_SECOND)
  );
}

/**
 * Read the option name and payload back out of a `!bSet <name> <value>` line.
 *
 * `bar_pack` builds whole lines because a line is what a player pastes, so this
 * takes them apart again for the send that does not go through chat. It also
 * means a line somebody was handed rather than packed here works the same way.
 * Null for anything that is not one, which is how a pasted blob that is not a
 * tweak line gets refused rather than sent.
 */
export function parseBsetLine(
  line: string,
): { name: string; value: string } | null {
  const match = /^!bset\s+(\S+)\s+(\S+)$/i.exec(line.trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), value: match[2] };
}

/** Turn a pack into the slots to send, in the order they were packed. */
export function deliverySlots(pack: BarSlotPack): TweakSlot[] {
  const slots: TweakSlot[] = [];
  for (const line of [...pack.tweakdefs, ...pack.tweakunits]) {
    const parsed = parseBsetLine(line);
    if (!parsed) continue;
    slots.push({
      name: parsed.name,
      value: parsed.value,
      tagKey: `${MODOPT_PREFIX}${parsed.name}`,
      bytes: line.length,
    });
  }
  return slots;
}

/**
 * Turn a preset's (or any other batch of already-decided) option script tags
 * into the slots to send, one `!bSet` per tag (issue #2761).
 *
 * A preset holds tag/value pairs directly rather than pre-built `!bset`
 * lines, so this builds each line itself instead of parsing one back out the
 * way `deliverySlots` does. `applyOptionTags`'s founder branch never reaches
 * here: writing every tag as one script-tag batch has nothing to pace.
 */
export function optionTagSlots(tags: Record<string, string>): TweakSlot[] {
  return Object.entries(tags).map(([tagKey, value]) => {
    const name = tagKey.slice(tagKey.lastIndexOf("/") + 1);
    return { name, value, tagKey, bytes: `!bSet ${name} ${value}`.length };
  });
}

/**
 * The key `ledgerByOutput` files a slot's changes under, so a report about a
 * slot that did not land can name the edits that went with it.
 *
 * The ledger's own label is the slot name (`slot_label` in `ledger.rs` builds
 * the same string `bar_pack` puts in the line), so the only thing to work out
 * is which of the two kinds it is.
 */
export function ledgerKeyFor(slot: TweakSlot): string {
  const kind = slot.name.startsWith("tweakunits") ? "tweakunits" : "tweakdefs";
  return `bar:${kind}:${slot.name}`;
}

export type SlotState =
  | "waiting"
  | "already-set"
  | "sending"
  | "confirming"
  | "confirmed"
  | "failed"
  | "skipped";

export interface SlotProgress {
  slot: TweakSlot;
  state: SlotState;
  /** Why it failed, for the one slot that did. */
  reason?: string;
  /** Anything the lobby server said while this slot was in flight. Uberserver
   *  names its own limit when it drops an over-long command, and that is a far
   *  better answer than "no echo arrived". */
  serverSaid?: string[];
  /** Anything the room's host said while this slot was in flight. SPADS refuses
   *  a `!bSet` in words, and the commonest refusal by far is that the sender is
   *  not the room's boss. Read only to explain a slot that did not land, never
   *  to decide whether one did: chat is what a bot chose to say, and script
   *  tags are what the match will run on. */
  hostSaid?: string[];
}

export interface DeliveryProgress {
  slots: SlotProgress[];
  /** True once the run has stopped, whether it finished or gave up. */
  done: boolean;
  /** The index of the slot the run stopped on, or null if it reached the end. */
  stoppedAt: number | null;
}

/**
 * What the run needs from the world. Injected so the pacing and the
 * stop-on-failure rule can be tested without a lobby, a clock or a socket.
 */
export interface DeliveryIo {
  /** Put one slot on the wire. Rejects if the send itself was refused. */
  send(slot: TweakSlot): Promise<void>;
  /** The value the battle currently holds for a script tag, as last confirmed
   *  by the server. */
  confirmed(tagKey: string): string | undefined;
  /** How many server announcements have arrived on this connection so far. */
  serverMessageCount(): number;
  /** The server announcements that arrived after the given count. */
  serverMessagesSince(count: number): string[];
  /** What the battle's host said from the given time onwards. */
  hostSaidSince(at: number): string[];
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Called on every state change, so a caller can render the run as it goes. */
  report(progress: DeliveryProgress): void;
  /** True once the caller has asked the run to stop. */
  cancelled(): boolean;
}

const snapshot = (
  slots: SlotProgress[],
  done: boolean,
  stoppedAt: number | null,
): DeliveryProgress => ({
  slots: slots.map((s) => ({ ...s })),
  done,
  stoppedAt,
});

/**
 * Send every slot, in order, stopping at the first one that does not come back.
 *
 * Stopping is the whole point rather than a shortcut. Once a slot is lost the
 * room holds part of a set, and sending the rest of it makes that worse, not
 * better: more of the project reaches the match while the missing piece the
 * other pieces were written against still is not there. So the run stops, and
 * the caller is told exactly which slots landed, which one did not, and which
 * were never tried.
 */
export async function runDelivery(
  slots: TweakSlot[],
  io: DeliveryIo,
  { viaAutohost }: { viaAutohost: boolean },
): Promise<DeliveryProgress> {
  const progress: SlotProgress[] = slots.map((slot) => ({
    slot,
    state: "waiting",
  }));
  let stoppedAt: number | null = null;

  const report = () => io.report(snapshot(progress, false, stoppedAt));

  const skipFrom = (index: number) => {
    for (let rest = index; rest < progress.length; rest += 1) {
      progress[rest] = { ...progress[rest], state: "skipped" };
    }
  };

  const stop = (
    index: number,
    reason: string,
    said: { server: string[]; host: string[] },
  ) => {
    progress[index] = {
      ...progress[index],
      state: "failed",
      reason,
      ...(said.server.length > 0 ? { serverSaid: said.server } : {}),
      ...(said.host.length > 0 ? { hostSaid: said.host } : {}),
    };
    skipFrom(index + 1);
    stoppedAt = index;
  };

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];

    if (io.cancelled()) {
      skipFrom(i);
      stoppedAt = i;
      break;
    }

    // Nothing to do, nothing to wait for, and nothing charged against any
    // flood limit. See this file's own note on why a re-send would hang.
    if (io.confirmed(slot.tagKey) === slot.value) {
      progress[i] = { ...progress[i], state: "already-set" };
      report();
      continue;
    }

    const seenBefore = io.serverMessageCount();
    const sentAt = io.now();
    const said = () => ({
      server: io.serverMessagesSince(seenBefore),
      host: io.hostSaidSince(sentAt),
    });
    progress[i] = { ...progress[i], state: "sending" };
    report();

    try {
      await io.send(slot);
    } catch (error) {
      stop(i, error instanceof Error ? error.message : String(error), said());
      break;
    }

    progress[i] = { ...progress[i], state: "confirming" };
    report();

    const startedAt = sentAt;
    const timeout = confirmTimeoutMs(slot.bytes, viaAutohost);
    let landed = false;
    while (io.now() - startedAt < timeout) {
      await io.sleep(CONFIRM_POLL_MS);
      if (io.confirmed(slot.tagKey) === slot.value) {
        landed = true;
        break;
      }
    }

    if (!landed) {
      stop(
        i,
        `The battle never came back with ${slot.name}, after ${Math.round(timeout / 1000)}s of waiting.`,
        said(),
      );
      break;
    }

    progress[i] = { ...progress[i], state: "confirmed" };
    report();

    // Pace the next send. Waiting for the echo has already spent real time out
    // of the same sliding window the byte rate is measured over, so only the
    // remainder is owed.
    if (i < slots.length - 1) {
      const owed = slotGapMs(slot.bytes, viaAutohost) - (io.now() - startedAt);
      if (owed > 0) await io.sleep(owed);
    }
  }

  const final = snapshot(progress, true, stoppedAt);
  io.report(final);
  return final;
}

/**
 * A one-line verdict for a finished run, for the place that has room for one
 * sentence rather than a list.
 */
export function deliverySummary(progress: DeliveryProgress): string {
  const landed = progress.slots.filter(
    (s) => s.state === "confirmed" || s.state === "already-set",
  ).length;
  const failed = progress.slots.some((s) => s.state === "failed");
  const skipped = progress.slots.filter((s) => s.state === "skipped").length;
  if (!failed && skipped === 0) {
    return landed === 0
      ? "Nothing to send: this battle already holds every slot."
      : `All ${landed} slot${landed === 1 ? "" : "s"} are set on this battle.`;
  }
  const unsent = skipped + (failed ? 1 : 0);
  return `${landed} slot${landed === 1 ? "" : "s"} landed and ${unsent} did not. This battle is holding part of a set, which the match will start on as it stands.`;
}
