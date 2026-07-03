/** Human labels for the engine's `StartPosType`. */
const LABELS: Record<number, string> = {
  0: "Fixed (map positions)",
  1: "Random",
  2: "Choose in-game (start boxes)",
  3: "Choose before game",
};

/**
 * Read-only reflection of the battle's start-position mode. In a joined autohost
 * battle this is set by the host, so the room only displays it; boxes for mode 2
 * are drawn on the minimap. `note` surfaces host-driven caveats (e.g. box mode
 * with no boxes set yet).
 */
export function StartPosOptions({
  value,
  note,
}: {
  value: number;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-4 py-3">
      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
        Start positions
      </span>
      <span className="text-sm">{LABELS[value] ?? "Fixed"}</span>
      {note && (
        <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
      )}
    </div>
  );
}
