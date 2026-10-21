import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Lock } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StartPosition } from "../../startPosition";
import { requirementSentence } from "../../unlocks";

/** The edge start is the galaxy as it has always been, and carries no value. */
export type StartChoice = "edge" | StartPosition;

function startNote(choice: StartChoice): string {
  return choice === "edge"
    ? t`You start on the western edge, with your rivals far across the map.`
    : t`You start in the middle, and your rivals start out on the rim all around you.`;
}

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
        <Trans>Start position</Trans>
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
        <ToggleGroupItem value="edge">
          <Trans>Edge</Trans>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="centre"
          disabled={!unlocked}
          aria-describedby={unlocked ? undefined : "conquest-start-locked"}
        >
          {!unlocked && <Lock className="size-3.5" aria-hidden />}
          <Trans>Centre</Trans>
        </ToggleGroupItem>
      </ToggleGroup>
      <span
        className="text-xs text-muted-foreground"
        data-testid="start-position-note"
      >
        {startNote(value)}
      </span>
      {!unlocked && (
        <span
          className="text-xs text-muted-foreground"
          id="conquest-start-locked"
        >
          <Trans>Centre is locked.</Trans> {requirementSentence(0)}
        </span>
      )}
    </div>
  );
}
