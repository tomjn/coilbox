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
  FileCode,
  Pause,
  Play,
  Plus,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  addAction,
  bakeAction,
  blendOf,
  FPS,
  isHookTrigger,
  renameAction,
  STOP_CALLIN,
  setActionBlend,
  setActionLoop,
  setActionTrigger,
  triggerProblem,
} from "../../actions";
import type { LegoAction, LegoProject } from "../../model";
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
  /** Opens the Script tab. */
  onShowScript: () => void;
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

  if (owned || compiled) {
    return (
      <div className="flex flex-1 flex-col items-start gap-3 p-4 text-sm">
        <p>
          <Trans>This unit runs its own script.</Trans>
        </p>
        <Button size="sm" variant="outline" onClick={props.onShowScript}>
          <FileCode size={14} /> <Trans>Open the Script tab</Trans>
        </Button>
      </div>
    );
  }

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
  const playhead = active ? rulerFrame(view, scriptFrame) : 0;

  // Held in refs so the effects below read the latest without running again.
  const activeRef = useRef(active);
  activeRef.current = active;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

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

  /**
   * Starts the run at `frame`, paused or not. A viewport already playing
   * something else, or this action again from its start, is stopped for a
   * tick first, because its clock only starts again from nothing.
   */
  function run(paused: boolean, frame: number, restart = false) {
    clearTimeout(timer.current);
    const start = () => {
      onScriptTimeline(baked);
      onScriptPausedChange(paused);
      onScriptFrameChange(frame);
      onPlayingChange(true);
    };
    if (!active) onRunReplaced();
    if (playing && (!active || restart)) {
      onPlayingChange(false);
      timer.current = setTimeout(start, 0);
    } else {
      start();
    }
  }

  function seek(frame: number) {
    const to = Math.min(Math.max(frame, 0), view.end);
    if (active) {
      onScriptPausedChange(true);
      onScriptFrameChange(to);
    } else {
      run(true, to);
    }
  }

  function togglePlay() {
    if (atEnd) run(false, 0, true);
    else if (!active) run(false, 0);
    else onScriptPausedChange(!scriptPaused);
  }

  const showsPlaying = active && !scriptPaused && !atEnd;
  const seconds = playhead / FPS;

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
          <SettingsPopover project={project} action={action} onEdit={onEdit} />
          <HelpPopover label={t`About the timeline`}>
            <TimelineHelp project={project} action={action} />
          </HelpPopover>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <Rows
            view={view}
            action={action}
            playhead={playhead}
            seconds={seconds}
            onSeek={seek}
            onStep={(delta) => seek(playhead + delta)}
            ariaLabel={t`Scrub the action`}
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
}: {
  view: TimelineView;
  action: LegoAction;
  playhead: number;
  seconds: number;
  onSeek: (frame: number) => void;
  onStep: (delta: number) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
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
      readout={<ReadoutText frame={frame} seconds={seconds} />}
      labels={<Labels view={view} open={open} onToggle={toggle} />}
      rows={
        <div className="relative mx-2">
          <TrackRows
            view={view}
            open={open}
            frameCount={frameCount}
            onSeek={onSeek}
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

function ReadoutText({ frame, seconds }: { frame: number; seconds: number }) {
  const time = formatNumber(seconds, { maximumFractionDigits: 2 });
  return (
    <Trans>
      Frame {frame}, {time} s
    </Trans>
  );
}

/** Seconds under the ruler, and where a loop's lap ends. */
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
  const total = Math.floor(view.end / FPS);
  // Every second until they would crowd, then every few.
  const stride = Math.max(1, Math.ceil(total / 12));
  const labels: number[] = [];
  for (let second = 0; second <= total; second += stride) labels.push(second);
  return (
    <div className="relative mx-2 h-4 text-xs text-muted-foreground">
      {labels.map((second) => (
        <span
          key={second}
          className="absolute -translate-x-1/2 tabular-nums"
          style={{ left: `${markPercent(second * FPS, frameCount)}%` }}
        >
          {second}
        </span>
      ))}
      {loop && view.lap > 0 ? (
        <span
          className="absolute top-0 h-4 border-l border-dashed border-foreground/60 pl-1"
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
}: {
  view: TimelineView;
  open: ReadonlySet<string>;
  frameCount: number;
  onSeek: (frame: number) => void;
}) {
  return (
    <>
      {view.rows.map((row) => (
        <div key={row.piece.id} className="flex flex-col">
          <Track
            frameCount={frameCount}
            onSeek={onSeek}
            keys={row.frames.map((frame) => ({
              frame,
              name: pieceKeyName(row, frame),
            }))}
            wraps={row.wraps}
            lastKey={view.lap > 0 ? view.lastKey : null}
          />
          {open.has(row.piece.id)
            ? row.channels.map((channel) => (
                <Track
                  key={`${channel.kind}-${channel.axis}`}
                  frameCount={frameCount}
                  onSeek={onSeek}
                  keys={channel.keys.map((key) => ({
                    frame: key.frame,
                    name: channelKeyName(row, channel, key),
                  }))}
                  wraps={[]}
                  lastKey={view.lap > 0 ? view.lastKey : null}
                />
              ))
            : null}
        </div>
      ))}
    </>
  );
});

/** One row of the timeline: its keys as diamonds that seek to their frame. */
function Track({
  keys,
  wraps,
  lastKey,
  frameCount,
  onSeek,
}: {
  keys: { frame: number; name: string }[];
  /** Where a loop arrives back at the first keys, drawn as an outline. */
  wraps: number[];
  /** Where the lap ends, drawn as a dashed line, when the action loops. */
  lastKey: number | null;
  frameCount: number;
  onSeek: (frame: number) => void;
}) {
  return (
    <div className="relative h-7 border-b border-border/40">
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
      {keys.map((key) => (
        <button
          key={key.frame}
          type="button"
          aria-label={key.name}
          title={key.name}
          onClick={() => onSeek(key.frame)}
          className="absolute top-0.5 flex size-6 -translate-x-1/2 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: `${markPercent(key.frame, frameCount)}%` }}
        >
          <span className="block size-2.5 rotate-45 bg-primary" />
        </button>
      ))}
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
