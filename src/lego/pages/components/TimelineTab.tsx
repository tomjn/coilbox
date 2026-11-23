/**
 * The Timeline tab of the strip under the model (#5396): one action's keys
 * over time, a row for each piece it moves, with a ruler to scrub and a Play
 * button that plays the action alone on the unit.
 *
 * The action is played from `bakeAction`, which plays the plan the exported
 * script is written from, so what plays here is what the game runs. The tab
 * hands that to the viewport the way the Animation panel hands it a run, and
 * the two replace each other.
 *
 * Every edit is one edit of the document through `onEdit`, so the builder's
 * undo and redo cover it.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import {
  ChevronDown,
  ChevronRight,
  Diamond,
  Pause,
  Play,
  Plus,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Field } from "@/components/Field";
import { HelpPopover } from "@/components/HelpPopover";
import { OptionSelect } from "@/components/OptionSelect";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useReduceMotion } from "../../../general/display";
import {
  actionHooks,
  actionPoseAt,
  actionShift,
  addAction,
  bakeAction,
  blendOf,
  type ChannelRef,
  deleteKeys,
  earliestMove,
  FPS,
  isHookTrigger,
  type KeyRef,
  keyFromPose,
  moveKeys,
  poseChanges,
  renameAction,
  STOP_CALLIN,
  setActionBlend,
  setActionLoop,
  setActionTrigger,
  setKeyValue,
  triggerProblem,
} from "../../actions";
import type { LegoAction, LegoProject } from "../../model";
import type { PoseOffsets } from "../../pose";
import { markPercent } from "../../scriptMarks";
import type { ScriptTimeline } from "../../scriptPlayback";
import {
  channelKeyName,
  pieceKeyName,
  rulerFrame,
  type TimelineView,
  timelineView,
} from "../../timelineModel";
import { FrameScrubber } from "./FrameScrubber";

/** The trigger Select's entry for a function of the action's own. */
const OWN_FUNCTION = "own";

/** The widest a row's label column gets before the name is cut short. */
const LABEL_WIDTH = "w-44";

interface Props {
  project: LegoProject;
  /** The action the tab shows. The first one when it is absent or gone. */
  actionId: string | null;
  onActionChange: (actionId: string) => void;
  onEdit: (change: (project: LegoProject) => LegoProject) => void;
  /** Whether the viewport is playing, and the run it plays. */
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  scriptTimeline: ScriptTimeline | null;
  onScriptTimeline: (timeline: ScriptTimeline | null) => void;
  scriptPaused: boolean;
  onScriptPausedChange: (paused: boolean) => void;
  scriptFrame: number;
  onScriptFrameChange: (frame: number) => void;
  /** Called when the tab takes the viewport from a run of the Animation
   *  panel's, so what that run put beside the unit goes. */
  onRunReplaced: () => void;
  /**
   * The pose the gizmo holds while the tab is paused (#5397). The tab asks for
   * the action's pose on the playhead's frame to be held, or for none (null)
   * when something plays. `offsets` is what is held now, with the gizmo's
   * changes in it.
   */
  pose: {
    offsets: PoseOffsets;
    onHold: (offsets: PoseOffsets | null) => void;
  };
}

/** A key picked on a channel's row, by its place on the ruler. */
interface PickedKey extends ChannelRef {
  frame: number;
}

const sameKey = (a: KeyRef, b: KeyRef) =>
  a.piece === b.piece &&
  a.kind === b.kind &&
  a.axis === b.axis &&
  a.frame === b.frame;

/** A diamond on a row: its frame, its name, and the keys it stands for, which
 *  is one on a channel's row and every channel's on a piece's. */
interface TrackKey {
  frame: number;
  name: string;
  refs: KeyRef[];
}

/** A drag in progress: the keys it holds, how many frames it has moved them,
 *  and whether they could be put there. It lives in the rows, and only an edit
 *  on release reaches the document. */
interface Drag {
  keys: KeyRef[];
  by: number;
  blocked: boolean;
}

/** What moving and deleting a key asks of the tab. `trackId` is the row's. */
interface KeyEditing {
  onMove: (trackId: string, key: TrackKey, by: number) => void;
  onRemove: (trackId: string, key: TrackKey, neighbour?: TrackKey) => void;
  /** The most negative offset the keys can be moved by. */
  earliest: (keys: KeyRef[]) => number;
  /** Whether putting the keys `by` frames on would change nothing. */
  moveBlocked: (keys: KeyRef[], by: number) => boolean;
}

export function TimelineTab(props: Props) {
  const { project, actionId, onEdit } = props;
  const owned = project.script !== undefined;
  const compiled = !owned && project.compiledScript !== undefined;
  const actions = project.actions ?? [];
  const action = actions.find((a) => a.id === actionId) ?? actions[0];

  // An action deleted while the viewport plays it leaves nothing to play.
  const playingAction = props.scriptTimeline?.action;
  const { onScriptTimeline, onPlayingChange } = props;
  useEffect(() => {
    if (playingAction === undefined) return;
    if (actions.some((a) => a.id === playingAction) && !owned && !compiled) {
      return;
    }
    onScriptTimeline(null);
    onPlayingChange(false);
  }, [
    playingAction,
    actions,
    owned,
    compiled,
    onScriptTimeline,
    onPlayingChange,
  ]);

  // The builder turns the tab off for a unit that runs its own script: it has
  // no actions to show.
  if (owned || compiled) return null;

  if (!action) {
    return (
      <div className="flex flex-1 items-start p-4">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const id = crypto.randomUUID();
            onEdit((p) => addAction(p, { id, name: "Action" }));
            props.onActionChange(id);
          }}
        >
          <Plus size={14} /> <Trans>New action</Trans>
        </Button>
      </div>
    );
  }

  return <ActionTimeline key={action.id} {...props} action={action} />;
}

function ActionTimeline({
  project,
  action,
  onActionChange,
  onEdit,
  playing,
  onPlayingChange,
  scriptTimeline,
  onScriptTimeline,
  scriptPaused,
  onScriptPausedChange,
  scriptFrame,
  onScriptFrameChange,
  onRunReplaced,
  pose,
}: Props & { action: LegoAction }) {
  const { t } = useLingui();
  const reduceMotion = useReduceMotion();
  const actions = project.actions ?? [];

  const view = useMemo(() => timelineView(action, project), [action, project]);
  const baked = useMemo(() => bakeAction(action, project), [action, project]);
  const playable = baked.frames.length > 0;
  const active = playing && scriptTimeline?.action === action.id;
  const oneShot = baked.end === "hold";
  const last = baked.frames.length - 1;
  const atEnd = active && oneShot && scriptFrame >= last;

  // While nothing plays the tab is paused on `heldFrame`, and the unit is held
  // in the action's pose there for the gizmo to change (#5397).
  const [heldFrame, setHeldFrame] = useState(0);
  const [picked, setPicked] = useState<PickedKey | null>(null);
  const held = !playing;
  const playhead = active
    ? rulerFrame(view, scriptFrame)
    : Math.min(heldFrame, view.end);

  const baseline = useMemo(
    () => (held ? actionPoseAt(action, project, playhead, baked) : null),
    [held, action, project, playhead, baked],
  );
  const changes = useMemo(
    () =>
      held ? poseChanges(action, project, playhead, pose.offsets, baked) : [],
    [held, action, project, playhead, pose.offsets, baked],
  );

  // Holding is asking pose mode for the baseline again, which drops a change
  // that was not keyed. It happens when the playhead moves, when something
  // plays and stops, and when an edit changes the pose under the playhead.
  const holdRef = useRef(pose.onHold);
  holdRef.current = pose.onHold;
  const baselineKey = baseline ? `${playhead}:${JSON.stringify(baseline)}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the baseline
  useEffect(() => {
    holdRef.current(baseline);
  }, [baselineKey]);
  useEffect(() => () => holdRef.current(null), []);

  // Held in refs so the effects below read the latest without running again.
  const activeRef = useRef(active);
  activeRef.current = active;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frameRequest = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      cancelAnimationFrame(frameRequest.current);
    },
    [],
  );

  const stop = useCallback(() => {
    onScriptTimeline(null);
    onPlayingChange(false);
    onScriptPausedChange(false);
    onScriptFrameChange(0);
  }, [
    onScriptTimeline,
    onPlayingChange,
    onScriptPausedChange,
    onScriptFrameChange,
  ]);

  // Stops what plays and holds the pose instead. The tab's own timeline stays
  // the viewport's, which is how the Animation panel knows the tab has the
  // viewport and lets go of the run it made, so that an edit made here does not
  // start that run again.
  const settle = useCallback(() => {
    onScriptTimeline(baked);
    onPlayingChange(false);
    onScriptPausedChange(false);
    onScriptFrameChange(0);
  }, [
    baked,
    onScriptTimeline,
    onPlayingChange,
    onScriptPausedChange,
    onScriptFrameChange,
  ]);

  // An edit changes what the action plays. A run of it on screen goes on from
  // the frame it is on, with the new motion.
  const lastBaked = useRef(baked);
  useEffect(() => {
    if (lastBaked.current === baked) return;
    lastBaked.current = baked;
    if (!activeRef.current) return;
    if (baked.frames.length === 0) stop();
    else onScriptTimeline(baked);
  }, [baked, stop, onScriptTimeline]);

  // A one shot action that has played to its end stays on its last pose, which
  // is held now, so that it can be keyed.
  useEffect(() => {
    if (!atEnd) return;
    setHeldFrame(Math.min(baked.frames.length, view.end));
    settle();
  }, [atEnd, baked, view, settle]);

  /**
   * Plays the action from `from`. A viewport playing something else is stopped
   * for a tick first, because its clock only starts again from nothing. The
   * clock starts a run from the frame it is paused on, so a run that starts
   * part way in is paused on that frame and let go once the viewport has
   * drawn it.
   */
  function play(from: number) {
    clearTimeout(timer.current);
    cancelAnimationFrame(frameRequest.current);
    const start = () => {
      onScriptTimeline(baked);
      onScriptPausedChange(from > 0);
      onScriptFrameChange(from);
      onPlayingChange(true);
      if (from <= 0) return;
      frameRequest.current = requestAnimationFrame(() => {
        frameRequest.current = requestAnimationFrame(() =>
          onScriptPausedChange(false),
        );
      });
    };
    if (!active) onRunReplaced();
    if (playing) {
      onPlayingChange(false);
      timer.current = setTimeout(start, 0);
    } else {
      start();
    }
  }

  /** Pauses where the run has got to, with the unit held in the pose there. */
  function pause() {
    cancelAnimationFrame(frameRequest.current);
    setHeldFrame(rulerFrame(view, scriptFrame));
    settle();
  }

  function seek(frame: number) {
    const to = Math.min(Math.max(frame, 0), view.end);
    clearTimeout(timer.current);
    cancelAnimationFrame(frameRequest.current);
    setHeldFrame(to);
    if (playing) {
      if (!active) onRunReplaced();
      settle();
    }
  }

  const running = active && !scriptPaused && !atEnd;

  function togglePlay() {
    if (running) {
      pause();
      return;
    }
    // From the end of a one shot action, play it again from the start.
    play(oneShot && playhead >= baked.frames.length ? 0 : playhead);
  }

  const showsPlaying = running;
  const seconds = playhead / FPS;

  const pickedKey = useMemo(() => {
    if (!picked) return null;
    const row = view.rows.find((r) => r.piece.id === picked.piece);
    const channel = row?.channels.find(
      (c) => c.kind === picked.kind && c.axis === picked.axis,
    );
    const key = channel?.keys.find((k) => k.frame === picked.frame);
    return row && channel && key ? { row, channel, key } : null;
  }, [picked, view]);

  // After a move or a delete the key's button is a new one, so focus is put
  // back on the key that took its place, which is what lets the arrow keys be
  // pressed again.
  const rowsRef = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when an edit has redrawn the keys
  useEffect(() => {
    const wanted = refocus.current;
    refocus.current = null;
    if (wanted === null) return;
    for (const button of rowsRef.current?.querySelectorAll<HTMLElement>(
      "[data-key]",
    ) ?? []) {
      if (button.dataset.key === wanted) button.focus();
    }
  }, [view]);

  /** How far a change slides the ruler under a blend in, which keys the first
   *  key's frame, so a key's ruler frame after it is not the one it had. */
  function slideOf(next: LegoProject): number {
    const after = next.actions?.find((a) => a.id === action.id);
    return after ? actionShift(after, next) - actionShift(action, project) : 0;
  }

  /** Whether a move of these keys would change nothing: it would land on a
   *  frame the channel already keys, or before frame 0. */
  const moveBlocked = (keys: KeyRef[], by: number) =>
    moveKeys(project, action.id, keys, by) === project;

  function moveBy(trackId: string, key: TrackKey, by: number) {
    const next = moveKeys(project, action.id, key.refs, by);
    if (next === project) return;
    const slide = by + slideOf(next);
    refocus.current = `${trackId}:${key.frame + slide}`;
    setPicked((now) =>
      now && key.refs.some((ref) => sameKey(ref, now))
        ? { ...now, frame: now.frame + slide }
        : now,
    );
    onEdit((p) => moveKeys(p, action.id, key.refs, by));
  }

  function removeKey(trackId: string, key: TrackKey, neighbour?: TrackKey) {
    const next = deleteKeys(project, action.id, key.refs);
    if (next === project) return;
    refocus.current = neighbour
      ? `${trackId}:${neighbour.frame + slideOf(next)}`
      : null;
    setPicked((now) =>
      now && key.refs.some((ref) => sameKey(ref, now)) ? null : now,
    );
    onEdit((p) => deleteKeys(p, action.id, key.refs));
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1">
          <div className="w-44">
            <OptionSelect
              size="sm"
              ariaLabel={t`Action`}
              value={action.id}
              options={actions.map((a) => ({ value: a.id, label: a.name }))}
              onValueChange={(id) => {
                if (scriptTimeline?.action !== undefined) stop();
                onActionChange(id);
              }}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            aria-label={t`New action`}
            title={t`New action`}
            onClick={() => {
              const id = crypto.randomUUID();
              onEdit((p) => addAction(p, { id, name: "Action" }));
              if (scriptTimeline?.action !== undefined) stop();
              onActionChange(id);
            }}
          >
            <Plus size={14} />
            <Trans>New action</Trans>
          </Button>
          <Button
            size="sm"
            variant={showsPlaying ? "default" : "outline"}
            disabled={reduceMotion || !playable}
            aria-pressed={showsPlaying}
            onClick={togglePlay}
          >
            {showsPlaying ? <Pause size={14} /> : <Play size={14} />}
            {showsPlaying ? t`Pause` : t`Play`}
          </Button>
          <div className="flex items-center gap-2">
            <Label htmlFor="timeline-loop" className="text-xs font-medium">
              <Trans>Loop</Trans>
            </Label>
            <Switch
              id="timeline-loop"
              checked={action.loop}
              onCheckedChange={(on) =>
                onEdit((p) => setActionLoop(p, action.id, on))
              }
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={changes.length === 0}
            title={t`Key the pieces you changed on this frame`}
            onClick={() =>
              onEdit((p) => keyFromPose(p, action.id, playhead, pose.offsets))
            }
          >
            <Diamond size={14} />
            <Trans>Key</Trans>
          </Button>
          {pickedKey ? (
            <KeyValueField
              key={`${pickedKey.row.piece.id}-${pickedKey.channel.label}-${pickedKey.key.frame}`}
              channel={pickedKey.channel.label}
              piece={pickedKey.row.piece.name}
              frame={pickedKey.key.frame}
              turn={pickedKey.channel.kind === "turn"}
              value={pickedKey.key.value}
              onCommit={(value) =>
                onEdit((p) =>
                  setKeyValue(
                    p,
                    action.id,
                    {
                      piece: pickedKey.row.piece.id,
                      kind: pickedKey.channel.kind,
                      axis: pickedKey.channel.axis,
                    },
                    pickedKey.key.frame,
                    value,
                  ),
                )
              }
            />
          ) : null}
          <SettingsPopover project={project} action={action} onEdit={onEdit} />
          <HelpPopover label={t`About the timeline`}>
            <TimelineHelp project={project} action={action} />
          </HelpPopover>
        </div>

        <div ref={rowsRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <Rows
            view={view}
            action={action}
            earliest={(keys) => earliestMove(action, project, keys)}
            onMove={moveBy}
            onRemove={removeKey}
            moveBlocked={moveBlocked}
            playhead={playhead}
            seconds={seconds}
            onSeek={seek}
            onStep={(delta) => seek(playhead + delta)}
            ariaLabel={t`Scrub the action`}
            picked={pickedKey ? picked : null}
            onPick={(key) => {
              setPicked(key);
              seek(key.frame);
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

/** The ruler and every row under it. Its own component so that the rows, which
 *  do not change as the playhead goes, are not drawn again on each frame. */
function Rows({
  view,
  action,
  playhead,
  seconds,
  onSeek,
  onStep,
  ariaLabel,
  picked,
  onPick,
  ...editing
}: KeyEditing & {
  view: TimelineView;
  action: LegoAction;
  playhead: number;
  seconds: number;
  onSeek: (frame: number) => void;
  onStep: (delta: number) => void;
  ariaLabel: string;
  picked: PickedKey | null;
  /** A key on a channel's row was chosen: the playhead goes to it. */
  onPick: (key: PickedKey) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  const [drag, setDrag] = useState<Drag | null>(null);
  const frameCount = view.end + 1;
  const frame = Math.round(playhead);

  return (
    <FrameScrubber
      stickyRuler
      className="min-w-0"
      frame={playhead}
      lastFrame={view.end}
      onSeek={onSeek}
      onStep={onStep}
      ariaLabel={ariaLabel}
      readout={<ReadoutText frame={frame} last={view.end} seconds={seconds} />}
      labels={<Labels view={view} open={open} onToggle={toggle} />}
      rows={
        <div className="relative mx-2">
          <TrackRows
            view={view}
            open={open}
            frameCount={frameCount}
            onSeek={onSeek}
            picked={picked}
            onPick={onPick}
            drag={drag}
            onDrag={setDrag}
            {...editing}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-primary"
            style={{ left: `${markPercent(playhead, frameCount)}%` }}
          />
        </div>
      }
    >
      <Ticks view={view} frameCount={frameCount} loop={action.loop} />
    </FrameScrubber>
  );
}

function ReadoutText({
  frame,
  last,
  seconds,
}: {
  frame: number;
  last: number;
  seconds: number;
}) {
  const time = formatNumber(seconds, { maximumFractionDigits: 2 });
  return (
    <Trans>
      Frame {frame} / {last}, {time} s
    </Trans>
  );
}

/** Numbered strides between frame labels, so labels land on round frames. */
const LABEL_STRIDES = [1, 2, 5, 10, 15, 30, 60, 150, 300, 600, 1500, 3000];

/** Frames under the ruler, a mark on each and a number on every few, and
 *  where a loop's lap ends. */
function Ticks({
  view,
  frameCount,
  loop,
}: {
  view: TimelineView;
  frameCount: number;
  loop: boolean;
}) {
  const { t } = useLingui();
  // A number every few frames until they would crowd past a dozen, then a
  // wider stride.
  const stride =
    LABEL_STRIDES.find((s) => view.end / s <= 12) ??
    Math.ceil(view.end / 12 / FPS) * FPS;
  // A short mark between the numbers: every frame while the numbers are close,
  // a fifth or a half of the stride once they are not.
  const minor =
    stride % 5 === 0 ? stride / 5 : stride % 2 === 0 ? stride / 2 : 1;
  const marks: number[] = [];
  for (let frame = 0; frame <= view.end; frame += minor) marks.push(frame);
  return (
    <div className="relative mx-2 h-6 text-xs text-muted-foreground">
      {marks.map((frame) => {
        const major = frame % stride === 0;
        const left = `${markPercent(frame, frameCount)}%`;
        return (
          <Fragment key={frame}>
            <span
              aria-hidden
              className={cn(
                "absolute top-0 w-px bg-muted-foreground/60",
                major ? "h-2" : "h-1",
              )}
              style={{ left }}
            />
            {major ? (
              <span
                className="absolute top-2 -translate-x-1/2 tabular-nums"
                style={{ left }}
              >
                {frame}
              </span>
            ) : null}
          </Fragment>
        );
      })}
      {loop && view.lap > 0 ? (
        <span
          className="absolute top-0 h-6 border-l border-dashed border-foreground/60 pl-1"
          style={{ left: `${markPercent(view.lastKey, frameCount)}%` }}
        >
          {t`Lap ends`}
        </span>
      ) : null}
    </div>
  );
}

const Labels = memo(function Labels({
  view,
  open,
  onToggle,
}: {
  view: TimelineView;
  open: ReadonlySet<string>;
  onToggle: (pieceId: string) => void;
}) {
  const { t } = useLingui();
  return (
    <>
      {view.rows.map((row) => {
        const expanded = open.has(row.piece.id);
        const name = row.piece.name;
        return (
          <div key={row.piece.id} className="flex flex-col">
            <div
              className={cn(
                "flex h-7 items-center gap-1 border-b border-border/40",
                LABEL_WIDTH,
              )}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={t`Channels of ${name}`}
                title={t`Channels of ${name}`}
                onClick={() => onToggle(row.piece.id)}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {expanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
              <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
              {row.clash ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={row.clash}
                      className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <TriangleAlert size={14} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{row.clash}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            {expanded
              ? row.channels.map((channel) => (
                  <div
                    key={`${channel.kind}-${channel.axis}`}
                    className={cn(
                      "flex h-7 items-center truncate border-b border-border/40 pl-8 text-xs text-muted-foreground",
                      LABEL_WIDTH,
                    )}
                  >
                    {channel.label}
                  </div>
                ))
              : null}
          </div>
        );
      })}
    </>
  );
});

const TrackRows = memo(function TrackRows({
  view,
  open,
  frameCount,
  onSeek,
  picked,
  onPick,
  ...rest
}: KeyEditing & {
  view: TimelineView;
  open: ReadonlySet<string>;
  frameCount: number;
  onSeek: (frame: number) => void;
  picked: PickedKey | null;
  onPick: (key: PickedKey) => void;
  drag: Drag | null;
  onDrag: (drag: Drag | null) => void;
}) {
  return (
    <>
      {view.rows.map((row) => (
        <div key={row.piece.id} className="flex flex-col">
          <Track
            id={`piece:${row.piece.id}`}
            frameCount={frameCount}
            onPick={onSeek}
            keys={row.frames.map((frame) => ({
              frame,
              name: pieceKeyName(row, frame),
              refs: row.channels
                .filter((channel) =>
                  channel.keys.some((k) => k.frame === frame),
                )
                .map((channel) => ({
                  piece: row.piece.id,
                  kind: channel.kind,
                  axis: channel.axis,
                  frame,
                })),
            }))}
            wraps={row.wraps}
            lastKey={view.lap > 0 ? view.lastKey : null}
            {...rest}
          />
          {open.has(row.piece.id)
            ? row.channels.map((channel) => (
                <Track
                  key={`${channel.kind}-${channel.axis}`}
                  id={`${row.piece.id}:${channel.kind}:${channel.axis}`}
                  frameCount={frameCount}
                  onPick={(frame) =>
                    onPick({
                      piece: row.piece.id,
                      kind: channel.kind,
                      axis: channel.axis,
                      frame,
                    })
                  }
                  pickedFrame={
                    picked?.piece === row.piece.id &&
                    picked.kind === channel.kind &&
                    picked.axis === channel.axis
                      ? picked.frame
                      : null
                  }
                  keys={channel.keys.map((key) => ({
                    frame: key.frame,
                    name: channelKeyName(row, channel, key),
                    refs: [
                      {
                        piece: row.piece.id,
                        kind: channel.kind,
                        axis: channel.axis,
                        frame: key.frame,
                      },
                    ],
                  }))}
                  wraps={[]}
                  lastKey={view.lap > 0 ? view.lastKey : null}
                  {...rest}
                />
              ))
            : null}
        </div>
      ))}
    </>
  );
});

/**
 * One row of the timeline: its keys as diamonds. A click seeks to the key's
 * frame. A drag moves it along the row a whole frame at a time, and lets the
 * document know once, on release. With a key focused, Left and Right move it a
 * frame and Delete or Backspace removes it.
 */
function Track({
  id,
  keys,
  wraps,
  lastKey,
  frameCount,
  onPick,
  pickedFrame = null,
  drag,
  onDrag,
  onMove,
  onRemove,
  earliest,
  moveBlocked,
}: KeyEditing & {
  id: string;
  keys: TrackKey[];
  /** Where a loop arrives back at the first keys, drawn as an outline. */
  wraps: number[];
  /** Where the lap ends, drawn as a dashed line, when the action loops. */
  lastKey: number | null;
  frameCount: number;
  /** A key was clicked. The playhead goes to it. */
  onPick: (frame: number) => void;
  /** The frame of the key chosen on this row, which is drawn ringed. */
  pickedFrame?: number | null;
  drag: Drag | null;
  onDrag: (drag: Drag | null) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  // The pointer's start, and the key it holds, while a button is down.
  const gesture = useRef<{ x: number; key: TrackKey; by: number } | null>(null);
  // A drag ends in a click on the same button, which must not seek.
  const dragged = useRef(false);

  const draggedBy = (key: TrackKey) =>
    drag && key.refs.every((ref) => drag.keys.some((d) => sameKey(d, ref)))
      ? drag
      : null;

  function pointerMove(clientX: number) {
    const held = gesture.current;
    const width = rail.current?.getBoundingClientRect().width ?? 0;
    if (!held || width <= 0) return;
    // A frame is a gap of `width / (frameCount - 1)`. The pointer is not held
    // to the row, so a key can be dragged past the end of the ruler.
    const by = Math.max(
      Math.round(((clientX - held.x) / width) * (frameCount - 1)),
      earliest(held.key.refs),
    );
    if (by === held.by) return;
    held.by = by;
    if (by !== 0) dragged.current = true;
    onDrag({
      keys: held.key.refs,
      by,
      blocked: by !== 0 && moveBlocked(held.key.refs, by),
    });
  }

  function release(commit: boolean) {
    const held = gesture.current;
    gesture.current = null;
    onDrag(null);
    if (commit && held && held.by !== 0) onMove(id, held.key, held.by);
  }

  return (
    <div ref={rail} className="relative h-7 border-b border-border/40">
      {lastKey !== null ? (
        <div
          aria-hidden
          className="absolute inset-y-0 border-l border-dashed border-foreground/40"
          style={{ left: `${markPercent(lastKey, frameCount)}%` }}
        />
      ) : null}
      {wraps.map((frame) => (
        <span
          key={`wrap-${frame}`}
          aria-hidden
          className="absolute top-2 size-2.5 -translate-x-1/2 rotate-45 border border-muted-foreground"
          style={{ left: `${markPercent(frame, frameCount)}%` }}
        />
      ))}
      {keys.map((key, index) => {
        const moving = draggedBy(key);
        const shown = key.frame + (moving?.by ?? 0);
        return (
          <button
            key={key.frame}
            type="button"
            data-key={`${id}:${key.frame}`}
            aria-label={key.name}
            title={key.name}
            aria-pressed={
              pickedFrame === null ? undefined : pickedFrame === key.frame
            }
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              onPick(key.frame);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragged.current = false;
              gesture.current = { x: event.clientX, key, by: 0 };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => pointerMove(event.clientX)}
            onPointerUp={() => release(true)}
            onPointerCancel={() => release(false)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === "Escape" && gesture.current) {
                event.preventDefault();
                event.stopPropagation();
                release(false);
                return;
              }
              if (event.shiftKey) return;
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                onMove(id, key, event.key === "ArrowLeft" ? -1 : 1);
              } else if (event.key === "Delete" || event.key === "Backspace") {
                // The builder deletes the selected piece on these keys.
                event.preventDefault();
                event.stopPropagation();
                onRemove(id, key, keys[index + 1] ?? keys[index - 1]);
              }
            }}
            className="absolute top-0.5 flex size-6 -translate-x-1/2 touch-none items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              left: `${markPercent(Math.min(shown, frameCount - 1), frameCount)}%`,
            }}
          >
            <span
              className={cn(
                "block size-2.5 rotate-45",
                moving?.blocked ? "bg-destructive" : "bg-primary",
                pickedFrame === key.frame && "ring-2 ring-foreground",
              )}
            />
            {moving ? (
              <span className="pointer-events-none absolute left-full ml-1 text-xs tabular-nums">
                {shown}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The value of the key picked on a channel's row: degrees for a turn, elmos for
 * a move. Typing one and leaving the field, or pressing Enter, is one edit.
 */
function KeyValueField({
  channel,
  piece,
  frame,
  turn,
  value,
  onCommit,
}: {
  channel: string;
  piece: string;
  frame: number;
  turn: boolean;
  /** Radians for a turn, elmos for a move. */
  value: number;
  onCommit: (value: number) => void;
}) {
  const { t } = useLingui();
  const shown = String(
    Math.round((turn ? (value * 180) / Math.PI : value) * 100) / 100,
  );
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);

  function commit() {
    const typed = Number(text);
    if (text.trim() === "" || !Number.isFinite(typed)) {
      setText(shown);
      return;
    }
    if (String(typed) === shown) return;
    onCommit(turn ? (typed * Math.PI) / 180 : typed);
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">
        <Trans>
          {channel} of {piece}, frame {frame}
        </Trans>
      </span>
      <Input
        type="number"
        step={turn ? 1 : 0.1}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText(shown);
        }}
        aria-label={turn ? t`Key value in degrees` : t`Key value in elmos`}
        className="h-7 w-20 text-xs"
      />
      <span className="text-muted-foreground">
        {turn ? t`degrees` : t`elmos`}
      </span>
    </div>
  );
}

/** The fields the action's drawer had: its name, what starts it, and how long
 *  it eases in and out. */
function SettingsPopover({
  project,
  action,
  onEdit,
}: {
  project: LegoProject;
  action: LegoAction;
  onEdit: (change: (project: LegoProject) => LegoProject) => void;
}) {
  const { t } = useLingui();
  const [name, setName] = useState(action.name);
  useEffect(() => setName(action.name), [action.name]);
  // What was typed for a function of its own. Empty until there is one, so
  // choosing that option offers a free name rather than the hook's.
  const [own, setOwn] = useState(
    isHookTrigger(project, action.trigger) ? "" : action.trigger,
  );
  useEffect(() => {
    if (!isHookTrigger(project, action.trigger)) setOwn(action.trigger);
  }, [action.trigger, project]);

  const hooks = actionHooks(project);
  const isOwn = !isHookTrigger(project, action.trigger);
  const ownProblem = isOwn ? triggerProblem(project, action.trigger) : null;
  const blend = blendOf(action, project);

  function commitName() {
    if (name.trim() === "" || name.trim() === action.name) {
      setName(action.name);
    } else {
      onEdit((p) => renameAction(p, action.id, name));
    }
  }

  function commitOwn() {
    const next = own.trim();
    if (next === "") return;
    onEdit((p) => setActionTrigger(p, action.id, next));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t`Action settings`}
          title={t`Action settings`}
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={t`Action settings`}
        className="flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto p-3 text-xs"
      >
        <Field label={t`Name`}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setName(action.name);
            }}
            aria-label={t`Action name`}
          />
        </Field>

        <Field label={t`Starts on`}>
          <OptionSelect
            ariaLabel={t`Starts on`}
            value={isOwn ? OWN_FUNCTION : action.trigger}
            options={[
              ...hooks.map((hook) => ({ value: hook, label: hook })),
              { value: OWN_FUNCTION, label: t`A function of its own` },
            ]}
            onValueChange={(value) => {
              if (value !== OWN_FUNCTION) {
                onEdit((p) => setActionTrigger(p, action.id, value));
                return;
              }
              // Keeps what was typed, or offers a name that is free.
              const free = own.trim() === "" ? "RunAction" : own.trim();
              setOwn(free);
              onEdit((p) => setActionTrigger(p, action.id, free));
            }}
          />
          {isOwn ? (
            <Input
              value={own}
              onChange={(event) => setOwn(event.target.value)}
              onBlur={commitOwn}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label={t`Function name`}
              aria-invalid={ownProblem !== null}
            />
          ) : null}
          {ownProblem ? (
            <span className="text-xs text-destructive">{ownProblem}</span>
          ) : null}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          {(["blendIn", "blendOut"] as const).map((which) => (
            <Field
              key={which}
              label={which === "blendIn" ? t`Blend in (s)` : t`Blend out (s)`}
            >
              <Input
                type="number"
                min={0}
                step={0.1}
                value={action[which] ?? ""}
                placeholder={String(blend[which])}
                onChange={(event) => {
                  // Read now: the edit runs later, when the event's input has
                  // gone back to the stored value.
                  const next =
                    event.target.value === ""
                      ? null
                      : Number(event.target.value);
                  onEdit((p) => setActionBlend(p, action.id, which, next));
                }}
                aria-label={
                  which === "blendIn"
                    ? t`Seconds to ease in from where the pieces are`
                    : t`Seconds to ease back to rest`
                }
                title={
                  which === "blendIn"
                    ? t`Seconds to reach the first key from wherever the pieces are. Empty uses the unit's time.`
                    : t`Seconds to return to rest when it stops. Empty uses the unit's time.`
                }
                className="h-8 text-xs"
              />
            </Field>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** What the tab shows and how a loop ends, for the help icon. */
function TimelineHelp({
  project,
  action,
}: {
  project: LegoProject;
  action: LegoAction;
}) {
  const { t } = useLingui();
  const stop = STOP_CALLIN[action.trigger];
  const stopsOn = stop ?? "";
  const stopFunction = `${action.trigger}Stop`;
  const isOwn = !isHookTrigger(project, action.trigger);
  return (
    <>
      <p>
        <Trans>
          Each row is a piece the action moves, and each diamond is a frame
          where it has a key. Open a row to see its turns and moves one by one.
          Drag the ruler to scrub the motion.
        </Trans>
      </p>
      <p>
        <Trans>
          To make a key, pause on a frame, move a piece with the gizmo, and
          press Key. Every turn and move you changed gets a key on that frame.
          Moving the ruler drops a change you have not keyed. Pick a key on a
          turn or move row to type its value.
        </Trans>
      </p>
      <p>
        <Trans>
          Between two keys a piece moves at a steady speed, as the game moves
          it.
        </Trans>
      </p>
      <p>
        {action.loop
          ? stop
            ? t`It loops and stops on ${stopsOn}.`
            : isOwn
              ? t`It loops and stops when ${stopFunction} is called.`
              : t`It loops and runs until it is started again.`
          : t`It plays once and holds the last pose.`}
      </p>
    </>
  );
}
