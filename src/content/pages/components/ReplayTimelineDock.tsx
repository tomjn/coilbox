import type { MessageDescriptor } from "@lingui/core";
import { msg, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import {
  ChevronsDown,
  ChevronsUp,
  Pause,
  Play,
  Rewind,
  SkipBack,
} from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/format";
import { isProfileHidden } from "../../../profile/hidden";
import type { DemoInfo } from "../../bindings";
import {
  DOCK_MAX_HEIGHT,
  type DockLane,
  fittingLanes,
} from "../../replayDockRows";
import type { ReplayWatch } from "../../replayEngine";
import type { ReplayClock } from "../../replayMapView/clock";
import { type Playback, SPEEDS } from "../../replayMapView/playback";
import {
  actionFor,
  type TimelineAction,
} from "../../replayMapView/timelineKeys";
import {
  groupMarks,
  type MarkGroup,
  type MarkLane,
  stepToMark,
} from "../../replayMapView/timelineMarks";
import { axisTicks, type MarkKind } from "../../replayTimeline";
import {
  type MatchRange,
  useMatchClock,
  useMatchFrame,
  usePlaybackState,
  useSettledFrame,
} from "../../useMatchClock";
import {
  type KillsLane,
  useReplayTimelineMarks,
} from "../../useReplayTimelineMarks";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { OpenInEngineButton } from "./OpenInEngineButton";
import {
  HeatWindowLabel,
  HeatWindowPlot,
  useHeatWindowLane,
} from "./ReplayHeatWindow";
import {
  MetricLaneLabel,
  MetricLanePlot,
  useMetricLane,
} from "./ReplayMetricLane";

/**
 * Width of a column of the axis in CSS pixels, which is the width of a mark.
 * A design choice, not a measurement: marks closer together than this would
 * touch, so they are drawn as one with a count.
 */
const COLUMN_PX = 8;

/** Where the lanes' edges are held, which lets the knob's centre line up with a
 *  mark. The knob is this wide, and the slider keeps its centre this far in. */
const KNOB_PX = 16;

/**
 * The lanes, top to bottom. To add one: add its name here, give `PlacedMark`
 * its lane in `timelineMarks.ts`, say what its marks are in `groupWords` and
 * draw them in `Glyph`. A lane with something else to say in place of marks, as
 * the Kills lane does when there is no analysis, takes it in `LaneNote`.
 */
const LANES = [
  { lane: "kills", name: msg`Kills` },
  { lane: "chat", name: msg`Chat` },
  { lane: "players", name: msg`Players` },
] as const satisfies readonly { lane: MarkLane; name: MessageDescriptor }[];

/** The time into the match a frame is, as a clock. */
const matchTime = (range: MatchRange, frame: number) =>
  formatDuration(Math.max(0, frame - range.firstFrame) / range.framesPerSecond);

/** Whether a key press belongs to the control it landed on, which keeps it. */
function ownedByTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("input, textarea, select, [role=textbox]")) return true;
  // An open list or dialog, which React hears through its portal.
  if (target.closest("[role=listbox], [role=menu], [role=dialog]")) return true;
  // A button or a select acts on Space, and a slider thumb on the arrows.
  if (key === " " && target.closest("button, a, [role=combobox]")) return true;
  return false;
}

/**
 * Does what a key of the table asks. A match with no recording has nothing
 * that animates, so the keys that play it and set its speed do nothing there.
 */
export function performAction(
  action: TimelineAction,
  {
    playback,
    clock,
    range,
    groups,
  }: {
    playback: Playback;
    clock: ReplayClock;
    range: MatchRange;
    groups: readonly MarkGroup[];
  },
): void {
  const animates = range.source === "track";
  switch (action.type) {
    case "toggle":
      if (!animates) return;
      if (playback.getSnapshot().playing) playback.pause();
      else playback.play();
      return;
    case "reverse":
      if (animates) playback.reverse();
      return;
    case "step":
      playback.step(action.seconds * range.framesPerSecond);
      return;
    case "frame":
      playback.step(action.frames);
      return;
    case "start":
      playback.seek(range.firstFrame);
      return;
    case "end":
      playback.seek(range.lastFrame);
      return;
    case "mark": {
      const frame = stepToMark(groups, clock.frame, action.direction);
      if (frame !== null) playback.seek(frame);
      return;
    }
    case "faster":
      if (animates) playback.faster();
      return;
    case "slower":
      if (animates) playback.slower();
      return;
  }
}

/**
 * The key handler for the timeline: the table's keys, for a key press that
 * lands anywhere inside the map or the dock, except where the control it landed
 * on keeps the key. A press the table does not name is left alone.
 */
export function timelineKeyHandler(run: (action: TimelineAction) => void) {
  return (event: KeyboardEvent) => {
    // The knob handles its own keys first and marks the event handled.
    if (event.defaultPrevented) return;
    const action = actionFor(event);
    if (!action || ownedByTarget(event.target, event.key)) return;
    event.preventDefault();
    run(action);
  };
}

interface TimelineKeys {
  /** Written by the dock with the marks it draws, for the keys that go to the
   *  next mark. */
  groupsRef: MutableRefObject<readonly MarkGroup[]>;
  onKeyDown: (event: KeyboardEvent) => void;
}

const TimelineKeysContext = createContext<TimelineKeys | null>(null);

/**
 * Gives the map and the dock one set of keys, so a key does the same from
 * either. The dock draws the marks the keys step through and the map sits
 * elsewhere on the page, which is why they meet here. Inside a
 * `MatchClockProvider`.
 */
export function TimelineKeysProvider({ children }: { children: ReactNode }) {
  const { clock, playback, range } = useMatchClock();
  const groupsRef = useRef<readonly MarkGroup[]>([]);
  const value = useMemo<TimelineKeys>(
    () => ({
      groupsRef,
      onKeyDown: timelineKeyHandler((action) =>
        performAction(action, {
          playback,
          clock,
          range,
          groups: groupsRef.current,
        }),
      ),
    }),
    [playback, clock, range],
  );
  return (
    <TimelineKeysContext.Provider value={value}>
      {children}
    </TimelineKeysContext.Provider>
  );
}

/** The timeline's keys, or null where the page has none. */
export function useTimelineKeys(): TimelineKeys | null {
  return useContext(TimelineKeysContext);
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The match time and the length of the match. Renders as time moves, and
 *  nothing else does with it. */
function ClockText({ range }: { range: MatchRange }) {
  const frame = useMatchFrame();
  return (
    <span
      data-testid="match-clock"
      className="shrink-0 text-xs tabular-nums text-muted-foreground"
    >
      <span className="text-foreground">{matchTime(range, frame)}</span>
      {" / "}
      {matchTime(range, range.lastFrame)}
    </span>
  );
}

/** Read when the dock draws, so they follow the app language. */
function chatKindLabel(kind: string | undefined): string {
  switch (kind as MarkKind | undefined) {
    case "allies":
      return t`Allies`;
    case "spectators":
      return t`Spectators`;
    case "whisper":
      return t`Whispers`;
    case "system":
      return t`System`;
    default:
      return t`Everyone`;
  }
}

/** What a group of marks is, in words, for a reader and for a screen reader. */
function groupWords(range: MatchRange, group: MarkGroup): string {
  const when = group.before
    ? t`before the game`
    : matchTime(range, group.frame);
  const n = group.count;
  const text = group.text;
  switch (group.lane) {
    case "kills":
      return n === 1
        ? t`Unit destroyed, ${when}`
        : t`${n} units destroyed from ${when}`;
    case "chat": {
      if (n === 1 && text) {
        const kind = chatKindLabel(group.kind);
        return t`${kind}, ${when}: ${text}`;
      }
      return plural(n, {
        one: `# chat line from ${when}`,
        other: `# chat lines from ${when}`,
      });
    }
    case "players":
      return n === 1 && text
        ? t`${text}, ${when}`
        : plural(n, {
            one: `# player event from ${when}`,
            other: `# player events from ${when}`,
          });
  }
}

/** The colour of a chat dot, by who the line was sent to. */
const CHAT_DOT: Record<string, string> = {
  allies: "bg-emerald-600 dark:bg-emerald-400",
  spectators: "bg-sky-600 dark:bg-sky-400",
  whisper: "bg-violet-600 dark:bg-violet-400",
  system: "border border-foreground/70",
};

/**
 * What a mark looks like. Each lane has its own shape, and chat lines are told
 * apart by colour as well, so none rests on colour alone: what a mark is, is
 * also said in words when it is pointed at.
 */
function Glyph({ group }: { group: MarkGroup }) {
  const many = group.count > 1;
  switch (group.lane) {
    case "kills":
      return (
        <span
          aria-hidden
          className={`block w-0.5 rounded-full bg-destructive ${many ? "h-3" : "h-2"}`}
        />
      );
    case "chat":
      return (
        <span
          aria-hidden
          className={`block rounded-full ${many ? "size-2.5" : "size-1.5"} ${
            (group.kind && CHAT_DOT[group.kind]) || "bg-foreground/70"
          }`}
        />
      );
    case "players":
      return (
        <span
          aria-hidden
          className={`block rotate-45 bg-foreground/70 ${many ? "size-2.5" : "size-1.5"}`}
        />
      );
  }
}

/** What a lane says in place of marks it cannot have, or null. */
function laneNote(
  lane: MarkLane,
  kills: KillsLane,
): {
  words: string;
  reason: string | null;
} | null {
  if (lane !== "kills") return null;
  switch (kills.status) {
    case "needsAnalysis":
      return { words: t`Needs analysis`, reason: kills.reason };
    case "unreadable":
      return { words: t`Could not read`, reason: null };
    case "ready":
      return null;
  }
}

/** The line across the scrubber and every lane, at the match time. Renders as
 *  time moves, and nothing else does with it. */
function Playhead({ range }: { range: MatchRange }) {
  const frame = useMatchFrame();
  const length = range.lastFrame - range.firstFrame;
  const at =
    length > 0
      ? Math.min(1, Math.max(0, (frame - range.firstFrame) / length))
      : 0;
  return (
    <span
      aria-hidden
      data-testid="playhead"
      className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 rounded-full bg-primary"
      style={{ left: `${at * 100}%` }}
    />
  );
}

/**
 * The knob and its track. Built from the Radix slider the registry's `Slider`
 * wraps, because that wrapper puts its `aria-label` on the root and leaves the
 * knob without a name, and a screen reader lands on the knob.
 *
 * The root is a knob's width wider than the lanes, half on each side, because
 * the slider keeps the knob's edge and not its centre inside the root. That puts
 * the centre of the knob where the playhead is.
 */
function Knob({
  range,
  onKeyDown,
}: {
  range: MatchRange;
  onKeyDown?: (event: KeyboardEvent) => void;
}) {
  const { t: tr } = useLingui();
  const { playback } = useMatchClock();
  const frame = useMatchFrame();
  const empty = range.lastFrame <= range.firstFrame;
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      // rtl: spatial. Time runs left to right in every language.
      dir="ltr"
      className="relative flex h-5 touch-none select-none items-center"
      style={{
        width: `calc(100% + ${KNOB_PX}px)`,
        marginInline: `-${KNOB_PX / 2}px`,
      }}
      min={range.firstFrame}
      max={empty ? range.firstFrame + 1 : range.lastFrame}
      step={1}
      disabled={empty}
      value={[frame]}
      onKeyDown={onKeyDown}
      onValueChange={([next]) => {
        // Each pointer move reaches the clock before it returns, so the map
        // follows the pointer. Dragging stops a match that is playing.
        playback.seek(next, { settle: false, pause: true });
      }}
      onValueCommit={() => playback.settle()}
    >
      <SliderPrimitive.Track
        className="relative h-1.5 grow overflow-hidden rounded-full bg-muted"
        style={{ marginInline: KNOB_PX / 2 }}
      >
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={tr`Time in the match`}
        aria-valuetext={matchTime(range, frame)}
        className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
      />
    </SliderPrimitive.Root>
  );
}

/** Go to start, rewind, play and the speed. Only a match with a recording has
 *  them. Play is the primary control and the rest are quieter. */
function Transport() {
  const { t: tr } = useLingui();
  const { playback, range } = useMatchClock();
  const state = usePlaybackState();
  const playingForward = state.playing && state.direction === 1;
  const playingBack = state.playing && state.direction === -1;
  return (
    <div className="flex items-center gap-1">
      <Tip label={tr`Go to start`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={tr`Go to start`}
          onClick={() => playback.seek(range.firstFrame)}
        >
          <SkipBack className="size-4" />
        </Button>
      </Tip>
      <Tip label={playingBack ? tr`Pause` : tr`Play in reverse`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={playingBack ? tr`Pause` : tr`Play in reverse`}
          onClick={() => (playingBack ? playback.pause() : playback.play(-1))}
        >
          {playingBack ? (
            <Pause className="size-4" />
          ) : (
            <Rewind className="size-4" />
          )}
        </Button>
      </Tip>
      <Tip label={playingForward ? tr`Pause` : tr`Play`}>
        <Button
          type="button"
          size="icon"
          className="size-8 rounded-full"
          aria-label={playingForward ? tr`Pause` : tr`Play`}
          onClick={() => (playingForward ? playback.pause() : playback.play(1))}
        >
          {playingForward ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </Button>
      </Tip>
      <SpeedSelect />
    </div>
  );
}

function SpeedSelect() {
  const { t: tr } = useLingui();
  const { playback } = useMatchClock();
  const state = usePlaybackState();
  return (
    <div className="w-20 shrink-0">
      <OptionSelect
        size="sm"
        ariaLabel={tr`Playback speed`}
        value={String(state.speed)}
        onValueChange={(next) => playback.setSpeed(Number(next))}
        options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
      />
    </div>
  );
}

/** The height of the window, which the dock takes its share of. */
function useWindowHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return height;
}

/** The mark the pointer or focus is on, which a lane puts in the readout. */
interface Pointed {
  lane: MarkLane;
  column: number;
}

/**
 * The page's timeline dock (#5306), pinned to the bottom of the page: a
 * transport row, the scrubber, a lane each for kills, chat and players, a metric
 * lane, and a time axis, all on one axis with one playhead line across them.
 * Pressing a mark moves the match to it, through the page's match clock. The
 * metric lane draws the metric the statistics chart has picked (#5308), and has
 * the chart's list of metrics behind its label. A replay with no statistics has
 * no metric lane. The Heat window lane under it (#5309) holds a box that is
 * dragged over the stretch of the match the map's layers add up, with the
 * presets behind its label. It shows in every mode of the map, and in Units
 * mode, where no layer reads it, it keeps the window for the next mode. A
 * replay with no statistics has the lane and no shading.
 *
 * The axis is the clock's range, which is the replay's duration until a
 * recorded track is opened and the track's after. A replay with no recording
 * has the scrubber and the lanes, and nothing that plays or sets a speed,
 * because nothing on the page animates.
 *
 * Only the knob, the playhead and the time follow the clock as it moves. The
 * lanes and the readout move when the time settles.
 */
export function ReplayTimelineDock({
  info,
  replayPath,
  watch,
  dependencyBlock,
  game,
  showStats,
}: {
  info: DemoInfo;
  /** The replay file, whose chat and players are marks on the lanes. */
  replayPath: string;
  /** Whether the profile shows match statistics, which the metric lane draws. */
  showStats: boolean;
  /** The page's engine decision, for the button that opens the engine. */
  watch: ReplayWatch;
  /** `replayDependencyBlock`: why the replay's game cannot run, or null. */
  dependencyBlock: string | null;
  /** Another installed version of the replay's game, when its own is missing. */
  game?: string;
}) {
  const { t: tr, i18n } = useLingui();
  const { clock, playback, range } = useMatchClock();
  const keys = useTimelineKeys();
  const emphasis = useSeriesEmphasis();
  const settled = useSettledFrame();
  const { marks, kills } = useReplayTimelineMarks(info, replayPath);
  const animates = range.source === "track";
  const totalSec = (range.lastFrame - range.firstFrame) / range.framesPerSecond;
  // Null with no statistics, and then there is no metric lane.
  const metricLane = useMetricLane(
    info,
    showStats ? replayPath : null,
    totalSec,
  );
  // The stretch the map's layers add up. It goes with the layers when a profile
  // hides them, and its shading goes with the statistics.
  const heatWindow = useHeatWindowLane(
    info,
    showStats ? replayPath : null,
    totalSec,
  );
  const heatPresent =
    heatWindow !== null && !isProfileHidden("analytics.spatialLayers");

  // The dock takes a share of the window's height and no more. In a window too
  // short for every lane the last lanes fold away, and the button in the
  // transport row opens them again inside the same cap, scrolling.
  const windowHeight = useWindowHeight();
  const [opened, setOpened] = useState(false);
  const present = useMemo<DockLane[]>(
    () => [
      "kills",
      "chat",
      "players",
      ...(metricLane ? (["metric"] as const) : []),
      ...(heatPresent ? (["heat"] as const) : []),
    ],
    [metricLane, heatPresent],
  );
  const fitting = fittingLanes(windowHeight, present);
  const folded = fitting.length < present.length;
  const shows = (lane: DockLane) => opened || fitting.includes(lane);
  const heatShown = heatPresent && shows("heat");
  const metricShown = metricLane !== null && shows("metric");

  const labelId = useId();
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(0);
  useLayoutEffect(() => {
    const lanes = lanesRef.current;
    if (!lanes) return;
    const measure = () =>
      setColumns(Math.floor(lanes.getBoundingClientRect().width / COLUMN_PX));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(lanes);
    return () => watcher.disconnect();
  }, []);

  // A press on blank space in a row moves the match to that time. Anything
  // that does something with a press of its own keeps it.
  const seekFromRow = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "button, [role=slider], [data-slot=slider], [data-testid=heat-window-box]",
      )
    ) {
      return;
    }
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (!(width > 0)) return;
    const share = Math.min(1, Math.max(0, (event.clientX - left) / width));
    playback.seek(
      Math.round(
        range.firstFrame + share * (range.lastFrame - range.firstFrame),
      ),
    );
  };

  const axis = useMemo(
    () => ({ first: range.firstFrame, last: range.lastFrame }),
    [range.firstFrame, range.lastFrame],
  );
  const groups = useMemo(
    () => groupMarks(marks, axis, columns),
    [marks, axis, columns],
  );
  const groupsRef = keys?.groupsRef;
  if (groupsRef) groupsRef.current = groups;

  const [pointed, setPointed] = useState<Pointed | null>(null);
  // What the pointer or focus is on, or else the mark the match is at, which is
  // where a key or a press on a mark has just moved it. The start of the match
  // says nothing, so a page that opens there opens with a quiet readout.
  const reading =
    (pointed &&
      groups.find(
        (g) => g.lane === pointed.lane && g.column === pointed.column,
      )) ||
    (settled > range.firstFrame
      ? groups.find((g) => g.frame === settled)
      : undefined);

  const ticks = axisTicks(totalSec);
  const shownLanes = LANES.filter(({ lane }) => shows(lane));

  return (
    <TooltipProvider delayDuration={300}>
      {/* biome-ignore lint/a11y/useSemanticElements: a box that holds the transport, the scrubber and the lanes, which a fieldset would restyle. */}
      <div
        role="group"
        aria-label={tr`Timeline`}
        // rtl: spatial. Time runs left to right in every language.
        dir="ltr"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: where keyboard focus lands to use the timeline's keys on the scrubber and the lanes together.
        tabIndex={0}
        onKeyDown={keys?.onKeyDown}
        style={{ maxHeight: DOCK_MAX_HEIGHT }}
        className="sticky bottom-0 z-20 flex shrink-0 flex-col gap-1.5 border-t border-border bg-background/95 px-4 py-2 outline-none backdrop-blur focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex min-h-7 shrink-0 items-center gap-2">
          {animates && <Transport />}
          <ClockText range={range} />
          <p
            aria-live="polite"
            data-testid="timeline-readout"
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
          >
            {reading ? groupWords(range, reading) : ""}
          </p>
          {folded && (
            <Tip
              label={opened ? tr`Fold the extra lanes` : tr`Show every lane`}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={
                  opened ? tr`Fold the extra lanes` : tr`Show every lane`
                }
                aria-expanded={opened}
                onClick={() => setOpened((was) => !was)}
              >
                {opened ? (
                  <ChevronsDown className="size-4" />
                ) : (
                  <ChevronsUp className="size-4" />
                )}
              </Button>
            </Tip>
          )}
          <OpenInEngineButton
            replayPath={replayPath}
            engineVersion={info.engineVersion}
            watch={watch}
            dependencyBlock={dependencyBlock}
            game={game}
            clock={clock}
          />
        </div>
        {/* Scrolls when the lanes are opened past the dock's cap. The side
         * padding holds what reaches past the lanes: the knob, the Heat
         * window's ends and the last tick of the axis. The axis ticks are one
         * line of 12px, so they fit the 15px under the axis border. */}
        <div className="-mx-4 flex min-h-0 gap-2 overflow-y-auto px-4 text-xs">
          <div className="flex w-24 shrink-0 flex-col text-muted-foreground [&>*]:shrink-0">
            <span className="h-5" />
            {shownLanes.map(({ lane, name }) => (
              <span
                key={lane}
                id={`${labelId}-${lane}`}
                className="flex h-5 items-center"
              >
                {i18n._(name)}
              </span>
            ))}
            {metricShown && (
              <div className="h-12">
                <MetricLaneLabel lane={metricLane} id={`${labelId}-metric`} />
              </div>
            )}
            {heatShown && (
              <div className="h-8">
                <HeatWindowLabel lane={heatWindow} id={`${labelId}-heat`} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {/* The scrubber and the lanes, which the playhead crosses. It is
             * also what the columns are measured from. */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a press on blank space in a row is a pointer shortcut. The scrubber and the keys do the same from the keyboard. */}
            <div ref={lanesRef} className="relative" onClick={seekFromRow}>
              <div className="h-5">
                <Knob range={range} onKeyDown={keys?.onKeyDown} />
              </div>
              {shownLanes.map(({ lane }) => {
                const row = groups.filter((g) => g.lane === lane);
                const note = laneNote(lane, kills);
                return (
                  // biome-ignore lint/a11y/useSemanticElements: a row of buttons laid out on the axis, which a fieldset's box would not allow.
                  <div
                    key={lane}
                    role="group"
                    aria-labelledby={`${labelId}-${lane}`}
                    className="relative h-5"
                  >
                    {note && (
                      <span
                        title={note.reason ?? undefined}
                        className="absolute inset-y-0 start-0 flex items-center ps-2 text-muted-foreground"
                      >
                        {note.words}
                      </span>
                    )}
                    {row.map((group) => {
                      // A chat mark stands for the teams of whoever spoke in
                      // it, and lights and dims with them as a roster row does.
                      // Only teams with a line can be pointed at.
                      const shown = group.teams.filter((team) =>
                        emphasis.isShown(team),
                      );
                      const lit = shown.length > 0 && emphasis.isLit(shown);
                      const faded =
                        group.teams.length > 0 && emphasis.dimming && !lit;
                      const point =
                        shown.length > 0 ? emphasis.pointTo(shown) : undefined;
                      const focus =
                        shown.length > 0 ? emphasis.focusOn(shown) : undefined;
                      return (
                        <button
                          key={group.column}
                          type="button"
                          // Reached from the keyboard with [ and ], which keeps
                          // a match with a mark in every column from being a
                          // hundred tab stops.
                          tabIndex={-1}
                          aria-label={groupWords(range, group)}
                          title={groupWords(range, group)}
                          data-emphasised={
                            group.teams.length > 0 ? lit : undefined
                          }
                          onClick={() => playback.seek(group.frame)}
                          onPointerEnter={(ev) => {
                            setPointed({ lane, column: group.column });
                            point?.onPointerEnter(ev);
                          }}
                          onPointerLeave={() => {
                            setPointed(null);
                            point?.onPointerLeave();
                          }}
                          onFocus={(ev) => {
                            setPointed({ lane, column: group.column });
                            focus?.onFocus(ev);
                          }}
                          onBlur={() => {
                            setPointed(null);
                            focus?.onBlur();
                          }}
                          className={`absolute inset-y-0 flex items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${
                            lit
                              ? "bg-accent/60 ring-2 ring-ring/40 ring-inset"
                              : ""
                          } ${faded ? "opacity-40" : ""}`}
                          style={{
                            left: `${((group.column + 0.5) / columns) * 100}%`,
                            width: `${100 / columns}%`,
                            transform: "translateX(-50%)",
                          }}
                        >
                          <Glyph group={group} />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {/* Not made of marks, so it is a sibling of the rows above and
               * not one of them. It is the one lane taller than a line of
               * text, because a line chart needs the height to be read. */}
              {metricShown && (
                // biome-ignore lint/a11y/useSemanticElements: a box the chart is drawn in, which a fieldset's box would not allow.
                <div
                  role="group"
                  aria-labelledby={`${labelId}-metric`}
                  data-testid="metric-lane"
                  className="relative h-12 border-t border-border/40"
                >
                  <MetricLanePlot lane={metricLane} />
                </div>
              )}
              {/* Also not made of marks. Its box is what the map's layers add
               * up, and is dragged on this axis. */}
              {heatShown && (
                <HeatWindowPlot lane={heatWindow} labelId={`${labelId}-heat`} />
              )}
              <Playhead range={range} />
            </div>
            <div
              data-testid="timeline-axis"
              className="relative h-4 border-t border-border/60 text-muted-foreground"
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute top-0.5 -translate-x-1/2 text-xs leading-3 tabular-nums first:translate-x-0"
                  style={{
                    left: `${totalSec > 0 ? (tick / totalSec) * 100 : 0}%`,
                  }}
                >
                  {formatDuration(tick)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
