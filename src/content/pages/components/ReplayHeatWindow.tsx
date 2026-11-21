import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDuration } from "@/lib/format";
import type { DemoInfo } from "../../bindings";
import {
  type ActivitySeries,
  activityPath,
  activitySeries,
  dragWindow,
  heldWindow,
  keyedWindow,
  type TimeWindow,
  toWindow,
  type WindowPart,
  type WindowPreset,
  windowPresets,
} from "../../replayTimeWindow";
import { useMatchStats } from "../../useMatchStats";
import { useTimeWindowStore } from "../../useSeriesEmphasis";

/**
 * The timeline dock's Heat window lane (#5309): a box over the stretch of the
 * match the map's layers add up, with the match's busiest moments shaded behind
 * it. It replaces the "Time window" control that sat under the map.
 *
 * The lane has two parts, because the dock puts a lane's name in one column and
 * its row in another. {@link useHeatWindowLane} works out what both draw from,
 * and {@link HeatWindowLabel} and {@link HeatWindowPlot} draw it. The window
 * itself is kept in the page's store, which the map's layers read.
 */
export interface HeatWindowLane {
  /** The length of the dock's axis, in seconds. */
  totalSec: number;
  /** The whole seconds the window can span: the axis, rounded up. */
  domainSec: number;
  /** The window as the layers have it, or null for the whole match. */
  window: TimeWindow | null;
  /** Drawn behind the box, or null for a plain lane. */
  activity: ActivitySeries | null;
  presets: WindowPreset[];
  /** Sets the window to the seconds between these two ends. */
  set(startSec: number, endSec: number): void;
  /** Sets the window to a preset's, or to the whole match with null. */
  choose(window: TimeWindow | null): void;
}

/**
 * The lane's data, or null when there is no lane because the axis has no
 * length. `statsPath` is the replay whose statistics are shaded behind the box,
 * or null when the profile hides them.
 */
export function useHeatWindowLane(
  info: DemoInfo,
  statsPath: string | null,
  totalSec: number,
): HeatWindowLane | null {
  const store = useTimeWindowStore();
  const held = useSyncExternalStore(store.subscribe, store.getState);
  const { data } = useMatchStats(statsPath);
  const activity = useMemo(
    () => activitySeries(data?.trailer ?? null, info, data?.metrics ?? []),
    [data, info],
  );
  const domainSec = Math.ceil(totalSec);
  const window = useMemo(
    () => (held ? toWindow(held.startSec, held.endSec, domainSec) : null),
    [held, domainSec],
  );
  const presets = useMemo(() => windowPresets(domainSec), [domainSec]);
  const set = useCallback(
    (startSec: number, endSec: number) =>
      store.set(heldWindow(startSec, endSec, domainSec)),
    [store, domainSec],
  );
  const choose = useCallback(
    (next: TimeWindow | null) =>
      store.set(next && heldWindow(next.startSec, next.endSec, domainSec)),
    [store, domainSec],
  );
  return useMemo(
    () =>
      domainSec > 0
        ? { totalSec, domainSec, window, activity, presets, set, choose }
        : null,
    [totalSec, domainSec, window, activity, presets, set, choose],
  );
}

const sameWindow = (a: TimeWindow | null, b: TimeWindow) =>
  a !== null && a.startSec === b.startSec && a.endSec === b.endSec;

/**
 * The lane's name, and the way to pick a preset: pressing it opens the whole
 * match, the first five minutes and the last five minutes.
 */
export function HeatWindowLabel({
  lane,
  id,
}: {
  lane: HeatWindowLane;
  id: string;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const pick = (next: TimeWindow | null) => {
    lane.choose(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="ghost"
          className="h-full w-full justify-start px-0 text-left text-xs font-normal whitespace-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          {t`Heat window`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto flex-col gap-1 p-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={lane.window === null}
          onClick={() => pick(null)}
        >
          {t`Whole match`}
        </Button>
        {lane.presets.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={sameWindow(lane.window, preset.window)}
            onClick={() => pick(preset.window)}
          >
            {preset.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** What a drag started from: which part, where the pointer was, how wide the
 *  lane was in pixels, and the ends the box had. */
interface Drag {
  part: WindowPart;
  x: number;
  width: number;
  from: [number, number];
}

/** A time as its share of the lane's width, held inside the lane. */
const share = (sec: number, totalSec: number) =>
  `${Math.min(1, sec / totalSec) * 100}%`;

/**
 * The lane's row, across the dock's axis: the shading, and the box. Dragging an
 * end changes that end and dragging the middle slides the box. Each end is a
 * slider a key reaches with Tab and moves with the arrows.
 *
 * A drag moves the box at once and tells the window at most once per animation
 * frame, and again when the pointer is let go, because every change rebuilds
 * the map's layers.
 */
export function HeatWindowPlot({
  lane,
  labelId,
}: {
  lane: HeatWindowLane;
  labelId: string;
}) {
  const { t } = useLingui();
  const { totalSec, domainSec, activity } = lane;
  const laneRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const latest = useRef<[number, number] | null>(null);
  const frame = useRef<number | null>(null);
  const live = useRef(lane);
  live.current = lane;

  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const value = latest.current;
    latest.current = null;
    if (!value) return;
    live.current.set(value[0], value[1]);
    setDraft(null);
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const shown: [number, number] = draft ?? [
    lane.window?.startSec ?? 0,
    lane.window?.endSec ?? domainSec,
  ];
  const path = useMemo(
    () => (activity ? activityPath(activity.points, totalSec) : null),
    [activity, totalSec],
  );
  const activityLabel = activity?.label.toLowerCase();

  const grab = (part: WindowPart) => ({
    onPointerDown(ev: PointerEvent<HTMLElement>) {
      // Only the primary button drags.
      if (ev.button > 0) return;
      const width = laneRef.current?.getBoundingClientRect().width ?? 0;
      if (!(width > 0)) return;
      // An end sits inside the box, which would start a slide.
      ev.stopPropagation();
      drag.current = { part, x: ev.clientX, width, from: [shown[0], shown[1]] };
      try {
        // So the drag goes on when the pointer leaves the box.
        ev.currentTarget.setPointerCapture?.(ev.pointerId);
      } catch {
        // A pointer the browser no longer has. The drag still follows the
        // pointer while it is over the box.
      }
    },
    onPointerMove(ev: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      const next = dragWindow(
        d.part,
        d.from,
        ((ev.clientX - d.x) / d.width) * totalSec,
        { domainSec, totalSec },
      );
      latest.current = next;
      setDraft(next);
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    onPointerUp() {
      if (!drag.current) return;
      drag.current = null;
      flush();
    },
    onPointerCancel() {
      if (!drag.current) return;
      drag.current = null;
      flush();
    },
  });

  const key = (part: "start" | "end") => (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const next = keyedWindow(part, shown, ev.key, ev.shiftKey, domainSec);
    if (!next) return;
    // Marks the key as handled, which the dock's own keys leave alone.
    ev.preventDefault();
    lane.set(next[0], next[1]);
  };

  const left = share(shown[0], totalSec);
  const width = `${(Math.min(1, shown[1] / totalSec) - Math.min(1, shown[0] / totalSec)) * 100}%`;
  const handle =
    "group absolute inset-y-0 z-10 flex w-6 cursor-ew-resize items-center justify-center outline-none";
  const pill =
    "h-4 w-1 rounded-full bg-primary group-focus-visible:ring-2 group-focus-visible:ring-ring group-hover:ring-2 group-hover:ring-ring/50";

  return (
    // biome-ignore lint/a11y/useSemanticElements: a box the shading and the window are drawn in, which a fieldset's box would not allow.
    <div
      ref={laneRef}
      role="group"
      aria-labelledby={labelId}
      data-testid="heat-window-lane"
      title={activity ? t`Shaded: ${activityLabel}` : undefined}
      className="relative h-8 touch-none select-none border-t border-border/40"
    >
      {path && (
        <svg
          aria-hidden="true"
          data-testid="heat-window-activity"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full fill-primary/30"
        >
          <path d={path} />
        </svg>
      )}
      <div
        data-testid="heat-window-box"
        className="absolute inset-y-0 cursor-grab border-x-2 border-primary bg-primary/10 active:cursor-grabbing"
        style={{ left, width }}
        {...grab("move")}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a slider on a box's edge, which a range input cannot be. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={t`Heat window start`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={shown[1] - 1}
          aria-valuenow={shown[0]}
          aria-valuetext={formatDuration(shown[0])}
          data-testid="heat-window-start"
          className={`${handle} -left-3`}
          onKeyDown={key("start")}
          {...grab("start")}
        >
          <span aria-hidden className={pill} />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a slider on a box's edge, which a range input cannot be. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={t`Heat window end`}
          aria-orientation="horizontal"
          aria-valuemin={shown[0] + 1}
          aria-valuemax={domainSec}
          aria-valuenow={shown[1]}
          aria-valuetext={formatDuration(Math.min(shown[1], totalSec))}
          data-testid="heat-window-end"
          className={`${handle} -right-3`}
          onKeyDown={key("end")}
          {...grab("end")}
        >
          <span aria-hidden className={pill} />
        </div>
      </div>
    </div>
  );
}
