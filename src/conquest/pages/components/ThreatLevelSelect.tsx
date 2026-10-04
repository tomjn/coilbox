import { Lock } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { levelChoices } from "../../unlocks";

/** What each level does, in the setup's own words. The aggression behind them
 * is in `../../threat`. */
const LEVEL_NOTES = [
  "Opponents attack as they always have.",
  "Opponents pick your systems over neutral ones more often.",
  "Opponents pick your systems over neutral ones much more often.",
  "Opponents treat your systems like any other target, so incursions come far more often.",
];

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
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium" id="conquest-threat-label">
        Threat level
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
            Level {n}
          </ToggleGroupItem>
        ))}
        {locked && (
          <ToggleGroupItem
            value={String(locked.level)}
            disabled
            aria-describedby="conquest-threat-locked"
          >
            <Lock className="size-3.5" aria-hidden />
            Level {locked.level}
          </ToggleGroupItem>
        )}
      </ToggleGroup>
      <span
        className="text-xs text-muted-foreground"
        data-testid="threat-level-note"
      >
        {LEVEL_NOTES[value] ?? LEVEL_NOTES[0]}
      </span>
      {locked && (
        <span
          className="text-xs text-muted-foreground"
          id="conquest-threat-locked"
        >
          Level {locked.level} is locked. {locked.requirement}.
        </span>
      )}
    </div>
  );
}
