import { cn } from "@/lib/utils";
import { PIP_SCALE } from "@/play/gameAi";

/** The pip positions, fixed and never reordered, so an index key is stable. */
const POSITIONS = Array.from({ length: PIP_SCALE }, (_, i) => i);

/**
 * How hard an AI is, as a row of filled pips out of {@link PIP_SCALE}. The scale
 * is fixed rather than sized to the game's AI count, so a 4-pip AI reads as
 * "harder than most" in every game (issue #695).
 *
 * Callers pass `undefined` for an AI no ranking places and render nothing, so an
 * absent reading never reads as "the easiest AI here".
 */
export function DifficultyPips({ filled }: { filled: number }) {
  return (
    <span
      role="img"
      aria-label={`Difficulty ${filled} of ${PIP_SCALE}`}
      title={`Difficulty ${filled} of ${PIP_SCALE}`}
      className="flex shrink-0 items-center gap-0.5"
    >
      {POSITIONS.map((p) => (
        <span
          key={p}
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            p < filled ? "bg-primary" : "bg-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}
