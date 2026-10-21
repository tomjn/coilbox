import { t as coreT, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatNumber } from "@/lib/format";
import { type AggregateMatch, matchCount } from "../../mapAggregate";
import {
  type Count,
  factionCounts,
  type JoinedStarts,
  lengthSummary,
  type StartRecords,
  sharedFormat,
  teamRecord,
  withResult,
} from "../../mapRecords";
import type { StartRow, StoredName } from "../../startNames";
import { PlaceNameInput } from "./PlaceNameInput";
import { VersionSpan } from "./VersionList";

/** A record as a count and never a rate: "won 3 of 5". */
export const wonOf = (won: number, known: number) =>
  known === 0 ? coreT`no result` : coreT`won ${won} of ${known}`;

const elmos = (n: number) => {
  const amount = formatNumber(Math.round(n));
  return coreT`${amount} elmos`;
};

/** The number drawn on the minimap, drawn the same way in the table. */
export function PlaceNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-white bg-primary text-[10px] font-medium text-primary-foreground shadow">
      {n}
    </span>
  );
}

/** Where a row's position or positions are. */
function describeRow(row: StartRow): string {
  const count = row.places.length;
  if (count > 1)
    return plural(count, {
      one: "# place with this name",
      other: "# places with this name",
    });
  const place = row.places[0];
  if (place.kind === "declared") return coreT`Declared by the map`;
  const x = formatNumber(Math.round(place.x));
  const z = formatNumber(Math.round(place.z));
  if (place.radius > 0) {
    const radius = elmos(place.radius);
    return coreT`Around ${x}, ${z}, within ${radius}`;
  }
  return coreT`Around ${x}, ${z}`;
}

/** What a position's record means in the arrangement the matches share. */
function arrangementNote(format: ReturnType<typeof sharedFormat>): string {
  switch (format) {
    case "duel":
      return coreT`In a 1v1 each start is a team of one, so a position's record is the record of whoever held it against one opponent.`;
    case "teams":
      return coreT`In a team game a position's record depends on the team it was on and on who else was on it. It is split by team here, and it is not controlled for anything else.`;
    case "ffa":
      return coreT`In a free for all every player is a team of one, so there is no team to split by. A position's record is not controlled for how many players there were or who they were.`;
    default:
      return coreT`These matches are not all one arrangement, so positions are not split by team here, and a position's record is not controlled for the team it was on. Choose an arrangement above to split them.`;
  }
}

/**
 * What the library knows about one map (#1162, #1163): the results, how long
 * a match runs, which positions were taken and which factions won.
 *
 * Every figure is a count with its sample beside it. `shown` is the matches
 * the picture above is drawn from, so a filter changes both together.
 */
export function MapRecords({
  shown,
  elsewhere,
  records,
  rows,
  orphans,
  onRename,
  onDeleteName,
  reading,
  versions,
}: {
  /** How many versions of the map the matches were recorded under. */
  versions: number;
  shown: AggregateMatch[];
  /** Matches on every other map, under the same filters. */
  elsewhere: AggregateMatch[];
  records: StartRecords;
  /** The start table's rows: a position, or positions that share a name. */
  rows: StartRow[];
  /** Names that found no position in the matches above. */
  orphans: StoredName[];
  onRename: (row: StartRow, name: string) => void;
  onDeleteName: (entry: StoredName) => void;
  reading: boolean;
}) {
  const { t } = useLingui();
  const teams = useMemo(() => teamRecord(shown), [shown]);
  const here = useMemo(() => lengthSummary(shown), [shown]);
  const rest = useMemo(() => lengthSummary(elsewhere), [elsewhere]);
  const factions = useMemo(() => factionCounts(shown), [shown]);
  const format = sharedFormat(shown);
  const split = format === "duel" || format === "teams";

  const decided = withResult(shown);
  const team1Record = wonOf(teams.team1Won, teams.decided);
  const team2Record = wonOf(teams.team2Won, teams.decided);
  const played = matchCount(shown.length);
  const decidedCount = formatNumber(decided);
  const twoSides = formatNumber(teams.twoSides);
  const noneLabel = t`none`;
  const takenRecord = (c: Count) => {
    const taken = c.taken;
    const record = wonOf(c.won, c.known);
    return t`${taken} taken, ${record}`;
  };
  const lengthRows = [
    { id: "here", label: t`This map`, s: here },
    { id: "rest", label: t`Every other map`, s: rest },
  ] as const;

  return (
    <div className="flex flex-col gap-4" data-testid="map-records">
      <div className="flex flex-col gap-1">
        <VersionSpan versions={versions} testId="versions-records" />
        <h3 className="text-sm font-medium">
          <Trans>What your library knows about it</Trans>
        </h3>
        <p
          className="text-xs text-muted-foreground"
          data-testid="records-played"
        >
          {t`${played} played, ${decidedCount} with a recorded result.`}
        </p>
      </div>

      <div className="flex flex-col gap-1" data-testid="team-record">
        <h4 className="text-xs font-medium">
          <Trans>Which team won</Trans>
        </h4>
        {teams.twoSides === 0 ? (
          <p className="text-xs text-muted-foreground">
            <Trans>
              None of these matches is two teams, so there is no team 1 and team
              2 to compare.
            </Trans>
          </p>
        ) : teams.decided === 0 ? (
          <p className="text-xs text-muted-foreground">
            {teams.twoSides === 1
              ? t`The one match of two teams has no recorded result, so neither team has a record.`
              : t`None of the ${twoSides} matches of two teams has a recorded result, so neither team has a record.`}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {plural(teams.decided, {
              one: `Team 1 ${team1Record}, team 2 ${team2Record}, in # match of two teams with a result.`,
              other: `Team 1 ${team1Record}, team 2 ${team2Record}, in # matches of two teams with a result.`,
            })}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1" data-testid="length-record">
        <h4 className="text-xs font-medium">
          <Trans>How long a match runs</Trans>
        </h4>
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Matches</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Counted</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Median</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Shortest</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans>Longest</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lengthRows.map(({ id, label, s }) => (
              <TableRow key={id} data-testid={`length-${id}`}>
                <TableCell>{label}</TableCell>
                <TableCell className="text-right">
                  {formatNumber(s.matches)}
                </TableCell>
                <TableCell className="text-right">
                  {s.median === null ? noneLabel : formatDuration(s.median)}
                </TableCell>
                <TableCell className="text-right">
                  {s.shortest === null ? noneLabel : formatDuration(s.shortest)}
                </TableCell>
                <TableCell className="text-right">
                  {s.longest === null ? noneLabel : formatDuration(s.longest)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-1" data-testid="start-records">
        <h4 className="text-xs font-medium">
          <Trans>Start positions</Trans>
        </h4>
        {records.places.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="starts-none"
          >
            {reading
              ? t`Reading start positions…`
              : t`No start position is counted for these matches.`}
          </p>
        ) : (
          <Table className="text-xs" data-testid="start-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-0">
                  <Trans>No.</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Name</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Place</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans>Taken</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans>Result</Trans>
                </TableHead>
                {split && (
                  <>
                    <TableHead className="text-right">
                      <Trans>As team 1</Trans>
                    </TableHead>
                    <TableHead className="text-right">
                      <Trans>As team 2</Trans>
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const placeNumber = p.number;
                return (
                  <TableRow key={p.key} data-testid={`start-row-${p.number}`}>
                    <TableCell>
                      <PlaceNumber n={p.number} />
                    </TableCell>
                    <TableCell>
                      <PlaceNameInput
                        value={p.name}
                        label={t`Name for place ${placeNumber}`}
                        onCommit={(name) => onRename(p, name)}
                      />
                    </TableCell>
                    <TableCell>{describeRow(p)}</TableCell>
                    <TableCell className="text-right">{p.taken}</TableCell>
                    <TableCell className="text-right">
                      {wonOf(p.won, p.known)}
                    </TableCell>
                    {split &&
                      p.sides.map((c: Count, i) => (
                        <TableCell
                          // biome-ignore lint/suspicious/noArrayIndexKey: two fixed columns
                          key={i}
                          className="text-right"
                        >
                          {c.taken === 0 ? t`not taken` : takenRecord(c)}
                        </TableCell>
                      ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!reading && orphans.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="orphan-names">
            <p className="text-xs text-muted-foreground">
              <Trans>
                Saved names that match no place in the matches above.
              </Trans>
            </p>
            <ul className="flex flex-col gap-1">
              {orphans.map((o) => {
                const name = o.name;
                const x = formatNumber(Math.round(o.x));
                const z = formatNumber(Math.round(o.z));
                return (
                  <li
                    key={`${o.key}:${o.name}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span>{o.name}</span>
                    <span className="text-muted-foreground">
                      {t`was around ${x}, ${z}`}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t`Delete the name ${name}`}
                      onClick={() => onDeleteName(o)}
                    >
                      <Trans>Delete</Trans>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1" data-testid="faction-record">
        <h4 className="text-xs font-medium">
          <Trans>Which factions won here</Trans>
        </h4>
        {factions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <Trans>No faction is recorded for these matches.</Trans>
          </p>
        ) : (
          <Table className="text-xs" data-testid="faction-table">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Faction</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans>Played</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans>Result</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factions.map((f) => (
                <TableRow key={f.faction}>
                  <TableCell>{f.faction}</TableCell>
                  <TableCell className="text-right">{f.games}</TableCell>
                  <TableCell className="text-right">
                    {wonOf(f.wins, f.decided)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/**
 * What the figures in `MapRecords` mean and what they leave out, for the
 * section's help popover (#3889). It sits in the popover of "How this map is
 * played" and not under the tables.
 */
export function MapRecordsHelp({
  shown,
  elsewhere,
  joined,
  records,
  rows,
  reading,
  versions,
  mapName,
}: {
  shown: AggregateMatch[];
  elsewhere: AggregateMatch[];
  joined: JoinedStarts;
  records: StartRecords;
  rows: StartRow[];
  reading: boolean;
  versions: number;
  /** The page's map, whose declared positions starts are placed on. */
  mapName: string;
}) {
  const { t } = useLingui();
  const teams = teamRecord(shown);
  const noLength =
    lengthSummary(shown).noLength + lengthSummary(elsewhere).noLength;
  const format = sharedFormat(shown);
  const byAi = rows.reduce((n, r) => n + r.byAi, 0);
  const noResultTeams = teams.twoSides - teams.decided;
  const tolerance = records.tolerance === null ? "" : elmos(records.tolerance);
  const scale = records.scale === null ? "" : elmos(records.scale);
  const { noTeamIds, noSeat, noStarts, unread } = joined;
  const ungrouped = records.ungrouped;
  const otherArrangement = teams.other;
  return (
    <>
      <p>
        <Trans>
          A match with no recorded result is in no win or loss. Every figure
          about wins is a count of the matches that have one, with the number it
          is out of beside it.
        </Trans>
      </p>
      {teams.twoSides > 0 && (
        <p data-testid="team-note">
          <Trans>
            Team 1 is the team with the lower number in the match, so the team
            record does not say which slot or which side of the map is stronger.
          </Trans>
          {teams.twoSides > teams.decided &&
            ` ${plural(noResultTeams, {
              one: "# more match of two teams has no result.",
              other: "# more matches of two teams have no result.",
            })}`}
          {teams.other > 0 &&
            ` ${plural(otherArrangement, {
              one: "# match of another arrangement is not in it.",
              other: "# matches of another arrangement are not in it.",
            })}`}
        </p>
      )}
      <p data-testid="length-note">
        <Trans>
          The other maps are counted under the same filters. Nothing here tests
          whether a difference in length is more than chance, and with few
          matches on either row it may be.
        </Trans>
        {noLength > 0 &&
          ` ${plural(noLength, {
            one: "# match has no length in the replay's header and is left out of it.",
            other:
              "# matches have no length in the replay's header and are left out of it.",
          })}`}
      </p>
      <p data-testid="starts-basis">
        {arrangementNote(format)}{" "}
        <Trans>
          Taken is the number of starts at the place. The result column counts
          only those in a match with a recorded result. Positions you give one
          name are one row, counted together.
        </Trans>
        {versions > 1 &&
          ` ${t`With more than one version in, every start is placed on ${mapName}, this page's map. Another version may declare other positions, and a start of its that is near none of this map's is grouped with the others by distance.`}`}
        {records.tolerance !== null &&
          ` ${t`A start within ${tolerance} of a position the map declares is counted at it. That is half the distance between the two closest declared positions, so a start is never near two.`}`}
        {records.scale !== null &&
          ` ${t`Other starts are grouped when they are within ${scale} of one another, directly or through others, which is 1/32 of the map's shorter side and the grain of the density layers. Nothing measured says that suits every map, and a group with a wide radius may be more than one position.`}`}
        {byAi > 0 &&
          ` ${plural(byAi, {
            one: "# start was taken by an AI and is counted.",
            other: "# starts were taken by an AI and are counted.",
          })}`}
      </p>
      <p>
        <Trans>
          Names are yours, kept on this computer for {mapName} by its exact
          name. A saved name that matches no place is kept until you delete it,
          and it is used again if a place turns up where it was.
        </Trans>
      </p>
      {(joined.noTeamIds > 0 ||
        joined.noSeat > 0 ||
        joined.noStarts > 0 ||
        joined.unread > 0 ||
        records.ungrouped > 0) && (
        <p data-testid="starts-left-out">
          <Trans>Left out of the start positions:</Trans>
          {joined.noTeamIds > 0 &&
            ` ${plural(noTeamIds, {
              one: "# match saved before team numbers were kept, which a start cannot be matched to a result through until the library is read again.",
              other:
                "# matches saved before team numbers were kept, which a start cannot be matched to a result through until the library is read again.",
            })}`}
          {joined.noSeat > 0 &&
            ` ${plural(noSeat, {
              one: "# start for a team that no player or AI held.",
              other: "# starts for a team that no player or AI held.",
            })}`}
          {joined.noStarts > 0 &&
            ` ${plural(noStarts, {
              one: "# match with no start recorded.",
              other: "# matches with no start recorded.",
            })}`}
          {joined.unread > 0 &&
            (reading
              ? ` ${plural(unread, {
                  one: "# match not read yet.",
                  other: "# matches not read yet.",
                })}`
              : ` ${plural(unread, {
                  one: "# match whose replay could not be read.",
                  other: "# matches whose replay could not be read.",
                })}`)}
          {records.ungrouped > 0 &&
            ` ${plural(ungrouped, {
              one: "# start that could not be grouped because the map has no size.",
              other:
                "# starts that could not be grouped because the map has no size.",
            })}`}
        </p>
      )}
      <p data-testid="faction-note">
        <Trans>
          Every player counts in the faction record, so two players of one
          faction on one team count twice. In a team game a faction's record is
          not separated from the team it was on or the factions beside it.
          Skirmish AIs are not counted.
        </Trans>
      </p>
    </>
  );
}
