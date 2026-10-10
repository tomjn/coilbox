import { Button, useTheme } from "@picoframe/frame";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StatRecord } from "../../bindings";
import { SPLIT_BUCKETS, type SplitBucket } from "../../replayOpening";
import { SPLIT_COLOURS } from "../../splitColours";
import { gamesFor, isGenuineMatch } from "../../stats";
import type { UnitCategory } from "../../unitCategory";
import {
  DEFAULT_USAGE_SORT,
  nextUsageSort,
  sortUsageRows,
  type UnitUsage,
  type UsageColumn,
  type UsageSort,
} from "../../unitUsage";
import { useUnitUsage } from "../../useUnitUsage";
import { SectionHelp } from "./SectionHelp";

/**
 * Which units a player orders, over every game the dossier counts (#1167): a
 * table by unit and the metal ordered by kind of unit.
 *
 * The replay set and the wins are the dossier's own (`gamesFor` over genuine
 * matches). Every figure shows the number of games it is drawn from and no
 * unit is hidden for having few, because the codebase has no rule for when a
 * sample is big enough. Method and caveats are in the help entry.
 */

const KIND: Record<UnitCategory, string> = {
  economy: "Economy",
  defence: "Defence",
  offence: "Offence",
  factory: "Factory",
  builder: "Builder",
  intelligence: "Sensor",
  transport: "Transport",
  unclassified: "Unclassified",
};

const BUCKET: Record<SplitBucket, string> = {
  economy: "Economy",
  defence: "Defence",
  offence: "Offence",
  other: "Other",
  unclassified: "Unclassified",
};

const whole = (n: number) => Math.round(n).toLocaleString();

function games(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "game" : "games"}`;
}

function orders(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "order" : "orders"}`;
}

/** How many of the player's games are in no row, for any reason. */
function leftOut(usage: UnitUsage): number {
  return usage.failed + usage.noList.games + usage.misfit.games;
}

function ariaSort(
  sort: UsageSort,
  column: UsageColumn,
): "ascending" | "descending" | "none" {
  if (sort.column !== column) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function SortIcon({ dir }: { dir: "ascending" | "descending" | "none" }) {
  if (dir === "none") return <ArrowUpDown className="size-3" aria-hidden />;
  return dir === "ascending" ? (
    <ArrowUp className="size-3" aria-hidden />
  ) : (
    <ArrowDown className="size-3" aria-hidden />
  );
}

/** The metal ordered by kind of unit, as one bar and its key. */
function KindSplit({ usage }: { usage: UnitUsage }) {
  const { resolved: theme } = useTheme();
  const colours = SPLIT_COLOURS[theme === "light" ? "light" : "dark"];
  const total = SPLIT_BUCKETS.reduce((n, b) => n + usage.split[b], 0);
  if (total <= 0) return null;
  const shown = SPLIT_BUCKETS.filter((b) => usage.split[b] > 0);
  return (
    <div className="flex flex-col gap-1.5" data-testid="unit-usage-split">
      <h3 className="text-xs font-medium text-muted-foreground">
        Metal ordered by kind of unit
      </h3>
      <div className="flex h-3 w-full overflow-hidden rounded-sm" aria-hidden>
        {shown.map((b) => (
          <div
            key={b}
            style={{
              width: `${(usage.split[b] / total) * 100}%`,
              backgroundColor: colours[b],
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {shown.map((b) => (
          <li key={b} className="flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: colours[b] }}
              aria-hidden
            />
            <span>{BUCKET[b]}</span>
            <span className="tabular-nums text-muted-foreground">
              {whole(usage.split[b])} metal
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Help({ usage, name }: { usage: UnitUsage; name: string }) {
  return (
    <SectionHelp section="units ordered" source="stream">
      <p>
        These are orders {name} gave, not units built. A replay does not say
        whether an order was carried out, and a unit taken off a factory queue
        is not taken off these counts. A skirmish AI's orders are not counted.
      </p>
      <p>
        Metal is the units ordered times the unit's metal cost, from the unit
        list of the build each game was played on. Other is builders, factories,
        sensors and transports. Unclassified is a unit whose definition does not
        say what it is for.
      </p>
      <p>
        Won is the games {name} won out of the games with a recorded result in
        which they ordered the unit. It is what happened in those games, not a
        sign that the unit caused it.
      </p>
      <p>
        A replay's unit numbers only mean something against the unit list of the
        build it was played on. A game with no such list is left out whole, and
        so is a game whose own orders do not fit its list.
      </p>
      {usage.noList.games > 0 && (
        <p>
          {games(usage.noList.games)} left out with{" "}
          {orders(usage.noList.orders)}: no unit list is kept and that build is
          not installed.
        </p>
      )}
      {usage.misfit.games > 0 && (
        <p>
          {games(usage.misfit.games)} left out with{" "}
          {orders(usage.misfit.orders)}: the orders do not fit the unit list.
        </p>
      )}
      {usage.failed > 0 && (
        <p>{games(usage.failed)} left out: the replay could not be read.</p>
      )}
      {usage.unnamedOrders > 0 && (
        <p>
          {orders(usage.unnamedOrders)} left out: the unit list does not reach
          the unit's number.
        </p>
      )}
      {usage.incomplete > 0 && (
        <p>
          In {games(usage.incomplete)} the recording stops early, so later
          orders are missing.
        </p>
      )}
      {usage.unpriced > 0 && (
        <p>
          {usage.unpriced.toLocaleString()} units ordered have no metal cost in
          their list and add nothing to the metal.
        </p>
      )}
      <p>
        Finished and died come from playing a game back with coilbox's own
        recorder, so only analysed games have them. They are the units of {name}
        's team, counted for a unit only in games where {name} ordered it. Died
        counts finished units only.
      </p>
      {usage.analysedUnnamed > 0 && (
        <p>
          {games(usage.analysedUnnamed)} analysed before the recorder kept the
          engine's unit list, so their events cannot be named and are not
          counted. Analysing them again adds them.
        </p>
      )}
      {usage.analysedNoTeam > 0 && (
        <p>
          {games(usage.analysedNoTeam)} analysed with no team recorded for{" "}
          {name} in the library, so their events are not counted.
        </p>
      )}
    </SectionHelp>
  );
}

const COLUMNS: { column: UsageColumn; label: string; numeric: boolean }[] = [
  { column: "name", label: "Unit", numeric: false },
  { column: "category", label: "Kind", numeric: false },
  { column: "matches", label: "Games", numeric: true },
  { column: "units", label: "Units", numeric: true },
  { column: "metal", label: "Metal", numeric: true },
  { column: "won", label: "Won", numeric: true },
  { column: "finished", label: "Finished", numeric: true },
  { column: "died", label: "Died", numeric: true },
];

export function PlayerUnitUsage({
  records,
  playerName,
  refightFilenames,
}: {
  records: StatRecord[];
  playerName: string;
  refightFilenames: ReadonlySet<string>;
}) {
  const played = useMemo(
    () =>
      gamesFor(
        records.filter((r) => isGenuineMatch(r, refightFilenames)),
        playerName,
      ),
    [records, playerName, refightFilenames],
  );
  const { usage, reading, error } = useUnitUsage(played, playerName, true);
  const [sort, setSort] = useState<UsageSort>(DEFAULT_USAGE_SORT);
  const rows = useMemo(() => sortUsageRows(usage.rows, sort), [usage, sort]);
  // The game is named beside a unit only when the rows are from more than one.
  const severalGames = useMemo(
    () => new Set(usage.rows.map((r) => r.game)).size > 1,
    [usage],
  );
  const pending = usage.unread + usage.waiting;
  const out = leftOut(usage);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">Units ordered</h2>
        <Help usage={usage} name={playerName} />
      </div>

      {error ? (
        <p className="text-sm text-destructive">
          The replays could not be read: {error}
        </p>
      ) : reading ? (
        <p className="text-sm text-muted-foreground">
          Reading {games(usage.games)}.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            From {usage.counted} of {games(usage.games)}.
            {out > 0 ? ` ${out} left out.` : ""}
            {pending > 0 ? ` ${pending} still being read.` : ""}
            {usage.analysed > 0
              ? ` Finished and died from ${games(usage.analysed)} analysed.`
              : ""}
          </p>
          {rows.length === 0 ? (
            pending === 0 && (
              <p className="text-sm text-muted-foreground">
                No build orders to show.
              </p>
            )
          ) : (
            <>
              <KindSplit usage={usage} />
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {COLUMNS.map(({ column, label, numeric }) => {
                      const dir = ariaSort(sort, column);
                      return (
                        <TableHead
                          key={column}
                          scope="col"
                          aria-sort={dir}
                          className={numeric ? "text-right" : undefined}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className={`h-7 gap-1 px-2 text-xs font-medium ${numeric ? "-mr-2" : "-ml-2"}`}
                            onClick={() => setSort(nextUsageSort(sort, column))}
                          >
                            {label}
                            <SortIcon dir={dir} />
                          </Button>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableHead scope="row" className="font-normal">
                        <div className="font-medium">{row.name}</div>
                        {severalGames && (
                          <div className="text-[11px] text-muted-foreground">
                            {row.game}
                          </div>
                        )}
                      </TableHead>
                      <TableCell>{KIND[row.category]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.matches.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.units.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.unpriced < row.units ? whole(row.metal) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.decided > 0 ? `${row.won} of ${row.decided}` : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.analysed && (
                          <>
                            <div>{row.analysed.finished.toLocaleString()}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {row.analysed.ordered.toLocaleString()} ordered in{" "}
                              {games(row.analysed.replays)}
                            </div>
                          </>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.analysed?.died.toLocaleString() ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </>
      )}
    </section>
  );
}
