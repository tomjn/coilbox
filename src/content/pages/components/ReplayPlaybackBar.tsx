import type { MessageDescriptor } from "@lingui/core";
import { msg, plural, t } from "@lingui/core/macro";
import { useLingui as useLocale } from "@lingui/react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, Pause, Play } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDuration } from "@/lib/format";
import type { ReplayTrackHeader } from "../../bindings";
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
  type PlacedMark,
  stepToMark,
} from "../../replayMapView/timelineMarks";

/**
 * Width of a column of the bar in CSS pixels, which is the width of a mark.
 * A design choice, not a measurement: marks closer together than this would
 * touch, so they are drawn as one with a count.
 */
const COLUMN_PX = 8;

const LANES = [
  { lane: "kills", name: msg`Kills` },
  { lane: "chat", name: msg`Chat` },
  { lane: "left", name: msg`Players leaving` },
] as const satisfies readonly { lane: MarkLane; name: MessageDescriptor }[];

const matchTime = (header: ReplayTrackHeader, frame: number) =>
  formatDuration(
    Math.max(0, frame - header.firstFrame) / header.framesPerSecond,
  );

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

/** Does what a key of the table asks. */
export function performAction(
  action: TimelineAction,
  {
    playback,
    clock,
    header,
    groups,
  }: {
    playback: Playback;
    clock: ReplayClock;
    header: ReplayTrackHeader;
    groups: readonly MarkGroup[];
  },
): void {
  switch (action.type) {
    case "toggle":
      if (playback.getSnapshot().playing) playback.pause();
      else playback.play();
      return;
    case "reverse":
      playback.reverse();
      return;
    case "step":
      playback.step(action.seconds * header.framesPerSecond);
      return;
    case "frame":
      playback.step(action.frames);
      return;
    case "start":
      playback.seek(header.firstFrame);
      return;
    case "end":
      playback.seek(header.lastFrame);
      return;
    case "mark": {
      const frame = stepToMark(groups, clock.frame, action.direction);
      if (frame !== null) playback.seek(frame);
      return;
    }
    case "faster":
      playback.faster();
      return;
    case "slower":
      playback.slower();
      return;
  }
}

/**
 * The key handler for the recorded match: the table's keys, for a key press
 * that lands anywhere inside the view, except where the control it landed on
 * keeps the key. A press the table does not name is left alone.
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
function ClockText({
  header,
  clock,
}: {
  header: ReplayTrackHeader;
  clock: ReplayClock;
}) {
  const frame = useSyncExternalStore(clock.subscribe, () => clock.frame);
  return (
    <span
      data-testid="match-clock"
      className="shrink-0 text-xs tabular-nums text-muted-foreground"
    >
      <span className="text-foreground">{matchTime(header, frame)}</span>
      {" / "}
      {matchTime(header, header.lastFrame)}
    </span>
  );
}

function groupWords(header: ReplayTrackHeader, group: MarkGroup): string {
  const at = matchTime(header, group.frame);
  const n = group.count;
  const text = group.text;
  switch (group.lane) {
    case "kills":
      return n === 1
        ? t`Unit destroyed, ${at}`
        : t`${n} units destroyed from ${at}`;
    case "chat":
      return n === 1 && text
        ? t`Chat, ${at}: ${text}`
        : plural(n, {
            one: `# chat line from ${at}`,
            other: `# chat lines from ${at}`,
          });
    case "left":
      return n === 1 && text
        ? t`${text}, ${at}`
        : plural(n, {
            one: `# player left from ${at}`,
            other: `# players left from ${at}`,
          });
  }
}

/** What a mark looks like. Each lane has its own shape, so none rests on colour. */
function Glyph({ lane, many }: { lane: MarkLane; many: boolean }) {
  switch (lane) {
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
          className={`block rounded-full bg-foreground/70 ${many ? "size-2.5" : "size-1.5"}`}
        />
      );
    case "left":
      return (
        <span
          aria-hidden
          className={`block rotate-45 bg-foreground/70 ${many ? "size-2.5" : "size-1.5"}`}
        />
      );
  }
}

/**
 * The timeline of the recorded match (#3808): play, reverse and a speed, a knob
 * to drag, and marks for the events the replay recorded. Clicking a mark moves
 * the match to it.
 *
 * The map view draws from the clock and never from this. Only the knob and the
 * time here follow the clock, and neither the page nor the map renders as time
 * moves.
 */
export function ReplayPlaybackBar({
  header,
  clock,
  playback,
  marks,
  groupsRef,
  loading,
  onKeyDown,
}: {
  header: ReplayTrackHeader;
  clock: ReplayClock;
  playback: Playback;
  marks: readonly PlacedMark[];
  /** Written with the groups drawn, for the keys that go to the next mark. */
  groupsRef: MutableRefObject<readonly MarkGroup[]>;
  /** Whether the picture is waiting for a part of the match to arrive. */
  loading: boolean;
  /** The table's keys. The knob runs it first, so a key of the table is not
   *  also the slider's own step. */
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  const { t: tr, i18n } = useLingui();
  const state = useSyncExternalStore(playback.subscribe, playback.getSnapshot);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(0);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () =>
      setColumns(Math.floor(bar.getBoundingClientRect().width / COLUMN_PX));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(bar);
    return () => watcher.disconnect();
  }, []);

  const range = useMemo(
    () => ({ first: header.firstFrame, last: header.lastFrame }),
    [header.firstFrame, header.lastFrame],
  );
  const groups = useMemo(
    () => groupMarks(marks, range, columns),
    [marks, range, columns],
  );
  groupsRef.current = groups;

  const playingForward = state.playing && state.direction === 1;
  const playingBack = state.playing && state.direction === -1;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <Tip label={playingBack ? tr`Pause` : tr`Play in reverse`}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={playingBack ? tr`Pause` : tr`Play in reverse`}
              onClick={() =>
                playingBack ? playback.pause() : playback.play(-1)
              }
            >
              {playingBack ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4 -scale-x-100" />
              )}
            </Button>
          </Tip>
          <Tip label={playingForward ? tr`Pause` : tr`Play`}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={playingForward ? tr`Pause` : tr`Play`}
              onClick={() =>
                playingForward ? playback.pause() : playback.play(1)
              }
            >
              {playingForward ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
          </Tip>
          <ClockText header={header} clock={clock} />
          {loading && (
            <Loader2
              aria-hidden
              className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
          )}
          <div className="ml-auto w-20">
            <OptionSelect
              size="sm"
              ariaLabel={tr`Playback speed`}
              value={String(state.speed)}
              onValueChange={(next) => playback.setSpeed(Number(next))}
              options={SPEEDS.map((s) => ({
                value: String(s),
                label: `${s}x`,
              }))}
            />
          </div>
        </div>
        <div ref={barRef} className="flex flex-col px-2">
          {LANES.map(({ lane, name }) => {
            const row = groups.filter((g) => g.lane === lane);
            if (row.length === 0) return null;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a row of buttons laid out on the bar, which a fieldset's box would not allow.
              <div
                key={lane}
                role="group"
                aria-label={i18n._(name)}
                className="relative h-4"
              >
                {row.map((group) => (
                  <button
                    key={group.column}
                    type="button"
                    // Reached from the keyboard with [ and ], which keeps a
                    // match with a mark in every column from being a hundred
                    // tab stops.
                    tabIndex={-1}
                    aria-label={groupWords(header, group)}
                    title={groupWords(header, group)}
                    onClick={() => playback.seek(group.frame)}
                    className="absolute inset-y-0 flex items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                    style={{
                      left: `${((group.column + 0.5) / columns) * 100}%`,
                      width: `${100 / columns}%`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    <Glyph lane={lane} many={group.count > 1} />
                  </button>
                ))}
              </div>
            );
          })}
          <Knob
            header={header}
            clock={clock}
            playback={playback}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

/**
 * The knob and its track. Built from the Radix slider the registry's `Slider`
 * wraps, because that wrapper puts its `aria-label` on the root and leaves the
 * knob without a name, and a screen reader lands on the knob.
 */
function Knob({
  header,
  clock,
  playback,
  onKeyDown,
}: {
  header: ReplayTrackHeader;
  clock: ReplayClock;
  playback: Playback;
  onKeyDown: (event: KeyboardEvent) => void;
}) {
  useLocale();
  const frame = useSyncExternalStore(clock.subscribe, () => clock.frame);
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className="relative flex h-5 w-full touch-none select-none items-center"
      min={header.firstFrame}
      max={header.lastFrame}
      step={1}
      value={[frame]}
      onKeyDown={onKeyDown}
      onValueChange={([next]) => {
        // Each pointer move reaches the clock before it returns, so the map
        // follows the pointer. Dragging stops a match that is playing.
        playback.seek(next, { settle: false, pause: true });
      }}
      onValueCommit={() => playback.settle()}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={t`Time in the match`}
        aria-valuetext={matchTime(header, frame)}
        className="block size-4 shrink-0 rounded-full border border-primary bg-background shadow-sm ring-ring/50 transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden"
      />
    </SliderPrimitive.Root>
  );
}
