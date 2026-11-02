// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type Arrangement,
  asArrangement,
  decodePayload,
  encodeArrangement,
} from "@/startbox/barBoxes";
import type { Battle } from "../bindings";
import type { MemberRow } from "./config";
import { useStartBoxOverride } from "./useStartBoxOverride";

const SET_TAG = "game/modoptions/mapmetadata_startboxes_set";
const OVERRIDE_TAG = "game/modoptions/mapmetadata_startbox_override";
const OVERRIDE_NAME = "mapmetadata_startbox_override";

const row = (name: string, ally: number): MemberRow =>
  ({ name, kind: "human", spectator: false, ally }) as MemberRow;
const ROWS = [row("one", 0), row("two", 1)];

const KOLMOGOROV: Arrangement = {
  maxPlayersPerStartbox: 8,
  startboxes: [
    {
      poly: [
        { x: 101, y: 200 },
        { x: 101, y: 145 },
        { x: 59, y: 103 },
        { x: 0, y: 104 },
        { x: 0, y: 200 },
      ],
    },
    {
      poly: [
        { x: 99, y: 0 },
        { x: 99, y: 55 },
        { x: 141, y: 97 },
        { x: 200, y: 96 },
        { x: 200, y: 0 },
      ],
    },
  ],
};
const SET = Buffer.from(JSON.stringify({ "2": KOLMOGOROV })).toString(
  "base64url",
);

const battle = (
  scriptTags: Record<string, string>,
  startRects: Battle["startRects"] = {},
) => ({ id: 1, scriptTags, startRects }) as unknown as Battle;

const RECT = { left: 10, top: 20, right: 110, bottom: 120 };
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function setup(b: Battle) {
  const send = vi.fn();
  const hook = renderHook(
    ({ room }: { room: Battle }) => useStartBoxOverride(room, ROWS, send),
    { initialProps: { room: b } },
  );
  return { send, note: hook.result.current, hook };
}

const sentArrangement = (call: unknown[]) =>
  asArrangement(decodePayload(call[2] as string));

describe("useStartBoxOverride", () => {
  it("sends the override with a host's box, keeping the set's other box", async () => {
    const { send, note } = setup(battle({ [SET_TAG]: SET }));
    note({ ally: 1, rect: RECT });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(OVERRIDE_TAG);
    expect(send.mock.calls[0][1]).toBe(OVERRIDE_NAME);
    expect(send.mock.calls[0][3]).toBeUndefined();
    const next = sentArrangement(send.mock.calls[0]);
    expect(next?.startboxes[0]).toEqual(KOLMOGOROV.startboxes[0]);
    expect(next?.startboxes[1].poly).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 120 },
    ]);
  });

  it("sends one override for edits made in one go", async () => {
    const { send, note } = setup(battle({ [SET_TAG]: SET }));
    note({ ally: 0, rect: RECT });
    note({ ally: 1, rect: { left: 0, top: 0, right: 40, bottom: 40 } });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    const next = sentArrangement(send.mock.calls[0]);
    expect(next?.startboxes.map((b) => b.poly.length)).toEqual([2, 2]);
  });

  it("builds a second edit on the first before the room echoes it", async () => {
    const { send, note } = setup(battle({ [SET_TAG]: SET }));
    note({ ally: 0, rect: RECT });
    await flush();
    note({ ally: 1, rect: { left: 0, top: 0, right: 40, bottom: 40 } });
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    const next = sentArrangement(send.mock.calls[1]);
    expect(next?.startboxes[0].poly).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 120 },
    ]);
    expect(next?.startboxes[1].poly[1]).toEqual({ x: 40, y: 40 });
  });

  it("builds on the room's override once it has echoed", async () => {
    const first = encodeArrangement({
      startboxes: [
        {
          poly: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        },
        {
          poly: [
            { x: 3, y: 3 },
            { x: 4, y: 4 },
          ],
        },
      ],
    });
    const { send, note, hook } = setup(battle({ [SET_TAG]: SET }));
    note({ ally: 0, rect: RECT });
    await flush();
    hook.rerender({ room: battle({ [SET_TAG]: SET, [OVERRIDE_TAG]: first }) });
    note({ ally: 1, rect: RECT });
    await flush();
    const next = sentArrangement(send.mock.calls[1]);
    // The echoed override's box, not the one sent first.
    expect(next?.startboxes[0].poly).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it("does nothing in a room with neither option", async () => {
    const { send, note } = setup(battle({}));
    note({ ally: 0, rect: RECT });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing when the options cannot be read", async () => {
    const { send, note } = setup(battle({ [SET_TAG]: "garbage!" }));
    note({ ally: 0, rect: RECT });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("withdraws the override when the last box is cleared", async () => {
    const override = encodeArrangement(KOLMOGOROV);
    const { send, note } = setup(
      battle(
        { [SET_TAG]: SET, [OVERRIDE_TAG]: override },
        { "0": RECT, "1": RECT },
      ),
    );
    note({ ally: 0, rect: null });
    note({ ally: 1, rect: null });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(OVERRIDE_TAG, OVERRIDE_NAME, "", true);
  });

  it("keeps the override when only some boxes are cleared", async () => {
    const override = encodeArrangement(KOLMOGOROV);
    const { send, note } = setup(
      battle(
        { [SET_TAG]: SET, [OVERRIDE_TAG]: override },
        { "0": RECT, "1": RECT },
      ),
    );
    note({ ally: 0, rect: null });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][3]).toBeUndefined();
    const next = sentArrangement(send.mock.calls[0]);
    expect(next?.startboxes[0].poly).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ]);
  });

  it("sends nothing when clearing boxes in a room that has no override", async () => {
    const { send, note } = setup(battle({ [SET_TAG]: SET }, { "0": RECT }));
    note({ ally: 0, rect: null });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("pads the override to a box for every team in the room", async () => {
    const three = [row("one", 0), row("two", 1), row("three", 2)];
    const send = vi.fn();
    const { result } = renderHook(() =>
      useStartBoxOverride(battle({ [SET_TAG]: SET }), three, send),
    );
    result.current({ ally: 2, rect: RECT });
    await flush();
    // Three teams and a set of two: the next smaller entry is used, then
    // padded so the game does not discard the override.
    const next = sentArrangement(send.mock.calls[0]);
    expect(next?.startboxes).toHaveLength(3);
  });
});
