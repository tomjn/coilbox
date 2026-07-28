/**
 * Apply canned animations to a unit and watch them run.
 *
 * A preset can only be applied once its roles are filled, and the reason it
 * cannot is named rather than left as a greyed-out button. Playback changes
 * nothing in the document: stopping restores the built pose exactly.
 */

import { Button } from "@picoframe/frame";
import { Pause, Play } from "lucide-react";

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
import type { LegoProject } from "../../model";

interface Props {
  project: LegoProject;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onChange: (applied: AppliedPreset[]) => void;
}

export function AnimationPanel({
  project,
  playing,
  onPlayingChange,
  onChange,
}: Props) {
  const reduceMotion = useReduceMotion();
  const applied = project.animations ?? [];
  const counts = countRoles(project.pieces);

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
      </div>

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
