import { Button, cn, useTheme } from "@picoframe/frame";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDuration } from "@/lib/format";
import type { DemoInfo } from "../../bindings";
import { FRAMES_PER_SECOND } from "../../chatClock";
import { type ChartSeries, seriesTeams } from "../../matchStats";
import { analysisRunHidden, useStoredAnalyses } from "../../replayAnalysis";
import type { LogEvent } from "../../replayAnalysisEvents";
import {
  type EventState,
  eventState,
  OUTDATED_NOTE,
} from "../../replayEventLayers";
import { readReplayEvents } from "../../replayEventRead";
import {
  GIVEN_LOGGER_VERSION,
  LIVING_VALUE_KINDS,
  livingValue,
  peakOf,
  type ValueResource,
  valueRows,
} from "../../replayLivingValue";
import { SPLIT_BUCKETS, type SplitBucket } from "../../replayOpening";
import { useReplayUnits } from "../../useReplayUnits";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { SectionHelp } from "./SectionHelp";
import { StoredListNote } from "./UnitListNotes";

/**
 * What each player's living units were worth, by kind of unit, as its own
 * small charts under the match chart (#1174).
 *
 * It is not a metric in the registry, for the reason commands per minute is
 * not: the registry is the trailer's fields, and this comes from an analysis's
 * events and the installed game's unit definitions. It takes the match chart's
 * own lines, so names, the Players and Teams view and the roster's unchecked
 * seats carry over, and its samples sit on the trailer's own period.
 *
 * One panel for each line, all on one scale, because a stack of kinds for
 * every player in one plot cannot be read. Metal and energy are two views and
 * never one number.
 */

const LABEL: Record<SplitBucket, string> = {
  economy: "Economy",
  defence: "Defence",
  offence: "Offence",
  other: "Builders, factories, sensors and transports",
  unclassified: "Unclassified",
};

/**
 * The kinds' colours: the first four slots of the data visualisation palette
 * in their fixed order, each mode's own steps, checked with its validator for
 * colour blind separation and contrast on that mode's surface. Unclassified is
 * the palette's muted grey, since it is the absence of a kind.
 */
const COLOURS: Record<"light" | "dark", Record<SplitBucket, string>> = {
  light: {
    economy: "#2a78d6",
    defence: "#eb6834",
    offence: "#1baf7a",
    other: "#eda100",
    unclassified: "#898781",
  },
  dark: {
    economy: "#3987e5",
    defence: "#d95926",
    offence: "#199e70",
    other: "#c98500",
    unclassified: "#898781",
  },
};

const axisTick = { fontSize: 11, fill: "currentColor", opacity: 0.65 };
const axisTime = (sec: number) => formatDuration(Math.round(sec));
const axisValue = (v: number) =>
  v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v));

const HEADING = "Value of living units by kind";

type Read =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "done"; events: LogEvent[] };

interface ChartProps {
  info: DemoInfo;
  /** The lines the match chart is drawing, already coloured. */
  series: ChartSeries[];
  /** Where the match chart's time axis ends, in seconds. */
  endSec: number;
  /** The trailer's own sample period, so this sits on the same time axis. */
  periodSec: number;
}

const frame = (children: React.ReactNode, help?: React.ReactNode) => (
  <div
    className="flex flex-col gap-2 border-t border-border/50 pt-3"
    data-testid="living-value"
  >
    <div className="flex items-center gap-1">
      <h3 className="text-sm font-medium">{HEADING}</h3>
      {help && (
        <SectionHelp section="the value of living units by kind" source="log">
          {help}
        </SectionHelp>
      )}
    </div>
    {children}
  </div>
);
const note = (text: string) => (
  <p className="text-xs text-muted-foreground">{text}</p>
);

export function LivingValueChart(props: ChartProps) {
  const { info } = props;
  const analyses = useStoredAnalyses();
  const stored =
    info.remixed || !info.gameId ? undefined : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  const [open, setOpen] = useState(false);

  if (state.kind === "remix")
    return frame(
      note(
        "This needs an analysis, and a remix has no analysis of its own. Analyse the original match.",
      ),
    );
  if (state.kind === "diverged")
    return frame(
      note(
        "This needs an analysis. The playback did not reproduce the recorded match, so what it recorded was thrown away and there is nothing to add up.",
      ),
    );
  if (state.kind === "notAnalysed")
    return frame(
      note(
        state.canAnalyse
          ? "This needs an analysis, and this replay has not been analysed."
          : "This needs an analysis, and this replay has not been analysed. This copy of coilbox cannot analyse replays.",
      ),
      state.canAnalyse ? (
        <p>
          The replay itself records what was produced and lost, not what a
          player owned at any moment.
        </p>
      ) : undefined,
    );

  if (!open)
    return (
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setOpen(true)}
        >
          Show value of living units by kind
        </Button>
      </div>
    );
  return <OpenValueChart {...props} state={state} />;
}

/** The charts once asked for. The events and the game's units are read here
 *  and nowhere above, so nothing is read until the reader asks. */
function OpenValueChart({
  info,
  series,
  endSec,
  periodSec,
  state,
}: ChartProps & { state: Extract<EventState, { kind: "ready" }> }) {
  const [resource, setResource] = useState<ValueResource>("metal");
  const [read, setRead] = useState<Read>({ status: "loading" });
  const units = useReplayUnits(info, true, "events");
  const emphasis = useSeriesEmphasis();
  const { resolved: theme } = useTheme();
  const colours = COLOURS[theme === "light" ? "light" : "dark"];

  const { gameId, analysedAtMs: atMs } = state;
  useEffect(() => {
    let stale = false;
    setRead({ status: "loading" });
    readReplayEvents(gameId, atMs, LIVING_VALUE_KINDS).then(
      (events) => {
        if (!stale) setRead({ status: "done", events });
      },
      () => {
        if (!stale) setRead({ status: "failed" });
      },
    );
    return () => {
      stale = true;
    };
  }, [gameId, atMs]);

  const value = useMemo(
    () =>
      read.status === "done" && units.units
        ? livingValue(
            read.events,
            units.units,
            periodSec,
            endSec * FRAMES_PER_SECOND,
          )
        : null,
    [read, units.units, periodSec, endSec],
  );
  const panels = useMemo(
    () =>
      value
        ? series.map((s) => {
            const teams = seriesTeams(s, info);
            return {
              series: s,
              teams,
              rows: valueRows(value, teams, resource),
            };
          })
        : [],
    [value, series, info, resource],
  );
  const peak = useMemo(
    () => Math.max(0, ...panels.map((p) => peakOf(p.rows))),
    [panels],
  );

  const body = () => {
    if (read.status === "failed")
      return (
        <p className="text-xs text-destructive">
          The events could not be read from this replay's analysis.
        </p>
      );
    if (
      read.status === "loading" ||
      units.status === "loading" ||
      !units.source
    )
      return note("Reading events and unit definitions…");
    if (units.source.kind === "notInstalled")
      return note(
        `${units.recorded || "This replay's game"} is not installed, so nothing says what a unit costs or what it is for.`,
      );
    if (!value)
      return note(
        "The units of this replay's game could not be read, so nothing says what a unit costs or what it is for.",
      );
    if (value.seconds.length < 2)
      return note(
        `This replay is shorter than one ${periodSec} second period, so there is nothing to draw.`,
      );
    return (
      <>
        <StoredListNote source={units.source} subject="Costs and kinds" />
        {units.source.kind === "differentBuild" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This replay was played on {units.recorded}, which is not installed.
            Costs and kinds come from {units.source.game.name}, a different
            build, and may be wrong.
          </p>
        )}
        {state.outdated && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {OUTDATED_NOTE}
            {state.loggerVersion < GIVEN_LOGGER_VERSION &&
              " It did not record a unit changing hands, so a unit that was given away or captured is counted for its first owner throughout."}
          </p>
        )}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={resource}
          onValueChange={(v) => v && setResource(v as ValueResource)}
          aria-label="Cost in"
          className="self-start"
        >
          <ToggleGroupItem value="metal" className="px-3 text-xs">
            Metal cost
          </ToggleGroupItem>
          <ToggleGroupItem value="energy" className="px-3 text-xs">
            Energy cost
          </ToggleGroupItem>
        </ToggleGroup>
        <ul
          aria-label="Kinds of unit"
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
        >
          {SPLIT_BUCKETS.map((bucket) => (
            <li key={bucket} className="flex items-center gap-1">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ backgroundColor: colours[bucket] }}
              />
              {LABEL[bucket]}
            </li>
          ))}
        </ul>
        {panels.length === 0 || peak === 0 ? (
          note(
            panels.length === 0
              ? "No line is on the chart above."
              : `No finished unit with a ${resource} cost belongs to the lines on the chart above.`,
          )
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {panels.map(({ series: s, teams, rows }) => {
              const lit = emphasis.isLit(teams);
              return (
                <figure
                  key={s.id}
                  data-value-panel={s.id}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 transition-opacity",
                    emphasis.dimming && !lit && "opacity-40",
                  )}
                >
                  <figcaption className="flex items-center gap-1.5 text-xs font-medium">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </figcaption>
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart
                      data={rows}
                      margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="currentColor"
                        opacity={0.12}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="timeSec"
                        type="number"
                        domain={[0, endSec]}
                        tickFormatter={axisTime}
                        tick={axisTick}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={32}
                      />
                      {/* One scale for every panel, so two players compare. */}
                      <YAxis
                        domain={[0, peak]}
                        tickFormatter={axisValue}
                        tick={axisTick}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        formatter={(v, name) => [
                          `${Math.round(Number(v)).toLocaleString()} ${resource}`,
                          LABEL[name as SplitBucket] ?? name,
                        ]}
                        labelFormatter={(t) => axisTime(Number(t))}
                        isAnimationActive={false}
                      />
                      {SPLIT_BUCKETS.map((bucket) => (
                        <Area
                          key={bucket}
                          // A value holds until a unit is finished or lost.
                          type="stepAfter"
                          dataKey={bucket}
                          stackId="value"
                          stroke={colours[bucket]}
                          strokeWidth={1}
                          fill={colours[bucket]}
                          fillOpacity={0.85}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </figure>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const explained =
    read.status === "done" &&
    !!units.source &&
    units.source.kind !== "notInstalled" &&
    !!value &&
    value.seconds.length >= 2;
  return frame(
    body(),
    explained && value ? (
      <p>
        The {resource} cost of each line's finished, living units every{" "}
        {periodSec} seconds, stacked by what each unit is for. A unit counts
        from the moment it is finished until it is destroyed, and moves with it
        when it is given away or captured. A unit still being built counts
        nothing. Costs and kinds come from the installed game's unit
        definitions, and every panel has the same scale. Metal and energy are
        never added together.
        {value.unpriced > 0 &&
          ` ${value.unpriced.toLocaleString()} of ${value.finished.toLocaleString()} finished units have no cost in the installed game and count nothing.`}
      </p>
    ) : undefined,
  );
}
