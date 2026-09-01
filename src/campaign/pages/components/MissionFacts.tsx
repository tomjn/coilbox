/**
 * What a mission row says about the mission, beyond its number and its title
 * (issue #2195).
 *
 * The row used to say all of it in one dot-separated string, subtitle first and
 * skippable last, on a line narrow enough that the end of it disappeared. So
 * the facts that vanished first were the ones nothing else on the page says.
 *
 * They are split here by what kind of fact each one is. Counts of what the
 * author has written into the mission become chips, one per kind, drawn in the
 * same place on every row so a campaign's objectives can be read straight down
 * the column. States the mission is in become badges, because a state is a
 * claim rather than a slot.
 *
 * That split is why the two follow opposite rules for nothing. A chip counting
 * nothing is dimmed rather than dropped, as the scenario row's chips are
 * (issue #2180): dropping one slides the rest along and the columns stop being
 * columns. A badge for a state the mission is not in is dropped, because
 * "Skippable" is the unusual case and a row of greyed-out negatives on every
 * mission is a row saying nothing loudly.
 *
 * Objectives are drawn with `ListChecks`, which is what the scenario editor's
 * Objectives panel and the scenario row's chips already use, so the same idea
 * keeps the same symbol across both builders.
 *
 * Each chip carries its phrase as a tooltip and again in an `sr-only` span, and
 * hides the icon and the digit, because an icon beside a number tells a screen
 * reader nothing.
 */

import { cn } from "@picoframe/frame";
import { Ban, FileText, ListChecks, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SkirmishDraft } from "@/play/drafts";
import type { CampaignMission } from "../../model";

/**
 * The game and the map the mission launches on, kept as text rather than made
 * into chips. A game and a map are names, and no icon stands in for a name.
 *
 * A missing half is tinted, in the same amber the stale-scenario warning below
 * it uses, because it is not an empty field. `campaignIsPlayable` refuses a
 * campaign holding a mission with no game or no map, and play order is array
 * order, so one such mission blocks every mission after it. That was previously
 * the "No map" at the truncating end of a line of dots.
 */
export function MissionSetup({ snapshot }: { snapshot: SkirmishDraft }) {
  const part = (value: string | undefined, missing: string) =>
    value ? (
      <span>{value}</span>
    ) : (
      <span className="text-amber-600 dark:text-amber-500">{missing}</span>
    );
  return (
    <span className="truncate text-xs text-muted-foreground">
      {part(snapshot.gameName, "No game")} · {part(snapshot.mapName, "No map")}
    </span>
  );
}

/** The kinds of authoring a mission is counted by, in the order they are read. */
export type MissionCountKey = "objectives" | "restrictions";

/** How many of one kind a mission holds, and what that kind is called. */
export type MissionCount = {
  key: MissionCountKey;
  count: number;
  /** Singular, so a caller can phrase it either way. */
  noun: string;
};

const ICONS: Record<MissionCountKey, LucideIcon> = {
  objectives: ListChecks,
  restrictions: Ban,
};

/**
 * What a mission holds that can be counted.
 *
 * The same two the removal confirmation warns it is about to destroy, and for
 * the same reason: they are what an author wrote by hand and what nothing else
 * on this page shows. The briefing is the third thing that confirmation names,
 * but it is a paragraph rather than a number, so it is drawn below as a chip
 * with no digit.
 */
export function missionCounts(mission: CampaignMission): MissionCount[] {
  return [
    { key: "objectives", count: mission.objectives.length, noun: "objective" },
    {
      key: "restrictions",
      count: mission.disabledUnits.length,
      noun: "unit restriction",
    },
  ];
}

/** One count named, pluralised against itself: "1 objective", "0 objectives". */
export function missionCountPhrase({ count, noun }: MissionCount): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The shared chip shape: a small icon, an optional digit, and the phrase. */
function Chip({
  icon: Icon,
  value,
  phrase,
  dim,
}: {
  icon: LucideIcon;
  value?: number;
  phrase: string;
  dim: boolean;
}) {
  return (
    <span
      title={phrase}
      className={cn(
        "flex shrink-0 items-center gap-1 tabular-nums",
        dim && "opacity-40",
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {value !== undefined && <span aria-hidden="true">{value}</span>}
      <span className="sr-only">{phrase}</span>
    </span>
  );
}

export function MissionFacts({ mission }: { mission: CampaignMission }) {
  const briefed = mission.briefing.trim() !== "";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {/* No digit: a briefing is written or it is not, and "1 briefing" would
          be a count of something nobody counts. The icon still holds its place
          in the column, dimmed, so an unwritten briefing reads as a gap in the
          same slot on every row. */}
      <Chip
        icon={FileText}
        phrase={briefed ? "Briefing written" : "No briefing"}
        dim={!briefed}
      />
      {missionCounts(mission).map((entry) => (
        <Chip
          key={entry.key}
          icon={ICONS[entry.key]}
          value={entry.count}
          phrase={missionCountPhrase(entry)}
          dim={entry.count === 0}
        />
      ))}
      {/* The scenario badge names the scenario. A mission is titled after the
          scenario it was built from, but it can be renamed afterwards, and then
          the name of the document it actually plays is on this row or nowhere.
          The staleness of that copy has its own warning line below, so the badge
          says only that there is one. */}
      {mission.scenario && (
        <Badge variant="secondary" className="max-w-56 text-[10px]">
          <span className="truncate">Scenario: {mission.scenario.name}</span>
        </Badge>
      )}
      {mission.skippable && (
        <Badge variant="secondary" className="text-[10px]">
          Skippable
        </Badge>
      )}
    </div>
  );
}
