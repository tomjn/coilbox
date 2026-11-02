import { useCallback, useRef } from "react";
import {
  type Arrangement,
  type BoxEdit,
  encodeArrangement,
  OVERRIDE_OPTION,
  overrideAfterEdits,
  resolveArrangement,
  startBoxOptions,
} from "@/startbox/barBoxes";
import { roomShape } from "@/startbox/zerok";
import type { Battle } from "../bindings";
import { optionValue, scriptTagKey } from "./battleOptions";
import type { MemberRow } from "./config";

type SendOption = (
  tagKey: string,
  spadsName: string,
  value: string,
  withdraw?: boolean,
) => void;

/**
 * Keeps BAR's `mapmetadata_startbox_override` in step with a host's box edits
 * (issue #343).
 *
 * A room that carries one of BAR's start box options has a game that reads that
 * option and ignores the rectangles the host draws, so the rectangles go out as
 * they always did and the override goes out with them. A room with neither
 * option is left alone. Clearing every box withdraws the override, and the room
 * falls back to its set.
 *
 * Edits made in one go, such as clearing every box or loading a preset, are
 * gathered and sent as one override rather than one each, because an autohost
 * ignores a host that sends commands too quickly.
 */
export function useStartBoxOverride(
  battle: Battle | undefined,
  rows: MemberRow[],
  sendOption: SendOption,
): (edit: BoxEdit) => void {
  const latest = useRef({ battle, rows, sendOption });
  latest.current = { battle, rows, sendOption };
  const pending = useRef<BoxEdit[]>([]);
  // The override last sent and the value the room held before it, until the
  // room echoes it. A second edit in that time builds on what was sent rather
  // than on the room's value, which has not caught up.
  const sent = useRef<{ before: string; override: Arrangement | null } | null>(
    null,
  );

  const flush = useCallback(() => {
    const edits = pending.current;
    pending.current = [];
    const { battle: room, rows: members, sendOption: send } = latest.current;
    if (!room || edits.length === 0) return;
    const read = startBoxOptions(room.scriptTags);
    const held = optionValue(room.scriptTags, "mod", OVERRIDE_OPTION) ?? "";
    const override =
      sent.current && sent.current.before === held
        ? sent.current.override
        : read.override;
    const players = members.filter((r) => !r.spectator);
    const shape = roomShape(
      players.map((r) => ({ ally: r.ally, bot: r.kind === "bot" })),
    );
    const teams = shape.length;
    const current = resolveArrangement(override, read.set, teams);
    if (!current) return;
    const tagKey = scriptTagKey("mod", OVERRIDE_OPTION);

    const cleared = new Set(edits.filter((e) => !e.rect).map((e) => e.ally));
    const anySet = edits.some((e) => e.rect);
    const boxesLeft = Object.keys(room.startRects).some(
      (k) => !cleared.has(Number(k)),
    );
    if (!anySet && !boxesLeft) {
      if (override) {
        send(tagKey, OVERRIDE_OPTION, "", true);
        sent.current = { before: held, override: null };
      }
      return;
    }
    const next = overrideAfterEdits(
      current.arrangement,
      edits,
      teams,
      Math.max(1, ...shape.map((team) => team.bots.length)),
    );
    send(tagKey, OVERRIDE_OPTION, encodeArrangement(next));
    sent.current = { before: held, override: next };
  }, []);

  return useCallback(
    (edit: BoxEdit) => {
      pending.current.push(edit);
      if (pending.current.length === 1) queueMicrotask(flush);
    },
    [flush],
  );
}
