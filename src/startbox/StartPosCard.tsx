import type { ReactNode } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { START_POS_OPTIONS, startPosLabel } from "./mode";

/**
 * The start-position card: the mode picker, and whatever the mode needs under it.
 * Sits beneath the map on every surface that launches a game, because the mode
 * and the boxes it enables are both read against the minimap rather than against
 * a list of game options.
 *
 * `children` renders below the select, which is where the start-box controls go
 * when choose-in-game is picked. `note` carries a caveat the mode itself cannot
 * show, such as box mode with no boxes drawn yet.
 */
export function StartPosCard({
  value,
  onChange,
  unavailable,
  note,
  disabled,
  children,
}: {
  /** The engine `StartPosType` in effect. */
  value: number;
  /**
   * Omit to show the mode as read-only text. That is a joiner in a battle they
   * may not change, which is different from `disabled`: a greyed-out select
   * still invites a click that will never work.
   */
  onChange?: (value: number) => void;
  /**
   * Why this surface has no start-position mode at all, or null where it has one
   * (issue #1979). Replaces the whole control rather than disabling it: on a
   * protocol that carries no mode, the value shown would be a default nobody
   * chose.
   */
  unavailable?: string | null;
  note?: string;
  /** The setup is frozen (a game is running), so the mode cannot move. */
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        Start positions
      </span>
      {unavailable ? (
        <span className="mt-1 block text-sm text-muted-foreground">
          {unavailable}
        </span>
      ) : onChange ? (
        <OptionSelect
          className="mt-1"
          size="sm"
          value={String(value)}
          disabled={disabled}
          options={START_POS_OPTIONS}
          onValueChange={(v) => onChange(Number(v))}
        />
      ) : (
        <span className="text-sm">{startPosLabel(value)}</span>
      )}
      {!unavailable && note && (
        <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
      )}
      {children}
    </div>
  );
}
