/**
 * What a scenario holds, as one chip per kind of content (issue #2180).
 *
 * The Scenario Builder row used to say this as a sentence, and a screenful of
 * rows all reading "8 unit placements · 1 zone · 1 trigger · 1 objective" is a
 * wall of text with the interesting part buried in it. An icon and a number put
 * each kind in the same place on every row, so the triggers of the whole list
 * can be read straight down the column.
 *
 * A count of nothing is dimmed rather than dropped. Dropping it would slide the
 * remaining chips along, which is the one thing the columns exist to stop, and a
 * gap makes no claim: a scenario with no triggers would look like a row whose
 * chips had not arrived. Dimming is what carries "no triggers" as far as "one
 * trigger".
 *
 * The icons are the editor's own. The mode strip places units with `Users` and
 * zones with `Square`, and the Triggers and Objectives panels are titled with
 * `Zap` and `ListChecks`, so nothing here is a new symbol to learn.
 *
 * Each chip also carries its phrase twice over, as a tooltip for a mouse and as
 * the only text a screen reader is given, because an icon beside a digit says
 * nothing to either.
 */

import { cn } from "@picoframe/frame";
import { ListChecks, type LucideIcon, Square, Users, Zap } from "lucide-react";
import {
  countPhrase,
  type ScenarioCountKey,
  scenarioCounts,
} from "../../listing";
import type { Scenario } from "../../model";

const ICONS: Record<ScenarioCountKey, LucideIcon> = {
  placements: Users,
  zones: Square,
  triggers: Zap,
  objectives: ListChecks,
};

export function ScenarioContentChips({ scenario }: { scenario: Scenario }) {
  return (
    <>
      {scenarioCounts(scenario).map((entry) => {
        const Icon = ICONS[entry.key];
        const phrase = countPhrase(entry);
        return (
          <span
            key={entry.key}
            title={phrase}
            className={cn(
              "flex shrink-0 items-center gap-1 tabular-nums",
              entry.count === 0 && "opacity-40",
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            <span aria-hidden="true">{entry.count}</span>
            <span className="sr-only">{phrase}</span>
          </span>
        );
      })}
    </>
  );
}
