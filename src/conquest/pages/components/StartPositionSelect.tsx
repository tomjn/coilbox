import { Lock } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StartPosition } from "../../startPosition";
import { startPositionRequirement } from "../../unlocks";

/** The edge start is the galaxy as it has always been, and carries no value. */
export type StartChoice = "edge" | StartPosition;

const NOTES: Record<StartChoice, string> = {
  edge: "You start on the western edge, with your rivals far across the map.",
  centre:
    "You start in the middle, and your rivals start out on the rim all around you.",
};

/**
 * The start position choice on the conquest setup (issue #3432). The edge start
 * is always open. The centre start is shown locked with what unlocks it until it
 * is earned, the way the threat level control does.
 *
 * The centre start only changes where the fighting comes from, and gives the
 * player nothing. It is a choice, not a reward.
 */
export function StartPositionSelect({
  value,
  unlocked,
  onChange,
}: {
  value: StartChoice;
  /** Whether the centre start has been earned. */
  unlocked: boolean;
  onChange: (choice: StartChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium" id="conquest-start-label">
        Start position
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        // Radix clears the value when the lit choice is pressed again, and a
        // conquest always has one, so an empty change is ignored.
        onValueChange={(v) => v && onChange(v as StartChoice)}
        aria-labelledby="conquest-start-label"
      >
        <ToggleGroupItem value="edge">Edge</ToggleGroupItem>
        <ToggleGroupItem
          value="centre"
          disabled={!unlocked}
          aria-describedby={unlocked ? undefined : "conquest-start-locked"}
        >
          {!unlocked && <Lock className="size-3.5" aria-hidden />}
          Centre
        </ToggleGroupItem>
      </ToggleGroup>
      <span
        className="text-xs text-muted-foreground"
        data-testid="start-position-note"
      >
        {NOTES[value]}
      </span>
      {!unlocked && (
        <span
          className="text-xs text-muted-foreground"
          id="conquest-start-locked"
        >
          Centre is locked. {startPositionRequirement()}.
        </span>
      )}
    </div>
  );
}
