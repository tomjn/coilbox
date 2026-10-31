import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useSetting } from "@picoframe/frame";
import { MapPin } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StatRecord } from "../../bindings";
import {
  THUMB_MINIMAP_MIP,
  useScanTargetSelection,
  useUnitsyncHeightmap,
  useUnitsyncMinimap,
} from "../../config";
import type { AggregateMatch } from "../../mapAggregate";
import { namedMapsOf, playerStarts } from "../../playerStarts";
import { type NameBook, START_NAMES_KEY } from "../../startNames";
import { useMapReplayCounts } from "../../useMapAggregate";
import { useStartNames } from "../../useStartNames";
import { wonOf } from "./MapRecords";

const NO_BOOK: NameBook = {};

function games(n: number): string {
  return plural(n, { one: "# game", other: "# games" });
}

/** One map: the named positions the player took on it, and their results. */
function MapStarts({
  mapName,
  matches,
  playerName,
}: {
  mapName: string;
  matches: AggregateMatch[];
  playerName: string;
}) {
  const { t } = useLingui();
  const { selected } = useScanTargetSelection();
  const { stored } = useStartNames(mapName);
  const heightmap = useUnitsyncHeightmap(
    selected?.enginePath,
    selected?.rootPath,
    mapName,
  );
  const minimap = useUnitsyncMinimap(
    selected?.enginePath,
    selected?.rootPath,
    mapName,
    THUMB_MINIMAP_MIP,
  );
  // The size the map's own page draws it at, so a group of starts is the same
  // size here and a name stored against it is found.
  const worldWidth = heightmap.data?.width ? (heightmap.data.width - 1) * 8 : 0;
  const worldHeight = heightmap.data?.height
    ? (heightmap.data.height - 1) * 8
    : 0;
  const world = useMemo(
    () => ({ worldWidth, worldHeight }),
    [worldWidth, worldHeight],
  );
  const asks = useMemo(
    () => matches.map((m) => ({ path: m.record.path, analysedAtMs: 0 })),
    [matches],
  );
  const read = useMapReplayCounts(asks, world);

  const found = useMemo(
    () =>
      playerStarts(
        matches,
        playerName,
        read.counts,
        minimap.startPositions,
        world,
        stored,
      ),
    [matches, playerName, read.counts, minimap.startPositions, world, stored],
  );

  const waitingOnMap = heightmap.loading || minimap.loading;
  const sized = worldWidth > 0 && worldHeight > 0;
  const gameCount = games(matches.length);
  const placed = found.placed;
  const pending = read.total - read.done;
  const unreadable = read.failed.length;

  return (
    <div className="flex flex-col gap-2" data-testid="player-named-starts-map">
      <h3 className="text-xs font-medium text-muted-foreground">
        <Link
          to={`/library/maps/${encodeURIComponent(mapName)}`}
          className="hover:underline"
        >
          {mapName}
        </Link>
      </h3>
      {waitingOnMap ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Reading the map.</Trans>
        </p>
      ) : !sized ? (
        <p className="text-sm text-muted-foreground">
          <Trans>
            The map could not be read, so its starts cannot be placed.
          </Trans>
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {[
              t`From ${placed} of ${gameCount}.`,
              pending > 0 && t`${pending} still being read.`,
              unreadable > 0 && t`${unreadable} could not be read.`,
              found.unnamed > 0 &&
                t`${found.unnamed} at a position with no name.`,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
          {found.rows.length > 0 && (
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">
                    <Trans>Position</Trans>
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    <Trans>Taken</Trans>
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    <Trans>Result</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {found.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableHead scope="row" className="font-normal">
                      <span className="font-medium">{row.name}</span>
                    </TableHead>
                    <TableCell className="text-right tabular-nums">
                      {row.taken}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {wonOf(row.won, row.known)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The named start positions a player took (#3883), per map where the player has
 * named positions. A map the player has not named, or has named only on another
 * version, is not listed. Counts only, with the games each is drawn from.
 */
export function PlayerNamedStarts({
  records,
  playerName,
  refightFilenames,
}: {
  records: StatRecord[];
  playerName: string;
  refightFilenames: ReadonlySet<string>;
}) {
  const [book] = useSetting<NameBook>(START_NAMES_KEY, NO_BOOK);
  const maps = useMemo(
    () => namedMapsOf(records, playerName, refightFilenames, book),
    [records, playerName, refightFilenames, book],
  );
  if (maps.length === 0) return null;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4"
      data-testid="player-named-starts"
    >
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <MapPin className="size-4 text-muted-foreground" />
        <Trans>Named start positions</Trans>
      </h2>
      {maps.map((m) => (
        <MapStarts
          key={m.mapName}
          mapName={m.mapName}
          matches={m.matches}
          playerName={playerName}
        />
      ))}
    </section>
  );
}
