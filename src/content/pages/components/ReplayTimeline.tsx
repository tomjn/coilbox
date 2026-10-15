import { useState } from "react";
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
  type TimelineBin,
  type TimelineMark,
} from "../../replayTimeline";

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

const KIND_LABEL: Record<MarkKind, string> = {
  everyone: "Everyone",
  allies: "Allies",
  spectators: "Spectators",
  whisper: "Whispers",
  system: "System",
};

const EVENT_LABEL: Record<EventKind, string> = {
  joined: "Joined late",
  paused: "Pauses",
  resigned: "Resigned",
  giveAway: "Gave away",
  left: "Left",
  teamDied: "Eliminated",
  other: "Other events",
};

/** What the strip is pointing at: a column of chat or a column of events. */
type Active =
  | { of: "chat"; bin: TimelineBin<TimelineMark> }
  | { of: "event"; bin: TimelineBin<EventMark> };

const axisTime = (sec: number) => formatDuration(Math.round(sec));

function binTime(
  bin: TimelineBin<TimelineMark | EventMark>,
  totalSec: number,
): string {
  if (bin.slot === "pregame") return "Before the game";
  const from = Math.floor((bin.slot / BIN_COUNT) * totalSec);
  const to = Math.floor(((bin.slot + 1) / BIN_COUNT) * totalSec);
  return from === to ? axisTime(from) : `${axisTime(from)} to ${axisTime(to)}`;
}

function binLabel(bin: TimelineBin, totalSec: number): string {
  const n = bin.marks.length;
  return `${KIND_LABEL[bin.kind]}, ${binTime(bin, totalSec)}, ${n} ${n === 1 ? "line" : "lines"}`;
}

function eventBinLabel(bin: TimelineBin<EventMark>, totalSec: number): string {
  const n = bin.marks.length;
  return `Event, ${EVENT_LABEL[bin.kind]}, ${binTime(bin, totalSec)}, ${n} ${n === 1 ? "event" : "events"}`;
}

/**
 * The replay's chat and system lines along the match, one row per kind of line,
 * and under them its events, one row per kind of event. Marks that fall in the
 * same column of a row stack into one bigger mark. Rows are told apart by their
 * label. A system line is hollow where a person's is filled, and an event is a
 * diamond where a line is a bar, so nothing rests on colour. Selecting a line
 * opens it in the chat log. An event has nowhere to open, so it only reads out.
 */
export function ReplayTimeline({
  marks,
  events = [],
  totalSec,
  describe,
  onOpenLine,
}: {
  marks: TimelineMark[];
  events?: EventMark[];
  totalSec: number;
  describe: (line: ChatLine) => string;
  onOpenLine: (index: number) => void;
}) {
  const [active, setActive] = useState<Active | null>(null);
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
  const columns = hasPregame
    ? "grid-cols-[5.5rem_3.5rem_minmax(0,1fr)]"
    : "grid-cols-[5.5rem_minmax(0,1fr)]";

  const cell = (bin: TimelineBin, max: number, style: React.CSSProperties) => {
    const n = bin.marks.length;
    const height = Math.round(MARK_MIN + ((MARK_MAX - MARK_MIN) * n) / max);
    return (
      <button
        key={`${bin.kind}/${bin.slot}`}
        type="button"
        aria-label={binLabel(bin, totalSec)}
        onClick={() => onOpenLine(bin.marks[0].index)}
        onPointerEnter={() => setActive({ of: "chat", bin })}
        onFocus={() => setActive({ of: "chat", bin })}
        className="absolute inset-y-0 flex items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
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
      <div className={`grid items-stretch gap-y-1 ${columns}`}>
        {kinds.map((kind) => {
          const row = bins.filter((b) => b.kind === kind);
          const max = Math.max(...row.map((b) => b.marks.length));
          const pre = row.find((b) => b.slot === "pregame");
          return (
            <div key={kind} className="contents">
              <span className="self-center pr-2 text-muted-foreground">
                {KIND_LABEL[kind]}
              </span>
              {hasPregame && (
                <div className="relative h-6 border-r border-border/60">
                  {pre && cell(pre, max, { left: 0, right: 0, width: "auto" })}
                </div>
              )}
              <div className="relative h-6">
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
              <span className="self-center pr-2 text-muted-foreground">
                {EVENT_LABEL[kind]}
              </span>
              {hasPregame && (
                <div className="relative h-6 border-r border-border/60">
                  {pre &&
                    eventCell(pre, max, { left: 0, right: 0, width: "auto" })}
                </div>
              )}
              <div className="relative h-6">
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
        <span />
        {hasPregame && (
          <span className="pt-1 text-center text-muted-foreground">Before</span>
        )}
        <div className="relative h-5 border-t border-border/60 text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute top-1 -translate-x-1/2 tabular-nums first:translate-x-0"
              style={{ left: `${totalSec > 0 ? (t / totalSec) * 100 : 0}%` }}
            >
              {axisTime(t)}
            </span>
          ))}
        </div>
      </div>
      <div aria-live="polite" className="min-h-16 text-xs">
        {active ? (
          <>
            <p className="font-medium">
              {active.of === "chat"
                ? KIND_LABEL[active.bin.kind]
                : `Event, ${EVENT_LABEL[active.bin.kind]}`}
              , {binTime(active.bin, totalSec)}
            </p>
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
                      {m.second === null ? "Pre-game" : axisTime(m.second)}{" "}
                      {describeEvent(m.event)}
                    </li>
                  ))}
              {active.bin.marks.length > READOUT_LINES && (
                <li>and {active.bin.marks.length - READOUT_LINES} more</li>
              )}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
