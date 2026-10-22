import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Lock } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { levelChoices, requirementSentence } from "../../unlocks";

/** What each level does, in the setup's own words. The aggression behind them
 * is in `../../threat`. */
function levelNote(level: number): string {
  switch (level) {
    case 1:
      return t`Opponents pick your territory over neutral ground more often.`;
    case 2:
      return t`Opponents pick your territory over neutral ground much more often.`;
    case 3:
      return t`Opponents treat your territory like any other target, so incursions come far more often.`;
    default:
      return t`Opponents attack as they always have.`;
  }
}

/**
 * The threat level choice on the conquest setup. Every unlocked level is a
 * choice, level 0 first. The next one is shown locked with what unlocks it,
 * and levels beyond that are not shown.
 *
 * A level only makes the opposing factions more aggressive. It is a choice, not
 * a reward, and nothing the setup offers without it is ever locked.
 */
export function ThreatLevelSelect({
  value,
  ceiling,
  onChange,
}: {
  value: number;
  /** The highest level the player has unlocked. */
  ceiling: number;
  onChange: (level: number) => void;
}) {
  const { unlocked, locked } = levelChoices(ceiling);
  const lockedLevel = locked?.level ?? 0;
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium" id="conquest-threat-label">
        <Trans>Threat level</Trans>
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        value={String(value)}
        // Radix clears the value when the lit level is pressed again, and a
        // conquest always has one, so an empty change is ignored.
        onValueChange={(v) => v && onChange(Number(v))}
        aria-labelledby="conquest-threat-label"
      >
        {unlocked.map((n) => (
          <ToggleGroupItem key={n} value={String(n)}>
            <Trans>Level {n}</Trans>
          </ToggleGroupItem>
        ))}
        {locked && (
          <ToggleGroupItem
            value={String(locked.level)}
            disabled
            aria-describedby="conquest-threat-locked"
          >
            <Lock className="size-3.5" aria-hidden />
            <Trans>Level {lockedLevel}</Trans>
          </ToggleGroupItem>
        )}
      </ToggleGroup>
      <span
        className="text-xs text-muted-foreground"
        data-testid="threat-level-note"
      >
        {levelNote(value)}
      </span>
      {locked && (
        <span
          className="text-xs text-muted-foreground"
          id="conquest-threat-locked"
        >
          <Trans>Level {lockedLevel} is locked.</Trans>{" "}
          {requirementSentence(lockedLevel - 1)}
        </span>
      )}
    </div>
  );
}
