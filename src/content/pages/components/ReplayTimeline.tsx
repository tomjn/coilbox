import { plural, t } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useLayoutEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import type { ChatLine } from "../../bindings";
import {
  axisTicks,
  binMarks,
  describeEvent,
  EVENT_KINDS,
  type EventKind,
  type EventMark,
  MARK_KINDS,
  type MarkKind,
  markTeams,
  stripLayout,
  type TimelineBin,
  type TimelineMark,
} from "../../replayTimeline";
import { useChartAxis } from "../../useChartAxis";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";

/**
 * Columns the match is cut into. A design choice, not a measurement: it keeps a
 * column wide enough to point at in a narrow window.
 */
const BIN_COUNT = 60;
/** Most lines the readout lists for one mark. */
const READOUT_LINES = 5;
/** Mark height in pixels, from one line to the busiest column of its row. */
const MARK_MIN = 6;
const MARK_MAX = 20;
/** Event diamond size in pixels, from one event to the busiest column of its row. */
const EVENT_MIN = 8;
const EVENT_MAX = 14;

/** Read when the timeline draws, so they follow the app language. */
function kindLabel(kind: MarkKind): string {
  switch (kind) {
    case "everyone":
      return t`Everyone`;
    case "allies":
      return t`Allies`;
    case "spectators":
      return t`Spectators`;
    case "whisper":
      return t`Whispers`;
    case "system":
      return t`System`;
  }
}

function eventLabel(kind: EventKind): string {
  switch (kind) {
    case "joined":
      return t`Joined late`;
    case "paused":
      return t`Pauses`;
    case "resigned":
      return t`Resigned`;
    case "giveAway":
      return t`Gave away`;
    case "left":
      return t`Left`;
    case "teamDied":
      return t`Eliminated`;
    case "other":
      return t`Other events`;
  }
}

/** What the strip is pointing at: a column of chat or a column of events. */
type Active =
  | { of: "chat"; bin: TimelineBin<TimelineMark> }
  | { of: "event"; bin: TimelineBin<EventMark> };

const NO_TEAMS: ReadonlyMap<number, number> = new Map();

const axisTime = (sec: number) => formatDuration(Math.round(sec));

function binTime(
  bin: TimelineBin<TimelineMark | EventMark>,
  totalSec: number,
): string {
  if (bin.slot === "pregame") return t`Before the game`;
  const from = Math.floor((bin.slot / BIN_COUNT) * totalSec);
  const to = Math.floor(((bin.slot + 1) / BIN_COUNT) * totalSec);
  const start = axisTime(from);
  if (from === to) return start;
  const end = axisTime(to);
  return t`${start} to ${end}`;
}

function binLabel(bin: TimelineBin, totalSec: number): string {
  const n = bin.marks.length;
  const kind = kindLabel(bin.kind);
  const time = binTime(bin, totalSec);
  const lines = plural(n, { one: "# line", other: "# lines" });
  return t`${kind}, ${time}, ${lines}`;
}

function eventBinLabel(bin: TimelineBin<EventMark>, totalSec: number): string {
  const n = bin.marks.length;
  const kind = eventLabel(bin.kind);
  const time = binTime(bin, totalSec);
  const count = plural(n, { one: "# event", other: "# events" });
  return t`Event, ${kind}, ${time}, ${count}`;
}

/** The line above the readout: the row the strip points at, and when. */
function readoutHeading(active: Active, totalSec: number): string {
  const time = binTime(active.bin, totalSec);
  if (active.of === "chat") {
    const kind = kindLabel(active.bin.kind);
    return t`${kind}, ${time}`;
  }
  const kind = eventLabel(active.bin.kind);
  return t`Event, ${kind}, ${time}`;
}

/**
 * The replay's chat and system lines along the match, one row per kind of line,
 * and under them its events, one row per kind of event. Marks that fall in the
 * same column of a row stack into one bigger mark. Rows are told apart by their
 * label. A system line is hollow where a person's is filled, and an event is a
 * diamond where a line is a bar, so nothing rests on colour. Selecting a line
 * opens it in the chat log. An event has nowhere to open, so it only reads out.
 *
 * A chat mark stands for the teams of whoever spoke in it, so it lights and
 * dims with them like a roster row does (#3855), and pointing at it lights
 * those teams elsewhere. Spectator, server and system lines have no team, and
 * neither do players the replay gives no number, so their marks stay as they
 * are. Mount it under a `SeriesEmphasisProvider`.
 *
 * While the page draws a match statistics chart, the strip takes that chart's
 * time axis, in position and in length, so a mark sits under the moment it
 * belongs to (#3856). The chart stops at its last sample, so a line after that
 * lands in the last column. With no chart the strip keeps `ownSec` and its own
 * columns.
 */
export function ReplayTimeline({
  marks,
  events = [],
  totalSec: ownSec,
  describe,
  onOpenLine,
  teamOf = NO_TEAMS,
}: {
  marks: TimelineMark[];
  events?: EventMark[];
  totalSec: number;
  describe: (line: ChatLine) => string;
  onOpenLine: (index: number) => void;
  /** Each seated player's engine team by player number. */
  teamOf?: ReadonlyMap<number, number>;
}) {
  useLocale();
  const e = useSeriesEmphasis();
  const [active, setActive] = useState<Active | null>(null);
  const axis = useChartAxis();
  const grid = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; right: number } | null>(null);
  const following = axis !== null;
  useLayoutEffect(() => {
    const el = grid.current;
    if (!following || !el) return;
    const measure = () => {
      const { left, right } = el.getBoundingClientRect();
      setBox({ left, right });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [following]);
  const totalSec = axis && axis.endSec > 0 ? axis.endSec : ownSec;
  const bins = binMarks(marks, totalSec, BIN_COUNT);
  const eventBins = binMarks(events, totalSec, BIN_COUNT);
  const hasPregame =
    marks.some((m) => m.second === null) ||
    events.some((m) => m.second === null);
  const kinds = MARK_KINDS.filter((k) => marks.some((m) => m.kind === k));
  const eventKinds = EVENT_KINDS.filter((k) =>
    events.some((m) => m.kind === k),
  );
  const ticks = axisTicks(totalSec);
  const hiddenCount = active ? active.bin.marks.length - READOUT_LINES : 0;
  const layout = axis && box ? stripLayout(axis, box, hasPregame) : null;
  const columns = layout
    ? ""
    : hasPregame
      ? "grid-cols-[5.5rem_3.5rem_minmax(0,1fr)]"
      : "grid-cols-[5.5rem_minmax(0,1fr)]";
  const labelsAbove = layout?.labelsAbove ?? false;
  const labelClass = `self-center pr-2 text-muted-foreground ${labelsAbove ? "col-span-full" : ""}`;

  const cell = (bin: TimelineBin, max: number, style: React.CSSProperties) => {
    const n = bin.marks.length;
    const height = Math.round(MARK_MIN + ((MARK_MAX - MARK_MIN) * n) / max);
    const teams = markTeams(bin.marks, teamOf);
    // Only teams with a line can be pointed at, as in the roster.
    const shown = teams.filter((team) => e.isShown(team));
    const lit = shown.length > 0 && e.isLit(shown);
    const faded = teams.length > 0 && e.dimming && !lit;
    const point = shown.length > 0 ? e.pointTo(shown) : undefined;
    const focus = shown.length > 0 ? e.focusOn(shown) : undefined;
    return (
      <button
        key={`${bin.kind}/${bin.slot}`}
        type="button"
        aria-label={binLabel(bin, totalSec)}
        data-emphasised={teams.length > 0 ? lit : undefined}
        onClick={() => onOpenLine(bin.marks[0].index)}
        onPointerEnter={(ev) => {
          setActive({ of: "chat", bin });
          point?.onPointerEnter(ev);
        }}
        onPointerLeave={point?.onPointerLeave}
        onFocus={(ev) => {
          setActive({ of: "chat", bin });
          focus?.onFocus(ev);
        }}
        onBlur={focus?.onBlur}
        className={`absolute inset-y-0 flex items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${
          lit ? "bg-accent/60 ring-2 ring-ring/40 ring-inset" : ""
        } ${faded ? "opacity-40" : ""}`}
        style={style}
      >
        <span
          aria-hidden
          className={`block w-1.5 rounded-full ${
            bin.kind === "system"
              ? "border border-foreground/70"
              : "bg-foreground/70"
          }`}
          style={{ height }}
        />
      </button>
    );
  };

  const eventCell = (
    bin: TimelineBin<EventMark>,
    max: number,
    style: React.CSSProperties,
  ) => {
    const n = bin.marks.length;
    const size = Math.round(
      EVENT_MIN + ((EVENT_MAX - EVENT_MIN) * (n - 1)) / Math.max(1, max - 1),
    );
    return (
      <button
        key={`${bin.kind}/${bin.slot}`}
        type="button"
        aria-label={eventBinLabel(bin, totalSec)}
        onClick={() => setActive({ of: "event", bin })}
        onPointerEnter={() => setActive({ of: "event", bin })}
        onFocus={() => setActive({ of: "event", bin })}
        className="absolute inset-y-0 flex items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        style={style}
      >
        <span
          aria-hidden
          className="block rotate-45 bg-foreground/70"
          style={{ width: size, height: size }}
        />
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-3 text-xs">
      <div
        ref={grid}
        data-testid="timeline-grid"
        className={`grid items-stretch gap-y-1 ${columns}`}
        style={
          layout
            ? {
                gridTemplateColumns: layout.columns,
                paddingRight: layout.paddingRight,
              }
            : undefined
        }
      >
        {kinds.map((kind) => {
          const row = bins.filter((b) => b.kind === kind);
          const max = Math.max(...row.map((b) => b.marks.length));
          const pre = row.find((b) => b.slot === "pregame");
          return (
            <div key={kind} className="contents">
              <span className={labelClass}>{kindLabel(kind)}</span>
              {hasPregame && (
                <div className="relative h-6 border-r border-border/60">
                  {pre && cell(pre, max, { left: 0, right: 0, width: "auto" })}
                </div>
              )}
              <div className="relative col-end-[-1] h-6">
                {row
                  .filter((b) => b.slot !== "pregame")
                  .map((b) =>
                    cell(b, max, {
                      left: `${(Number(b.slot) / BIN_COUNT) * 100}%`,
                      width: `${100 / BIN_COUNT}%`,
                    }),
                  )}
              </div>
            </div>
          );
        })}
        {eventKinds.map((kind) => {
          const row = eventBins.filter((b) => b.kind === kind);
          const max = Math.max(...row.map((b) => b.marks.length));
          const pre = row.find((b) => b.slot === "pregame");
          return (
            <div key={kind} className="contents">
              <span className={labelClass}>{eventLabel(kind)}</span>
              {hasPregame && (
                <div className="relative h-6 border-r border-border/60">
                  {pre &&
                    eventCell(pre, max, { left: 0, right: 0, width: "auto" })}
                </div>
              )}
              <div className="relative col-end-[-1] h-6">
                {row
                  .filter((b) => b.slot !== "pregame")
                  .map((b) =>
                    eventCell(b, max, {
                      left: `${(Number(b.slot) / BIN_COUNT) * 100}%`,
                      width: `${100 / BIN_COUNT}%`,
                    }),
                  )}
              </div>
            </div>
          );
        })}
        {!labelsAbove && <span />}
        {hasPregame && (
          <span className="pt-1 text-center text-muted-foreground">
            <Trans>Before</Trans>
          </span>
        )}
        <div
          data-testid="timeline-axis"
          className="relative col-end-[-1] h-5 border-t border-border/60 text-muted-foreground"
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-1 -translate-x-1/2 tabular-nums first:translate-x-0"
              style={{ left: `${totalSec > 0 ? (tick / totalSec) * 100 : 0}%` }}
            >
              {axisTime(tick)}
            </span>
          ))}
        </div>
      </div>
      <div aria-live="polite" className="min-h-16 text-xs">
        {active ? (
          <>
            <p className="font-medium">{readoutHeading(active, totalSec)}</p>
            <ul className="text-muted-foreground">
              {active.of === "chat"
                ? active.bin.marks.slice(0, READOUT_LINES).map((m) => (
                    <li key={m.index} className="break-words">
                      {describe(m.line)}
                    </li>
                  ))
                : active.bin.marks.slice(0, READOUT_LINES).map((m) => (
                    <li
                      key={`${m.event.frame}/${m.event.time}/${m.event.player}/${m.event.type}`}
                      className="break-words"
                    >
                      {m.second === null ? t`Pre-game` : axisTime(m.second)}{" "}
                      {describeEvent(m.event)}
                    </li>
                  ))}
              {active.bin.marks.length > READOUT_LINES && (
                <li>
                  <Trans>and {hiddenCount} more</Trans>
                </li>
              )}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
