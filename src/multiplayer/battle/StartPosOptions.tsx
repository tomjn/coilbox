import { StartPosCard } from "@/startbox/StartPosCard";
import type { Battle } from "../bindings";
import { STARTPOSTYPE_KEY } from "./battleOptions";
import { useBattleOptions } from "./useBattleOptions";

/**
 * The battle's start-position mode, rendered through the shared `StartPosCard`
 * so a room and a skirmish offer the same control in the same place. The host
 * (founder/autohost privilege) edits it in place, sharing `useBattleOptions`
 * with the Battle options drawer so the pick is optimistic and reconciles on the
 * server echo. Everyone else sees the mode read-only.
 */
export function StartPosOptions({
  battle,
  canEdit,
  unavailable,
  sendOption,
  note,
  children,
}: {
  battle: Battle;
  /**
   * Why this connection has no start position mode at all, or null where it has
   * one (issue #1979).
   */
  unavailable?: string | null;
  /** Host may change the mode. Joiners see it read-only. */
  canEdit: boolean;
  sendOption: (tagKey: string, spadsName: string, value: string) => void;
  note?: string;
  children?: React.ReactNode;
}) {
  const { pending, setOption } = useBattleOptions(
    battle.scriptTags,
    sendOption,
  );
  const value =
    pending[STARTPOSTYPE_KEY.toLowerCase()]?.target ??
    battle.scriptTags[STARTPOSTYPE_KEY] ??
    "0";

  return (
    <StartPosCard
      value={Number(value)}
      unavailable={unavailable}
      note={note}
      onChange={
        canEdit
          ? (v) => setOption(STARTPOSTYPE_KEY, "startpostype", String(v))
          : undefined
      }
    >
      {children}
    </StartPosCard>
  );
}
