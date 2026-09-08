import { describe, expect, it } from "vitest";
import type { BarSlotPack } from "@/workshop/barPack";
import {
  AUTOHOST_COMMAND_GAP_MS,
  confirmTimeoutMs,
  type DeliveryIo,
  type DeliveryProgress,
  deliverySlots,
  deliverySummary,
  ECHO_BASE_MS,
  ledgerKeyFor,
  parseBsetLine,
  runDelivery,
  slotGapMs,
  type TweakSlot,
} from "./tweakDelivery";

const pack = (over: Partial<BarSlotPack> = {}): BarSlotPack => ({
  tweakdefs: [],
  tweakunits: [],
  oversized: [],
  unplaced: [],
  ...over,
});

const slot = (over: Partial<TweakSlot> = {}): TweakSlot => ({
  name: "tweakdefs1",
  value: "AAAA",
  tagKey: "game/modoptions/tweakdefs1",
  bytes: 100,
  ...over,
});

/**
 * A lobby that answers on a script. `echoAfter` says how many polls a slot
 * waits before its value appears in the battle's tags, so a test can make one
 * land late, or never.
 */
function fakeLobby(opts: {
  echoAfter?: Record<string, number | "never">;
  failSendOn?: string;
  tags?: Record<string, string>;
  /** What the lobby server announces once the first slot is on the wire. */
  serverSaysOnSend?: string[];
  /** What the room's host says once the first slot is on the wire. */
  hostSaysOnSend?: string[];
  cancelAfterSends?: number;
}) {
  const tags: Record<string, string> = { ...(opts.tags ?? {}) };
  const pollsSince: Record<string, number> = {};
  const serverMessages: string[] = [];
  const sent: TweakSlot[] = [];
  const sleeps: number[] = [];
  const reports: DeliveryProgress[] = [];
  let clock = 0;
  let cancelled = false;

  const io: DeliveryIo = {
    async send(s) {
      if (opts.failSendOn === s.name) throw new Error("connection is closed");
      sent.push(s);
      pollsSince[s.name] = 0;
      serverMessages.push(...(opts.serverSaysOnSend ?? []));
      if (opts.cancelAfterSends != null && sent.length >= opts.cancelAfterSends)
        cancelled = true;
    },
    confirmed: (tagKey) => tags[tagKey],
    serverMessageCount: () => serverMessages.length,
    serverMessagesSince: (count) => serverMessages.slice(count),
    hostSaidSince: () => (sent.length > 0 ? (opts.hostSaysOnSend ?? []) : []),
    async sleep(ms) {
      sleeps.push(ms);
      clock += ms;
      // Every in-flight slot ages by one poll, and lands once it is due.
      for (const s of sent) {
        pollsSince[s.name] += 1;
        const due = opts.echoAfter?.[s.name] ?? 1;
        if (due !== "never" && pollsSince[s.name] >= due)
          tags[s.tagKey] = s.value;
      }
    },
    now: () => clock,
    report: (p) => reports.push(p),
    cancelled: () => cancelled,
  };

  return { io, sent, sleeps, reports, tags };
}

describe("tweakDelivery pacing", () => {
  it("leaves at least SPADS' command gap between autohost sends", () => {
    // A short slot's bytes buy it nothing: the autohost's command counter is
    // what binds, so the gap is the floor rather than the byte budget.
    expect(slotGapMs(40, true)).toBe(AUTOHOST_COMMAND_GAP_MS);
  });

  it("paces a full slot on the lobby's byte rate", () => {
    // 16,000 bytes at 2000 a second is eight seconds, which is well past the
    // command gap, so the byte rate is what sets the pace for a real slot.
    expect(slotGapMs(16_000, true)).toBe(8000);
    expect(slotGapMs(16_000, false)).toBe(8000);
  });

  it("holds the founder to the byte rate but not the command gap", () => {
    // Nothing is being asked of an autohost on the founder path, so a small
    // write costs only what its bytes cost.
    expect(slotGapMs(40, false)).toBe(20);
  });

  it("gives an autohost longer to answer than the server itself", () => {
    expect(confirmTimeoutMs(16_000, false)).toBe(ECHO_BASE_MS);
    // SPADS repeats the value twice out of a 9800 bytes-a-second budget.
    expect(confirmTimeoutMs(16_000, true)).toBe(ECHO_BASE_MS + 3266);
  });
});

describe("parseBsetLine", () => {
  it("reads a numbered slot back out of a packed line", () => {
    expect(parseBsetLine("!bset tweakdefs3 QUJD")).toEqual({
      name: "tweakdefs3",
      value: "QUJD",
    });
  });

  it("reads the bare slot, and does not mind the case SPADS is written in", () => {
    expect(parseBsetLine("!bSet tweakunits QUJD")).toEqual({
      name: "tweakunits",
      value: "QUJD",
    });
  });

  it("refuses anything that is not one line with one value", () => {
    expect(parseBsetLine("!bset tweakdefs")).toBeNull();
    expect(parseBsetLine("!start")).toBeNull();
    expect(parseBsetLine("!bset tweakdefs QUJD extra")).toBeNull();
    expect(parseBsetLine("")).toBeNull();
  });
});

describe("deliverySlots", () => {
  it("keeps the packed order, defs before units, with their tag keys", () => {
    const slots = deliverySlots(
      pack({
        tweakdefs: ["!bset tweakdefs AAAA", "!bset tweakdefs1 BBBB"],
        tweakunits: ["!bset tweakunits CCCC"],
      }),
    );
    expect(slots.map((s) => s.name)).toEqual([
      "tweakdefs",
      "tweakdefs1",
      "tweakunits",
    ]);
    expect(slots[1].tagKey).toBe("game/modoptions/tweakdefs1");
    expect(slots[0].bytes).toBe("!bset tweakdefs AAAA".length);
  });
});

describe("ledgerKeyFor", () => {
  it("matches the key the change ledger files a slot's edits under", () => {
    expect(ledgerKeyFor(slot({ name: "tweakdefs" }))).toBe(
      "bar:tweakdefs:tweakdefs",
    );
    expect(ledgerKeyFor(slot({ name: "tweakdefs7" }))).toBe(
      "bar:tweakdefs:tweakdefs7",
    );
    expect(ledgerKeyFor(slot({ name: "tweakunits2" }))).toBe(
      "bar:tweakunits:tweakunits2",
    );
  });
});

describe("runDelivery", () => {
  it("sends every slot and confirms each one off the battle's tags", async () => {
    const { io, sent } = fakeLobby({});
    const slots = [slot({ name: "tweakdefs" }), slot({ name: "tweakdefs1" })];
    slots[0].tagKey = "game/modoptions/tweakdefs";

    const result = await runDelivery(slots, io, { viaAutohost: true });

    expect(sent.map((s) => s.name)).toEqual(["tweakdefs", "tweakdefs1"]);
    expect(result.slots.map((s) => s.state)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    expect(result.stoppedAt).toBeNull();
    expect(result.done).toBe(true);
  });

  it("sends nothing for a slot the battle already holds", async () => {
    const { io, sent } = fakeLobby({
      tags: { "game/modoptions/tweakdefs1": "AAAA" },
    });

    const result = await runDelivery([slot()], io, { viaAutohost: true });

    expect(sent).toEqual([]);
    expect(result.slots[0].state).toBe("already-set");
  });

  it("stops at the first slot the battle never comes back with", async () => {
    const { io, sent } = fakeLobby({ echoAfter: { tweakdefs1: "never" } });
    const slots = [
      slot({ name: "tweakdefs1", tagKey: "game/modoptions/tweakdefs1" }),
      slot({ name: "tweakdefs2", tagKey: "game/modoptions/tweakdefs2" }),
      slot({ name: "tweakdefs3", tagKey: "game/modoptions/tweakdefs3" }),
    ];

    const result = await runDelivery(slots, io, { viaAutohost: true });

    // The one that failed went out. The two behind it never did, which is the
    // whole point: more of a half-applied set is worse, not better.
    expect(sent.map((s) => s.name)).toEqual(["tweakdefs1"]);
    expect(result.slots.map((s) => s.state)).toEqual([
      "failed",
      "skipped",
      "skipped",
    ]);
    expect(result.stoppedAt).toBe(0);
    expect(result.slots[0].reason).toContain("tweakdefs1");
  });

  it("quotes what the server said while a lost slot was in flight", async () => {
    const { io } = fakeLobby({
      echoAfter: { tweakdefs1: "never" },
      serverSaysOnSend: [
        'message length limit of 10000 chars was exceeded: command "!bset tweakdefs1..." dropped.',
      ],
    });

    const result = await runDelivery([slot()], io, { viaAutohost: true });

    expect(result.slots[0].serverSaid).toEqual([
      'message length limit of 10000 chars was exceeded: command "!bset tweakdefs1..." dropped.',
    ]);
  });

  it("quotes the autohost's own refusal, which is usually about being boss", async () => {
    const { io } = fakeLobby({
      echoAfter: { tweakdefs1: "never" },
      hostSaysOnSend: [
        '* alice, you are not allowed to call command "bset" in current context (boss mode is enabled).',
      ],
    });

    const result = await runDelivery([slot()], io, { viaAutohost: true });

    expect(result.slots[0].hostSaid).toEqual([
      '* alice, you are not allowed to call command "bset" in current context (boss mode is enabled).',
    ]);
  });

  it("stops when the send itself is refused, and says why", async () => {
    const { io } = fakeLobby({ failSendOn: "tweakdefs1" });

    const result = await runDelivery(
      [slot(), slot({ name: "tweakdefs2" })],
      io,
      {
        viaAutohost: true,
      },
    );

    expect(result.slots[0].state).toBe("failed");
    expect(result.slots[0].reason).toBe("connection is closed");
    expect(result.slots[1].state).toBe("skipped");
  });

  it("counts the wait for an echo against the gap it owes the next send", async () => {
    // The echo takes four polls, so 800ms of the 2000ms gap is already spent
    // and only the remaining 1200ms is slept off before the next slot.
    const { io, sleeps } = fakeLobby({ echoAfter: { tweakdefs1: 4 } });
    const slots = [
      slot({ name: "tweakdefs1", tagKey: "game/modoptions/tweakdefs1" }),
      slot({ name: "tweakdefs2", tagKey: "game/modoptions/tweakdefs2" }),
    ];

    await runDelivery(slots, io, { viaAutohost: true });

    expect(sleeps).toContain(1200);
  });

  it("stops when the caller cancels, without failing the slots it never tried", async () => {
    const { io, sent } = fakeLobby({ cancelAfterSends: 1 });
    const slots = [
      slot({ name: "tweakdefs1", tagKey: "game/modoptions/tweakdefs1" }),
      slot({ name: "tweakdefs2", tagKey: "game/modoptions/tweakdefs2" }),
    ];

    const result = await runDelivery(slots, io, { viaAutohost: true });

    expect(sent.map((s) => s.name)).toEqual(["tweakdefs1"]);
    expect(result.slots.map((s) => s.state)).toEqual(["confirmed", "skipped"]);
    expect(result.slots.some((s) => s.state === "failed")).toBe(false);
  });

  it("reports as it goes, not only at the end", async () => {
    const { io, reports } = fakeLobby({});

    await runDelivery([slot()], io, { viaAutohost: true });

    const states = reports.map((r) => r.slots[0].state);
    expect(states).toEqual(["sending", "confirming", "confirmed", "confirmed"]);
    expect(reports.filter((r) => r.done)).toHaveLength(1);
  });
});

describe("deliverySummary", () => {
  const progress = (states: string[]): DeliveryProgress => ({
    slots: states.map((state, i) => ({
      slot: slot({ name: `tweakdefs${i}` }),
      state: state as DeliveryProgress["slots"][number]["state"],
    })),
    done: true,
    stoppedAt:
      states.indexOf("failed") === -1 ? null : states.indexOf("failed"),
  });

  it("says a whole set landed", () => {
    expect(deliverySummary(progress(["confirmed", "already-set"]))).toBe(
      "All 2 slots are set on this battle.",
    );
  });

  it("says plainly that a stopped run left part of a set behind", () => {
    expect(deliverySummary(progress(["confirmed", "failed", "skipped"]))).toBe(
      "1 slot landed and 2 did not. This battle is holding part of a set, which the match will start on as it stands.",
    );
  });

  it("has an answer for a run that had nothing to do", () => {
    expect(deliverySummary(progress([]))).toBe(
      "Nothing to send: this battle already holds every slot.",
    );
  });
});
