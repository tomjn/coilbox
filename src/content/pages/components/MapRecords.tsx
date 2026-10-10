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
import { formatDuration } from "@/lib/format";
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

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A record as a count and never a rate: "won 3 of 5". */
export const wonOf = (won: number, known: number) =>
  known === 0 ? "no result" : `won ${won} of ${known}`;

const elmos = (n: number) => `${Math.round(n).toLocaleString()} elmos`;

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
  if (row.places.length > 1)
    return `${row.places.length.toLocaleString()} places with this name`;
  const place = row.places[0];
  return place.kind === "declared"
    ? "Declared by the map"
    : `Around ${Math.round(place.x).toLocaleString()}, ${Math.round(place.z).toLocaleString()}${place.radius > 0 ? `, within ${elmos(place.radius)}` : ""}`;
}

/** What a position's record means in the arrangement the matches share. */
function arrangementNote(format: ReturnType<typeof sharedFormat>): string {
  switch (format) {
    case "duel":
      return "In a 1v1 each start is a team of one, so a position's record is the record of whoever held it against one opponent. Team 1 is the team with the lower number in the match.";
    case "teams":
      return "In a team game a position's record depends on the team it was on and on who else was on it. It is split by team here, and it is not controlled for anything else.";
    case "ffa":
      return "In a free for all every player is a team of one, so there is no team to split by. A position's record is not controlled for how many players there were or who they were.";
    default:
      return "These matches are not all one arrangement, so positions are not split by team here, and a position's record is not controlled for the team it was on. Choose an arrangement above to split them.";
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
  joined,
  records,
  rows,
  orphans,
  onRename,
  onDeleteName,
  reading,
  versions,
  mapName,
}: {
  /** How many versions of the map the matches were recorded under. */
  versions: number;
  /** The page's map, whose declared positions starts are placed on. */
  mapName: string;
  shown: AggregateMatch[];
  /** Matches on every other map, under the same filters. */
  elsewhere: AggregateMatch[];
  joined: JoinedStarts;
  records: StartRecords;
  /** The start table's rows: a position, or positions that share a name. */
  rows: StartRow[];
  /** Names that found no position in the matches above. */
  orphans: StoredName[];
  onRename: (row: StartRow, name: string) => void;
  onDeleteName: (entry: StoredName) => void;
  reading: boolean;
}) {
  const teams = useMemo(() => teamRecord(shown), [shown]);
  const here = useMemo(() => lengthSummary(shown), [shown]);
  const rest = useMemo(() => lengthSummary(elsewhere), [elsewhere]);
  const factions = useMemo(() => factionCounts(shown), [shown]);
  const format = sharedFormat(shown);
  const split = format === "duel" || format === "teams";

  const decided = withResult(shown);
  const byAi = rows.reduce((n, r) => n + r.byAi, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="map-records">
      <div className="flex flex-col gap-1">
        <VersionSpan versions={versions} testId="versions-records" />
        <h3 className="text-sm font-medium">
          What your library knows about it
        </h3>
        <p
          className="text-xs text-muted-foreground"
          data-testid="records-played"
        >
          {matchCount(shown.length)} played, {decided.toLocaleString()} with a
          recorded result. A match with no result is in no win or loss below.
          Every figure is a count of those matches, with the number it is out of
          beside it.
        </p>
      </div>

      <div className="flex flex-col gap-1" data-testid="team-record">
        <h4 className="text-xs font-medium">Which team won</h4>
        {teams.twoSides === 0 ? (
          <p className="text-xs text-muted-foreground">
            None of these matches is two teams, so there is no team 1 and team 2
            to compare.
          </p>
        ) : teams.decided === 0 ? (
          <p className="text-xs text-muted-foreground">
            {teams.twoSides === 1
              ? "The one match of two teams has no recorded result"
              : `None of the ${teams.twoSides.toLocaleString()} matches of two teams has a recorded result`}
            , so neither team has a record.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Team 1 {wonOf(teams.team1Won, teams.decided)}, team 2{" "}
            {wonOf(teams.team2Won, teams.decided)}, in{" "}
            {plural(teams.decided, "match", "matches")} of two teams with a
            result.
            {teams.twoSides > teams.decided &&
              ` ${plural(teams.twoSides - teams.decided, "more has", "more have")} no result.`}
            {teams.other > 0 &&
              ` ${plural(teams.other, "match", "matches")} of another arrangement ${teams.other === 1 ? "is" : "are"} not in it.`}{" "}
            Team 1 is the team with the lower number in the match, so this does
            not say which slot or which side of the map is stronger.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1" data-testid="length-record">
        <h4 className="text-xs font-medium">How long a match runs</h4>
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Matches</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Median</TableHead>
              <TableHead className="text-right">Shortest</TableHead>
              <TableHead className="text-right">Longest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(
              [
                ["This map", here],
                ["Every other map", rest],
              ] as const
            ).map(([label, s]) => (
              <TableRow
                key={label}
                data-testid={`length-${label === "This map" ? "here" : "rest"}`}
              >
                <TableCell>{label}</TableCell>
                <TableCell className="text-right">
                  {s.matches.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {s.median === null ? "none" : formatDuration(s.median)}
                </TableCell>
                <TableCell className="text-right">
                  {s.shortest === null ? "none" : formatDuration(s.shortest)}
                </TableCell>
                <TableCell className="text-right">
                  {s.longest === null ? "none" : formatDuration(s.longest)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          The other maps are counted under the same filters. Nothing here tests
          whether a difference is more than chance, and with few matches on
          either row it may be.
          {here.noLength + rest.noLength > 0 &&
            ` ${plural(here.noLength + rest.noLength, "match has", "matches have")} no length in the replay's header and ${here.noLength + rest.noLength === 1 ? "is" : "are"} left out of it.`}
        </p>
      </div>

      <div className="flex flex-col gap-1" data-testid="start-records">
        <h4 className="text-xs font-medium">Start positions</h4>
        {records.places.length === 0 ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="starts-none"
          >
            {reading
              ? "Reading start positions…"
              : "No start position is counted for these matches."}
          </p>
        ) : (
          <Table className="text-xs" data-testid="start-table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-0">No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Place</TableHead>
                <TableHead className="text-right">Taken</TableHead>
                <TableHead className="text-right">Result</TableHead>
                {split && (
                  <>
                    <TableHead className="text-right">As team 1</TableHead>
                    <TableHead className="text-right">As team 2</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.key} data-testid={`start-row-${p.number}`}>
                  <TableCell>
                    <PlaceNumber n={p.number} />
                  </TableCell>
                  <TableCell>
                    <PlaceNameInput
                      value={p.name}
                      label={`Name for place ${p.number}`}
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
                        {c.taken === 0
                          ? "not taken"
                          : `${c.taken} taken, ${wonOf(c.won, c.known)}`}
                      </TableCell>
                    ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground" data-testid="starts-basis">
          {arrangementNote(format)} Names are yours, kept on this computer for{" "}
          {mapName} by its exact name, and positions you give one name are one
          row, counted together. Taken is the number of starts at the place, and
          the result column counts only those in a match with a recorded result.
          {versions > 1 &&
            ` With more than one version in, every start is placed on ${mapName}, this page's map. Another version may declare other positions, and a start of its that is near none of this map's is grouped with the others by distance.`}
          {records.tolerance !== null &&
            ` A start within ${elmos(records.tolerance)} of a position the map declares is counted at it. That is half the distance between the two closest declared positions, so a start is never near two.`}
          {records.scale !== null &&
            ` Other starts are grouped when they are within ${elmos(records.scale)} of one another, directly or through others, which is 1/32 of the map's shorter side and the grain of the density layers. Nothing measured says that suits every map, and a group with a wide radius may be more than one position.`}
          {byAi > 0 &&
            ` ${plural(byAi, "start was", "starts were")} taken by an AI and ${byAi === 1 ? "is" : "are"} counted.`}
        </p>
        {!reading && orphans.length > 0 && (
          <div className="flex flex-col gap-1" data-testid="orphan-names">
            <p className="text-xs text-muted-foreground">
              Saved names that match no place in the matches above. They are
              kept until you delete them, and a name is used again if a place
              turns up where it was.
            </p>
            <ul className="flex flex-col gap-1">
              {orphans.map((o) => (
                <li
                  key={`${o.key}:${o.name}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span>{o.name}</span>
                  <span className="text-muted-foreground">
                    was around {Math.round(o.x).toLocaleString()},{" "}
                    {Math.round(o.z).toLocaleString()}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete the name ${o.name}`}
                    onClick={() => onDeleteName(o)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(joined.noTeamIds > 0 ||
          joined.noSeat > 0 ||
          joined.noStarts > 0 ||
          joined.unread > 0 ||
          records.ungrouped > 0) && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="starts-left-out"
          >
            Left out:
            {joined.noTeamIds > 0 &&
              ` ${plural(joined.noTeamIds, "match", "matches")} saved before team numbers were kept, which a start cannot be matched to a result through until the library is read again.`}
            {joined.noSeat > 0 &&
              ` ${plural(joined.noSeat, "start", "starts")} for a team that no player or AI held.`}
            {joined.noStarts > 0 &&
              ` ${plural(joined.noStarts, "match", "matches")} with no start recorded.`}
            {joined.unread > 0 &&
              (reading
                ? ` ${plural(joined.unread, "match", "matches")} not read yet.`
                : ` ${plural(joined.unread, "match", "matches")} whose replay could not be read.`)}
            {records.ungrouped > 0 &&
              ` ${plural(records.ungrouped, "start", "starts")} that could not be grouped because the map has no size.`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1" data-testid="faction-record">
        <h4 className="text-xs font-medium">Which factions won here</h4>
        {factions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No faction is recorded for these matches.
          </p>
        ) : (
          <Table className="text-xs" data-testid="faction-table">
            <TableHeader>
              <TableRow>
                <TableHead>Faction</TableHead>
                <TableHead className="text-right">Played</TableHead>
                <TableHead className="text-right">Result</TableHead>
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
        <p className="text-xs text-muted-foreground">
          Every player counts, so two players of one faction on one team count
          twice. In a team game a faction's record is not separated from the
          team it was on or the factions beside it. Skirmish AIs are not
          counted.
        </p>
      </div>
    </div>
  );
}
