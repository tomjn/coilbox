import { Button } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Crosshair,
  Trophy,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toggle } from "@/components/ui/toggle";
import { RatingBadge } from "@/multiplayer/UserBadges";
import { isProfileHidden } from "../../../profile/hidden";
import type { DemoInfo, ReplayAi, ReplayPlayer } from "../../bindings";
import { hasStatistics } from "../../matchStats";
import { formatFigure } from "../../replayMatchFigures";
import {
  ariaSort,
  buildRoster,
  cellValue,
  nextSort,
  parseRating,
  type RosterColumn,
  type RosterRow,
  type RosterSort,
  rosterMetrics,
  rowApm,
  type Seat,
  sortRows,
  teamFinals,
} from "../../replayRoster";
import { teamLabel } from "../../replaySideLabel";
import { isEmphasised } from "../../seriesEmphasis";
import { useMatchStats } from "../../useMatchStats";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { SectionHelp } from "./SectionHelp";

/**
 * The roster on replay detail: one row per team, grouped by ally side, with the
 * match's figures beside each and the controls that narrow and point at the chart
 * below it (#1143).
 *
 * A column header sorts. Sorting drops the grouping and lists every team in one
 * order with its side named on the row, because "who did the damage" is a
 * question about the whole match. With no column sorted the grouped order is
 * back, side header rows and all.
 *
 * The figures and the checkboxes each wait for what they need. With no trailer,
 * or one that measured nothing, the roster is names, ratings and results. With
 * the profile hiding match statistics there are no totals, no APM and no
 * checkboxes either, because the chart they control is not there.
 */

/** `rgbColor` (0..1) to a CSS colour for a team swatch. */
export function swatch(rgb?: [number, number, number]): string | undefined {
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((v) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255),
  );
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * What the rating's tooltip says besides the number. The uncertainty is the
 * figure the start script holds, shown as written and used for nothing else.
 */
export function ratingDetail(skill: string, uncertainty?: number): string {
  const base = `This is the rating the lobby recorded for its declared game mode, which may not be the one this match was played in. The start script says: ${skill}`;
  return uncertainty === undefined
    ? base
    : `${base}. The lobby recorded an uncertainty of ${uncertainty} with the rating.`;
}

/** How a seat's side finished, or undefined where the file doesn't say. */
type SeatOutcome = "won" | "lost" | undefined;

function outcomeOf(info: DemoInfo, ally: number): SeatOutcome {
  if (!info.winnersKnown || info.winningAllyTeams.length === 0)
    return undefined;
  return info.winningAllyTeams.includes(ally) ? "won" : "lost";
}

/**
 * The result beside a team, as a word and a mark. Colour never carries it
 * alone (#1142): "Won" and "Lost" are text, the trophy only repeats the win.
 */
function SeatResult({ result }: { result: SeatOutcome }) {
  if (!result) return null;
  return result === "won" ? (
    <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
      <Trophy className="size-3.5" aria-hidden />
      Won
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">Lost</span>
  );
}

/** A seat's counters on hover: the figures APM is made from. */
function apmDetail(p: ReplayPlayer): string | undefined {
  const s = p.stats;
  return s
    ? [
        `${s.numCommands} orders given`,
        `${s.unitCommands} reached a unit`,
        `${s.mouseClicks} mouse clicks`,
        `${s.keyPresses} key presses`,
        `${s.mousePixels} pixels of mouse travel`,
      ].join(", ")
    : undefined;
}

/** One line per seat in every cell of a row, so a shared team's cells line up. */
const SEAT_LINE = "flex h-7 items-center gap-2";

/** Unique within a team: a person is told apart by name, a bot by its name and identity. */
function seatKey(seat: Seat): string {
  return seat.kind === "player"
    ? `p:${seat.player.name}`
    : `a:${seat.ai.name}:${seat.ai.shortName}`;
}

function seatName(seat: Seat): string {
  return seat.kind === "player"
    ? seat.player.name
    : seat.ai.shortName || seat.ai.name || "AI";
}

function PlayerName({ p }: { p: ReplayPlayer }) {
  return (
    <div className={SEAT_LINE}>
      <span
        className="inline-block size-3 shrink-0 rounded-sm border border-border/60"
        style={{ backgroundColor: swatch(p.rgbColor) ?? "transparent" }}
        aria-hidden
      />
      <span className="max-w-56 truncate text-sm">
        {/* Spectators aren't in the stats database (see stats.rs), so only
         * seated players link through to the dossier (#375). */}
        {p.spectator ? (
          p.name
        ) : (
          <Link
            to={`/stats/${encodeURIComponent(p.name)}`}
            className="hover:underline"
            title={p.name}
          >
            {p.name}
          </Link>
        )}
        {p.countryCode ? (
          <span className="ml-1 text-xs text-muted-foreground">
            {p.countryCode}
          </span>
        ) : null}
      </span>
      {p.side && (
        <span className="shrink-0 text-xs text-muted-foreground">{p.side}</span>
      )}
    </div>
  );
}

/**
 * One skirmish AI's seat. Named by its `shortName` (the identity: `BARb`,
 * `SurvivalAI`), since the recorded `name` is usually just a slot label. No
 * dossier link: a bot has no stats profile, and its name repeats across
 * unrelated matches.
 */
function AiName({ a }: { a: ReplayAi }) {
  const label = a.shortName || a.name || "AI";
  const full = [a.name, a.shortName, a.version].filter(Boolean).join(" · ");
  return (
    <div className={SEAT_LINE}>
      <span
        className="inline-block size-3 shrink-0 rounded-sm border border-border/60"
        style={{ backgroundColor: swatch(a.rgbColor) ?? "transparent" }}
        aria-hidden
      />
      <span className="max-w-56 truncate text-sm" title={full}>
        {label}
      </span>
      <Badge
        variant="ghost"
        className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      >
        Bot
      </Badge>
      {a.side && (
        <span className="shrink-0 text-xs text-muted-foreground">{a.side}</span>
      )}
    </div>
  );
}

/** A checkbox for some teams. Checked, unchecked, or indeterminate for a side half shown. */
function ChartCheck({
  teams,
  label,
  withLabel,
}: {
  teams: number[];
  label: string;
  /** Print the label beside the box. Otherwise it is the box's accessible name only. */
  withLabel?: boolean;
}) {
  const e = useSeriesEmphasis();
  const id = useId();
  const box = (
    <Checkbox
      id={id}
      checked={e.checkState(teams)}
      // Radix gives the state it moves to, and from indeterminate that is
      // checked, so a half shown side shows all of itself on the first press.
      onCheckedChange={(v) => e.setShown(teams, v === true)}
      aria-label={withLabel ? undefined : label}
    />
  );
  if (!withLabel) return box;
  return (
    <span className="inline-flex items-center gap-1.5">
      {box}
      <label htmlFor={id} className="text-xs font-semibold">
        {label}
      </label>
    </span>
  );
}

function SortIcon({ dir }: { dir: "ascending" | "descending" | "none" }) {
  if (dir === "none") return <ArrowUpDown className="size-3" aria-hidden />;
  return dir === "ascending" ? (
    <ArrowUp className="size-3" aria-hidden />
  ) : (
    <ArrowDown className="size-3" aria-hidden />
  );
}

interface FigureColumn {
  column: RosterColumn;
  label: string;
  hint?: string;
}

export function ReplayRoster({
  info,
  replayPath,
}: {
  info: DemoInfo;
  replayPath?: string;
}) {
  const statsOn = !isProfileHidden("analytics.matchStats");
  const { data } = useMatchStats(statsOn && replayPath ? replayPath : null);
  const e = useSeriesEmphasis();
  const [sort, setSort] = useState<RosterSort | null>(null);

  const roster = useMemo(() => buildRoster(info), [info]);
  // Nothing measured is no totals, which is not a column of zeros.
  const measured = statsOn && data && hasStatistics(data.trailer) ? data : null;
  const finals = useMemo(
    () =>
      measured
        ? teamFinals(measured.trailer, rosterMetrics(measured.metrics))
        : new Map<number, Record<string, number>>(),
    [measured],
  );

  const figures: FigureColumn[] = [];
  if (statsOn && roster.rows.some((r) => rowApm(r) !== undefined))
    figures.push({
      column: { kind: "apm" },
      label: "APM",
      hint: "Actions per minute",
    });
  if (measured)
    for (const m of rosterMetrics(measured.metrics))
      figures.push({ column: { kind: "metric", key: m.key }, label: m.label });

  const hasRating = roster.rows.some((r) =>
    r.seats.some(
      (s) => s.kind === "player" && parseRating(s.player.skill) !== undefined,
    ),
  );
  const hasResult = roster.sides.some((id) => outcomeOf(info, id));
  const hasChecks = roster.rows.some((r) => e.isCharted(r.team));
  const sorted = sort !== null;
  const rows = sortRows(roster.rows, sort, finals);

  /** The charted teams on a side, which a side's checkbox stands for. */
  const sideTeams = (id: number) =>
    roster.rows
      .filter(
        (r) => r.allyTeam === id && r.team !== undefined && e.isCharted(r.team),
      )
      .map((r) => r.team as number);
  // A side with one charted team has nothing a side box would do that the
  // team's own box does not.
  const checkableSides = roster.sides.filter((id) => sideTeams(id).length > 1);

  const columnCount =
    (hasChecks ? 1 : 0) +
    1 +
    (sorted ? 1 : 0) +
    (hasRating ? 1 : 0) +
    figures.length +
    (hasResult ? 1 : 0) +
    (hasChecks ? 1 : 0);

  function renderRow(row: RosterRow) {
    const teams = row.team === undefined ? null : [row.team];
    const charted = e.isCharted(row.team);
    const shown = e.isShown(row.team);
    const lit = shown && e.isLit(teams);
    const label = seatName(row.seats[0]);
    const result = outcomeOf(info, row.allyTeam);
    return (
      <TableRow
        key={row.key}
        data-emphasised={lit}
        className={`${lit ? "bg-accent/60 ring-2 ring-ring/40 ring-inset" : ""} ${
          charted && !shown ? "opacity-60" : ""
        }`}
        {...(shown && teams ? e.pointTo(teams) : {})}
      >
        {hasChecks && (
          <TableCell className="w-8">
            {charted && teams && (
              <ChartCheck teams={teams} label={`Show ${label} on the chart`} />
            )}
          </TableCell>
        )}
        <TableCell>
          {row.seats.map((s) =>
            s.kind === "player" ? (
              <PlayerName key={seatKey(s)} p={s.player} />
            ) : (
              <AiName key={seatKey(s)} a={s.ai} />
            ),
          )}
        </TableCell>
        {sorted && (
          <TableCell className="text-xs text-muted-foreground">
            {row.allyTeam === -1 ? "Unassigned" : teamLabel(row.allyTeam)}
          </TableCell>
        )}
        {hasRating && (
          <TableCell>
            {row.seats.map((s) => {
              const n =
                s.kind === "player" ? parseRating(s.player.skill) : undefined;
              return (
                <div key={seatKey(s)} className={SEAT_LINE}>
                  {s.kind === "player" && n !== undefined && s.player.skill && (
                    <RatingBadge
                      rating={{ casual: null, matchmaking: null, overall: n }}
                      detail={ratingDetail(
                        s.player.skill,
                        s.player.skillUncertainty,
                      )}
                    />
                  )}
                </div>
              );
            })}
          </TableCell>
        )}
        {figures.map(({ column }) =>
          column.kind === "apm" ? (
            <TableCell key="apm" className="text-right tabular-nums">
              {row.seats.map((s) => (
                <div
                  key={seatKey(s)}
                  className={`${SEAT_LINE} justify-end text-xs text-muted-foreground`}
                  title={s.kind === "player" ? apmDetail(s.player) : undefined}
                >
                  {s.kind === "player" && s.player.apm !== undefined
                    ? Math.round(s.player.apm)
                    : "—"}
                </div>
              ))}
            </TableCell>
          ) : (
            <TableCell key={column.key} className="text-right tabular-nums">
              {formatFigure(cellValue(row, column, finals))}
            </TableCell>
          ),
        )}
        {hasResult && (
          <TableCell>
            <SeatResult result={result} />
          </TableCell>
        )}
        {hasChecks && (
          <TableCell className="w-10">
            {shown && teams && (
              <Toggle
                size="sm"
                aria-label={`Highlight ${label} on the chart`}
                title={`Highlight ${label} on the chart`}
                pressed={isEmphasised(
                  { ...e.state, hovered: null, resting: null },
                  teams,
                )}
                onPressedChange={() => e.toggleSelected(teams)}
                {...e.focusOn(teams)}
              >
                <Crosshair aria-hidden />
              </Toggle>
            )}
          </TableCell>
        )}
      </TableRow>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">Players</h2>
        <SectionHelp
          section="the players"
          source={statsOn ? "players" : "setup"}
        />
      </div>
      {sorted && hasChecks && checkableSides.length > 0 && (
        // Sorting drops the side header rows, which is where side boxes live.
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          Sides on the chart
          {checkableSides.map((id) => (
            <ChartCheck
              key={id}
              teams={sideTeams(id)}
              label={id === -1 ? "Unassigned" : teamLabel(id)}
              withLabel
            />
          ))}
        </div>
      )}
      <div className="rounded-lg border border-border/50 bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {hasChecks && (
                <TableHead className="w-8">
                  <span className="sr-only">Show on the chart</span>
                </TableHead>
              )}
              <TableHead scope="col" className="text-xs">
                Player
              </TableHead>
              {sorted && (
                <TableHead scope="col" className="text-xs">
                  Side
                </TableHead>
              )}
              {hasRating && (
                <TableHead scope="col" className="text-xs">
                  Rating
                </TableHead>
              )}
              {figures.map(({ column, label, hint }) => {
                const dir = ariaSort(sort, column);
                return (
                  <TableHead
                    key={column.kind === "apm" ? "apm" : column.key}
                    scope="col"
                    aria-sort={dir}
                    className="text-right text-xs"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-mr-2 h-7 gap-1 px-2 text-xs font-medium"
                      title={hint}
                      onClick={() => setSort(nextSort(sort, column))}
                    >
                      {label}
                      <SortIcon dir={dir} />
                    </Button>
                  </TableHead>
                );
              })}
              {hasResult && (
                <TableHead scope="col" className="text-xs">
                  Result
                </TableHead>
              )}
              {hasChecks && (
                <TableHead className="w-10">
                  <span className="sr-only">Highlight on the chart</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          {sorted ? (
            <TableBody>{rows.map(renderRow)}</TableBody>
          ) : (
            roster.sides.map((id) => {
              const result = outcomeOf(info, id);
              const won = result === "won";
              const teams = sideTeams(id);
              return (
                <TableBody key={id}>
                  <TableRow
                    className={
                      won
                        ? "bg-amber-500/5 hover:bg-amber-500/5"
                        : "bg-muted/30 hover:bg-muted/30"
                    }
                  >
                    <TableHead
                      scope="rowgroup"
                      colSpan={columnCount}
                      className="h-8 text-xs font-semibold text-muted-foreground"
                    >
                      <span className="flex items-center gap-2">
                        {hasChecks && teams.length > 1 && (
                          <ChartCheck
                            teams={teams}
                            label={`Show all of ${id === -1 ? "Unassigned" : teamLabel(id)} on the chart`}
                          />
                        )}
                        {id === -1 ? "Unassigned" : teamLabel(id)}
                        {won && (
                          <Badge
                            variant="ghost"
                            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                          >
                            <Trophy className="size-3" /> Winner
                          </Badge>
                        )}
                      </span>
                    </TableHead>
                  </TableRow>
                  {rows.filter((r) => r.allyTeam === id).map(renderRow)}
                </TableBody>
              );
            })
          )}
        </Table>
      </div>
      {roster.spectators.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Spectators: {roster.spectators.map((s) => s.name).join(", ")}
        </p>
      )}
    </section>
  );
}
