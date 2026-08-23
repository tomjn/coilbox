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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { animCobRun } from "../../../animation/bindings";
import { useReduceMotion } from "../../../general/display";
import {
  type AppliedPreset,
  countRoles,
  PRESETS,
  type PresetParam,
  presetById,
  roleLabel,
  unmetRequirements,
} from "../../animPresets";
import { legoRunScript } from "../../bindings";
import {
  DEFAULT_BUILDER,
  type LegoBuilder,
  type LegoProject,
} from "../../model";
import {
  clampFrame,
  PREVIEW_FRAMES,
  PREVIEW_SECONDS,
  playable,
  SCENARIOS,
  type ScriptTimeline,
  scenarioById,
} from "../../scriptPlayback";
import { isBuilder } from "../../unitDef";
import { ScriptDrawer } from "./ScriptDrawer";

/**
 * What each parameter's number is measured in, beside the slider.
 *
 * A map rather than a chain of ternaries, because the chain ended in a bare
 * `/s` that stood for turns per second and quietly claimed every unit added
 * after it. `deg/s` came out as `/s` with the degrees lost.
 */
const PARAM_SUFFIX: Record<PresetParam["unit"], string> = {
  deg: "°",
  s: " s",
  m: " m",
  hz: "/s",
  "deg/s": "°/s",
};

/**
 * The two numbers a builder is worth, as sliders.
 *
 * `canAssist` is not here because it is a switch rather than a number, and the
 * two ranges are the engine's own: `buildDistance` defaults to 128 and is
 * clamped up to 38, `workerTime` defaults to zero, which is the number that
 * makes a builder silently not one.
 */
const BUILDER_FIELDS: {
  id: "workerTime" | "buildDistance";
  label: string;
  suffix: string;
  min: number;
  max: number;
  step: number;
  note: string;
}[] = [
  {
    id: "workerTime",
    label: "Work rate",
    suffix: "",
    min: 10,
    max: 2000,
    step: 10,
    note: "Writes workerTime, which is also the repair, reclaim and capture speed unless a definition sets those separately.",
  },
  {
    id: "buildDistance",
    label: "Build distance",
    suffix: " elmos",
    min: 38,
    max: 1000,
    step: 8,
    note: "How far it reaches. The engine clamps anything under 38, which is the least that keeps a one by one builder clear of a one by one building.",
  },
];

interface Props {
  project: LegoProject;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onChange: (applied: AppliedPreset[]) => void;
  /** Stores the unit's own Lua. The first call is the unit taking it over. */
  onScriptChange: (script: string) => void;
  /** Drops the stored Lua, putting the unit back on the presets below. */
  onScriptRelease: () => void;
  /** What the unit builds with, written into its definition. Only asked for
   *  when the unit has a build arm on it. */
  onBuilderChange: (builder: LegoBuilder) => void;
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
  onScriptRelease,
  onBuilderChange,
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
  // The compiled file the unit's game shipped, when that is what animates it.
  // Text somebody owns beats the file they came in with, so a unit that has
  // taken a script over is past this even if it still carries the bytecode.
  const compiled = owned ? undefined : project.compiledScript;
  /** Whether this unit animates from a script of its own rather than presets. */
  const playsOwnScript = owned || compiled !== undefined;

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
      if (script === undefined && !compiled) return;
      setRunning(true);
      setFailure(null);
      try {
        const pieces = project.pieces.map((piece) => piece.name);
        const events = scenarioById(scenario)?.events ?? [];
        // Two runtimes, one timeline. The compiled one runs the bytecode the
        // game shipped and reports the same poses the Lua one does.
        const result = compiled
          ? await animCobRun({
              bytes: compiled.bytes,
              pieces,
              events,
              frames: PREVIEW_FRAMES,
            })
          : await legoRunScript({
              script: script ?? "",
              unitName: project.unitName,
              pieces,
              events,
              frames: PREVIEW_FRAMES,
              // A script may read its own definition, and without it those
              // scripts throw at load rather than losing a branch (#1936).
              unitDef: project.gameUnitDef ?? null,
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
      project.gameUnitDef,
      compiled,
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
      onScriptRelease={onScriptRelease}
    />
  );

  if (playsOwnScript) {
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
          {owned ? (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => setShowScript(true)}
            >
              <FileCode size={14} /> Edit
            </Button>
          ) : null}
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

        {owned ? scriptDrawer : null}

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

          {compiled ? (
            <p className="text-xs text-muted-foreground">
              This unit's game animates it with{" "}
              <code className="break-all">{compiled.member}</code>, which is
              compiled rather than Lua. Coilbox runs it, so what you see is what
              the game plays. It cannot be edited here and an export does not
              write it.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The presets wrote this unit's script once and are done with it.
              This plays the script itself, so what you see is what the file
              says.
            </p>
          )}
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
        {/* Labelled rather than an icon on its own. This is the only way to
            read the generated script, and as a bare glyph in the corner it was
            missed by people who went looking for exactly that. */}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => setShowScript(true)}
          title="The animation script these presets generate"
        >
          <FileCode size={14} /> Script
        </Button>
      </div>

      {scriptDrawer}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Above the presets, because it is what makes them mean anything: a
            unit with a build arm and no builder keys animates a job it can
            never be given. Only for a unit that has one, since the roles are
            what say this unit builds. */}
        {isBuilder(project) ? (
          <div className="border-b border-border/60 px-3 py-2">
            <p className="text-sm font-medium">What it builds with</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This unit has a build arm, so its definition is written as a
              builder. All three go together: the engine reads a builder with no
              work rate as not a builder at all.
            </p>

            {BUILDER_FIELDS.map((field) => (
              <div key={field.id} className="mt-2">
                <div className="flex items-center justify-between text-xs">
                  <span>{field.label}</span>
                  <span className="text-muted-foreground">
                    {project.builder?.[field.id] ?? DEFAULT_BUILDER[field.id]}
                    {field.suffix}
                  </span>
                </div>
                <Slider
                  className="mt-1"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={[
                    project.builder?.[field.id] ?? DEFAULT_BUILDER[field.id],
                  ]}
                  onValueChange={([next]) =>
                    onBuilderChange({ ...project.builder, [field.id]: next })
                  }
                  aria-label={field.label}
                />
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {field.note}
                </p>
              </div>
            ))}

            <div className="mt-3 flex items-center justify-between gap-3">
              <Label htmlFor="builder-assist" className="text-xs font-medium">
                Can help another unit's build
              </Label>
              <Switch
                id="builder-assist"
                checked={
                  project.builder?.canAssist ?? DEFAULT_BUILDER.canAssist
                }
                onCheckedChange={(on) =>
                  onBuilderChange({ ...project.builder, canAssist: on })
                }
              />
            </div>
          </div>
        ) : null}

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
                          {PARAM_SUFFIX[param.unit]}
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
