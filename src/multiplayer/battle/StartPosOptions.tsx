import { START_POS_OPTIONS } from "@/play/pages/components/GameOptionsPanel";
import { OptionSelect } from "@/components/OptionSelect";
import type { Battle } from "../bindings";
import { STARTPOSTYPE_KEY } from "./battleOptions";
import { useBattleOptions } from "./useBattleOptions";

/** Human labels for the engine's `StartPosType`. */
const LABELS: Record<number, string> = {
  0: "Fixed (map positions)",
  1: "Random",
  2: "Choose in-game (start boxes)",
  3: "Choose before game",
};

/**
 * The battle's start-position mode. The host (founder/autohost privilege) edits it
 * in place via the same select the Battle options drawer uses — sharing
 * `useBattleOptions` so the pick is optimistic and reconciles on the server echo.
 * Everyone else sees the mode read-only. `note` surfaces host-driven caveats (e.g.
 * box mode with no boxes set yet). `children` renders below the select — the
 * host's start-box controls when choose-in-game is active.
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
   * one (issue #1979). Replaces the whole control rather than disabling it: a
   * greyed-out select still claims the room has a mode, and on a protocol that
   * carries none the value shown would be a default nobody chose.
   */
  unavailable?: string | null;
  /** Host may change the mode; joiners see it read-only. */
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
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        Start positions
      </span>
      {unavailable ? (
        <span className="mt-1 block text-sm text-muted-foreground">
          {unavailable}
        </span>
      ) : canEdit ? (
        <OptionSelect
          className="mt-1"
          size="sm"
          value={value}
          options={START_POS_OPTIONS}
          onValueChange={(v) => setOption(STARTPOSTYPE_KEY, "startpostype", v)}
        />
      ) : (
        <span className="text-sm">{LABELS[Number(value)] ?? "Fixed"}</span>
      )}
      {!unavailable && note && (
        <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
      )}
      {children}
    </div>
  );
}
