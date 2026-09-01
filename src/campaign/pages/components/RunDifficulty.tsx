import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  type Difficulty,
} from "@/scenario/model";

/** How each difficulty is written on its button, as the scenario drawer writes it. */
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

/**
 * The difficulty a campaign run is played at (issue #2220), shown on the
 * briefing of a mission that varies by it and directly above the button that
 * launches it.
 *
 * The level belongs to the run rather than to this mission, and the line under
 * the buttons says so: picking hard here is picking hard for the rest of the
 * campaign. It is still changeable at any briefing, because a player who finds
 * mission 4 too hard should not have to start the campaign again to say so.
 *
 * A run nobody has chosen for shows the middle of the ladder, which is what the
 * runtime plays when the launch says nothing.
 */
export function RunDifficulty({
  value,
  onChange,
  disabled,
}: {
  value: Difficulty | undefined;
  onChange: (level: Difficulty) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        id="campaign-difficulty-label"
      >
        Difficulty
      </span>
      <ToggleGroup
        type="single"
        value={value ?? DEFAULT_DIFFICULTY}
        onValueChange={(v) => v && onChange(v as Difficulty)}
        aria-labelledby="campaign-difficulty-label"
        className="justify-start gap-2"
        disabled={disabled}
      >
        {DIFFICULTIES.map((level) => (
          <ToggleGroupItem
            key={level}
            value={level}
            className="rounded-md border border-border/60 px-4 data-[state=on]:border-primary data-[state=on]:bg-primary/10"
          >
            {DIFFICULTY_LABEL[level]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">
        Applies to the rest of the campaign. Change it whenever you like.
      </p>
    </div>
  );
}
