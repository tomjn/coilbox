/**
 * Apply canned animations to a unit and watch them run.
 *
 * A preset can only be applied once its roles are filled, and the reason it
 * cannot is named rather than left as a greyed-out button. Playback changes
 * nothing in the document: stopping restores the built pose exactly.
 *
 * A unit that has taken its script over is past all of this. The presets are
 * gone for it, so playback runs the script itself: pick what happens to the
 * unit, and the viewport plays what the script does about it.
 */

import { Button } from "@picoframe/frame";
import {
  FileCode,
  Pause,
  Play,
  Square,
  StepBack,
  StepForward,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useReduceMotion } from "../../../general/display";
import {
  type AppliedPreset,
  countRoles,
  PRESETS,
  presetById,
  roleLabel,
  unmetRequirements,
} from "../../animPresets";
import { legoRunScript } from "../../bindings";
import type { LegoProject } from "../../model";
import {
  clampFrame,
  PREVIEW_FRAMES,
  PREVIEW_SECONDS,
  playable,
  SCENARIOS,
  type ScriptTimeline,
  scenarioById,
} from "../../scriptPlayback";
import { ScriptDrawer } from "./ScriptDrawer";

interface Props {
  project: LegoProject;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onChange: (applied: AppliedPreset[]) => void;
  /** Stores the unit's own Lua. The first call is the unit taking it over. */
  onScriptChange: (script: string) => void;
  /**
   * The poses a run of the unit's own script produced, for the viewport to
   * play. Null whenever the presets are what is playing, or nothing is.
   */
  onScriptTimeline: (timeline: ScriptTimeline | null) => void;
  /**
   * Whether the run's clock is frozen on `scriptFrame`. Pausing holds the
   * viewport on one frame without losing the run. Stepping and scrubbing both
   * pause it first, since either only makes sense as a still frame.
   */
  scriptPaused: boolean;
  onScriptPausedChange: (paused: boolean) => void;
  /** The frame a paused run is held on, and the frame a running one is
   *  currently showing. */
  scriptFrame: number;
  onScriptFrameChange: (frame: number) => void;
}

export function AnimationPanel({
  project,
  playing,
  onPlayingChange,
  onChange,
  onScriptChange,
  onScriptTimeline,
  scriptPaused,
  onScriptPausedChange,
  scriptFrame,
  onScriptFrameChange,
}: Props) {
  const reduceMotion = useReduceMotion();
  const [showScript, setShowScript] = useState(false);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [timeline, setTimeline] = useState<ScriptTimeline | null>(null);
  const [running, setRunning] = useState(false);
  /** A run that never reached the runtime, as opposed to one that failed in it. */
  const [failure, setFailure] = useState<string | null>(null);
  const applied = project.animations ?? [];
  const counts = countRoles(project.pieces);
  const owned = project.script !== undefined;

  const stop = useCallback(() => {
    onPlayingChange(false);
    onScriptTimeline(null);
    setTimeline(null);
    setFailure(null);
    onScriptPausedChange(false);
    onScriptFrameChange(0);
  }, [
    onPlayingChange,
    onScriptTimeline,
    onScriptPausedChange,
    onScriptFrameChange,
  ]);

  const start = useCallback(
    async (scenario: string) => {
      const script = project.script;
      if (script === undefined) return;
      setRunning(true);
      setFailure(null);
      try {
        const result = await legoRunScript({
          script,
          unitName: project.unitName,
          pieces: project.pieces.map((piece) => piece.name),
          events: scenarioById(scenario)?.events ?? [],
          frames: PREVIEW_FRAMES,
        });
        setTimeline(result);
        // A run that produced nothing has only its reason to show. One that
        // failed part way through is still worth watching up to that point.
        onScriptTimeline(result.frames.length > 0 ? result : null);
        onPlayingChange(result.frames.length > 0);
        onScriptPausedChange(false);
        onScriptFrameChange(0);
      } catch (error) {
        setTimeline(null);
        onScriptTimeline(null);
        onPlayingChange(false);
        setFailure(error instanceof Error ? error.message : String(error));
      } finally {
        setRunning(false);
      }
    },
    [
      project.script,
      project.unitName,
      project.pieces,
      onPlayingChange,
      onScriptTimeline,
      onScriptPausedChange,
      onScriptFrameChange,
    ],
  );

  /** Stepping only makes sense on a held frame, so it pauses first. */
  const step = useCallback(
    (delta: number) => {
      if (!timeline) return;
      onScriptPausedChange(true);
      onScriptFrameChange(clampFrame(timeline, scriptFrame + delta));
    },
    [timeline, scriptFrame, onScriptPausedChange, onScriptFrameChange],
  );

  // A script edited while it is playing leaves the poses on screen describing
  // the script before the edit, so playback stops rather than lying about it.
  // Held in a ref because the callbacks are rebuilt on every render.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const lastScript = useRef(project.script);
  useEffect(() => {
    if (lastScript.current === project.script) return;
    lastScript.current = project.script;
    stopRef.current();
  }, [project.script]);

  function apply(presetId: string) {
    onChange([...applied, { presetId, params: {} }]);
  }

  function remove(presetId: string) {
    onChange(applied.filter((entry) => entry.presetId !== presetId));
  }

  function setParam(presetId: string, param: string, next: number) {
    onChange(
      applied.map((entry) =>
        entry.presetId === presetId
          ? { ...entry, params: { ...entry.params, [param]: next } }
          : entry,
      ),
    );
  }

  const scriptDrawer = (
    <ScriptDrawer
      open={showScript}
      onOpenChange={setShowScript}
      project={project}
      onScriptChange={onScriptChange}
    />
  );

  if (owned) {
    const scenario = scenarioById(scenarioId);
    const stopped = timeline?.error ?? null;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Button
            size="sm"
            variant={playing && !scriptPaused ? "default" : "outline"}
            disabled={reduceMotion || running}
            onClick={() =>
              playing
                ? onScriptPausedChange(!scriptPaused)
                : void start(scenarioId)
            }
          >
            {playing && !scriptPaused ? (
              <Pause size={14} />
            ) : (
              <Play size={14} />
            )}
            {!playing
              ? running
                ? "Running"
                : "Play"
              : scriptPaused
                ? "Resume"
                : "Pause"}
          </Button>
          {playing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={stop}
              title="Stop and return to the built pose"
            >
              <Square size={14} />
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {reduceMotion
              ? "Playback is off while your system asks for reduced motion."
              : `${PREVIEW_SECONDS} seconds, looped`}
          </span>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setShowScript(true)}
          >
            <FileCode size={14} /> Edit
          </Button>
        </div>

        {playable(timeline) ? (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={scriptFrame <= 0}
              onClick={() => step(-1)}
              title="Step back one frame"
            >
              <StepBack size={14} />
            </Button>
            <Slider
              className="flex-1"
              min={0}
              max={Math.max((timeline?.frames.length ?? 1) - 1, 0)}
              step={1}
              value={[scriptFrame]}
              onValueChange={([next]) => {
                onScriptPausedChange(true);
                onScriptFrameChange(next);
              }}
              aria-label="Scrub the script preview"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={scriptFrame >= (timeline?.frames.length ?? 1) - 1}
              onClick={() => step(1)}
              title="Step forward one frame"
            >
              <StepForward size={14} />
            </Button>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {scriptFrame + 1}/{timeline?.frames.length}
            </span>
          </div>
        ) : null}

        {scriptDrawer}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">
              What happens to the unit
            </span>
            <Select
              value={scenarioId}
              onValueChange={(next) => {
                setScenarioId(next);
                if (playing || timeline) void start(next);
              }}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIOS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {scenario?.description}
            </p>
          </div>

          {failure ? (
            <p className="text-xs text-destructive">
              The script could not be run: {failure}
            </p>
          ) : null}

          {stopped ? (
            <div className="flex flex-col gap-1 rounded-md border border-destructive/50 px-2 py-2">
              <span className="text-xs font-medium text-destructive">
                The script stopped
              </span>
              <p className="text-xs text-destructive">{stopped}</p>
              <p className="text-xs text-muted-foreground">
                {timeline && timeline.frames.length > 0
                  ? `Playing the ${(timeline.frames.length / timeline.fps).toFixed(1)} seconds it managed first.`
                  : "It got no further than that, so there is nothing to play."}
              </p>
            </div>
          ) : null}

          {timeline?.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}

          <p className="text-xs text-muted-foreground">
            The presets wrote this unit's script once and are done with it. This
            plays the script itself, so what you see is what the file says.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          size="sm"
          variant={playing ? "default" : "outline"}
          onClick={() => onPlayingChange(!playing)}
          disabled={applied.length === 0 || reduceMotion}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? "Stop" : "Play"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {reduceMotion
            ? "Playback is off while your system asks for reduced motion."
            : applied.length === 0
              ? "Apply one below."
              : `${applied.length} applied`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setShowScript(true)}
          title="The unit script these animations generate"
        >
          <FileCode size={14} />
        </Button>
      </div>

      {scriptDrawer}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {PRESETS.map((preset) => {
          const entry = applied.find((a) => a.presetId === preset.id);
          const missing = unmetRequirements(preset, counts);

          return (
            <div
              key={preset.id}
              className="border-b border-border/60 px-3 py-2"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{preset.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {preset.description}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={entry ? "outline" : "default"}
                  disabled={!entry && missing.length > 0}
                  onClick={() => (entry ? remove(preset.id) : apply(preset.id))}
                >
                  {entry ? "Remove" : "Apply"}
                </Button>
              </div>

              {!entry && missing.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Needs a piece set as{" "}
                  {missing.map((role) => roleLabel(role)).join(", ")}.
                </p>
              ) : null}

              {entry
                ? preset.params.map((param) => (
                    <div key={param.id} className="mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span>{param.label}</span>
                        <span className="text-muted-foreground">
                          {entry.params[param.id] ?? param.fallback}
                          {param.unit === "deg"
                            ? "°"
                            : param.unit === "s"
                              ? " s"
                              : param.unit === "m"
                                ? " m"
                                : "/s"}
                        </span>
                      </div>
                      <Slider
                        className="mt-1"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={[entry.params[param.id] ?? param.fallback]}
                        onValueChange={([next]) =>
                          setParam(preset.id, param.id, next)
                        }
                        aria-label={`${preset.label}: ${param.label}`}
                      />
                    </div>
                  ))
                : null}
            </div>
          );
        })}

        {applied.some((entry) => !presetById(entry.presetId)) ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            This unit also has an animation this build does not know. It is left
            alone rather than dropped.
          </p>
        ) : null}
      </div>
    </div>
  );
}
