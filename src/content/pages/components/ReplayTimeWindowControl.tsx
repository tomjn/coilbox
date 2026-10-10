import { Button } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/format";
import { axisTicks } from "../../replayTimeline";
import {
  type ActivitySeries,
  activityPath,
  type TimeWindow,
  toWindow,
  windowPresets,
} from "../../replayTimeWindow";

/** Match time as the timeline's axis writes it. */
const axisTime = (sec: number) => formatDuration(Math.round(sec));

/** How many of a layer's points are inside the window, out of all of them. */
export interface WindowCount {
  inside: number;
  total: number;
}

/** What the window is about. Orders have a time they were given, and events
 *  have a time they happened in the playback, and the two are not added up. */
export type WindowSubject = "orders" | "events" | "both";

const SUBJECT_TEXT: Record<WindowSubject, string> = {
  orders: "Orders given",
  events: "Events",
  both: "Orders given and events",
};

const SUBJECT_NOTE: Record<WindowSubject, string> = {
  orders: "The window is when an order was given, not when anything was built.",
  events: "The window is when each event happened in the playback.",
  both: "For orders the window is when each was given, not when anything was built. For events it is when each happened in the playback.",
};

/** A count as a short label, such as "2,897 of 2,897 building orders". */
function countText(count: WindowCount, noun: string): string {
  if (count.total === 0) return `No ${noun}.`;
  return `${count.inside.toLocaleString()} of ${count.total.toLocaleString()} ${noun}.`;
}

/**
 * What the window means, for the section's help entry: what it filters by, and
 * what is drawn behind the range when there is nothing to draw. Mount it only when the control is shown.
 */
export function TimeWindowHelp({
  activity,
  subject,
}: {
  activity: ActivitySeries | null;
  subject: WindowSubject;
}) {
  return (
    <p>
      {SUBJECT_NOTE[subject]}
      {!activity && " No match statistics are drawn behind the range."}
    </p>
  );
}

const sameWindow = (a: TimeWindow | null, b: TimeWindow) =>
  a !== null && a.startSec === b.startSec && a.endSec === b.endSec;

/**
 * A range over match time under the replay's map, with the match's busiest
 * moments drawn behind it so a reader can drag to the fight.
 *
 * `window` is the committed window and `null` is the whole match. Dragging
 * moves the thumbs at once and tells `onChange` at most once per animation
 * frame, and again straight away when the thumb is let go or a key is pressed.
 * `domainSec` is the whole seconds the range spans, the timeline's own domain.
 */
export function ReplayTimeWindowControl({
  domainSec,
  window,
  onChange,
  activity,
  count,
  noun = "orders",
  also,
  events = [],
  subject = "orders",
}: {
  domainSec: number;
  window: TimeWindow | null;
  onChange: (window: TimeWindow | null) => void;
  /** Drawn behind the range, or null for a plain track. */
  activity: ActivitySeries | null;
  /** Null while the layer's points are not known yet. */
  count: WindowCount | null;
  /** What the layer's points are called. */
  noun?: string;
  /** A second kind of point to count, when two layers with different points are on. */
  also?: { count: WindowCount | null; noun: string };
  /** The counts of layers drawn from events, each stated apart from the
   *  orders because an event and an order are different things to count. */
  events?: { noun: string; inside: number; total: number }[];
  /** Which kinds of layer are on. Default orders. */
  subject?: WindowSubject;
}) {
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const latest = useRef<[number, number] | null>(null);
  const frame = useRef<number | null>(null);
  // What was last reported, so the change Radix announces after the commit it
  // has just made is not reported a second time.
  const settled = useRef<string | null>(null);
  const live = useRef({ onChange, domainSec });
  live.current = { onChange, domainSec };

  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const value = latest.current;
    latest.current = null;
    if (!value) return;
    settled.current = String(value);
    live.current.onChange(toWindow(value[0], value[1], live.current.domainSec));
    setDraft(null);
  };
  // The announcement it guards against comes before the render this follows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the window changes
  useEffect(() => {
    settled.current = null;
  }, [window]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  if (!(domainSec > 0)) return null;

  const shown: [number, number] = draft ?? [
    window?.startSec ?? 0,
    window?.endSec ?? domainSec,
  ];
  const narrowed = shown[0] > 0 || shown[1] < domainSec;
  const path = activity ? activityPath(activity.points, domainSec) : null;
  const presets = windowPresets(domainSec);

  return (
    <div className="flex flex-col gap-1.5" data-testid="time-window">
      <span className="text-xs font-medium">Time window</span>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={window === null}
          onClick={() => onChange(null)}
        >
          Whole match
        </Button>
        {presets.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="sm"
            aria-pressed={sameWindow(window, preset.window)}
            onClick={() => onChange(preset.window)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset is a native form element, which this app does not use */}
      <div role="group" aria-label="Match time window">
        <div className="relative">
          {path && (
            <svg
              aria-hidden="true"
              data-testid="time-window-activity"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="mx-2 block h-10 w-[calc(100%-1rem)] fill-primary/30"
            >
              <path d={path} />
            </svg>
          )}
          <Slider
            min={0}
            max={domainSec}
            step={1}
            minStepsBetweenThumbs={1}
            value={shown}
            onValueChange={(value) => {
              if (String(value) === settled.current) return;
              settled.current = null;
              latest.current = [value[0], value[1]];
              setDraft([value[0], value[1]]);
              if (frame.current === null)
                frame.current = requestAnimationFrame(flush);
            }}
            onValueCommit={(value) => {
              // A key commits before it announces the change.
              latest.current = [value[0], value[1]];
              flush();
            }}
          />
        </div>
        {/* The thumbs travel the track less half a thumb at each end, and so
         * does this. */}
        <div
          aria-hidden="true"
          className="relative mx-2 mt-1 h-4 text-[10px] text-muted-foreground"
        >
          {axisTicks(domainSec).map((tick) => (
            <span
              key={tick}
              className="absolute -translate-x-1/2 tabular-nums"
              style={{ left: `${(tick / domainSec) * 100}%` }}
            >
              {axisTime(tick)}
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {narrowed
          ? `${SUBJECT_TEXT[subject]} from ${axisTime(shown[0])} to ${axisTime(shown[1])}.`
          : `The whole match, ${axisTime(0)} to ${axisTime(domainSec)}.`}
        {count && ` ${countText(count, noun)}`}
        {also?.count && ` ${countText(also.count, also.noun)}`}
        {events.map((e) => ` ${countText(e, e.noun)}`)}
      </p>
      {activity && (
        <p className="text-xs text-muted-foreground">
          {`Behind the range, ${activity.label.toLowerCase()} across all teams.`}
        </p>
      )}
    </div>
  );
}
