/**
 * The blueprint editor's terrain tools (issue #4793): the Terrain button, the
 * toolbar it shows with the four tools and the game's Terrain changes switch,
 * and the buttons beside a selected step.
 *
 * Only controls. What a tool does on the ground is `useTerrainEditing.ts`, and
 * every edit these make goes through the shared rules in
 * `@/lib/scenarioEditing/terrain.ts`.
 */

import { t as coreT } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import {
  BrickWall,
  Check,
  Mountain,
  Square,
  Trash2,
  TrendingUp,
  Waves,
  X,
} from "lucide-react";
import { useId } from "react";

import type { TerrainStep } from "@/blueprint/model";
import type { StepLimit } from "@/blueprint/terraform";
import type { DraftSettings } from "@/blueprint/terrainDraft";
import type { TerrainTool } from "@/blueprint/terrainEdit";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { StepPatch } from "@/lib/scenarioEditing/terrain";
import { useFieldText } from "@/lib/useFieldText";

/** What a tool is called, on its button and on the Terrain button while it is
 *  the one in use. */
export function toolName(tool: TerrainTool): string {
  switch (tool) {
    case "wall":
      return coreT`Wall`;
    case "area":
      return coreT`Area`;
    case "ramp":
      return coreT`Ramp`;
    case "smooth":
      return coreT`Smooth`;
  }
}

/** What a step is called in the build order and beside it when selected. */
export function stepName(step: Pick<TerrainStep, "kind" | "shape">): string {
  if (step.kind === "ramp") return coreT`Ramp`;
  if (step.kind === "smooth") return coreT`Smooth`;
  if (step.shape === "wall") {
    return step.kind === "raise" ? coreT`Raised wall` : coreT`Level wall`;
  }
  return step.kind === "raise" ? coreT`Raised area` : coreT`Level area`;
}

/** Why a step was not made, for the note the editor shows. */
export function limitText(limit: StepLimit): string {
  switch (limit) {
    case "points":
      return coreT`Zero-K refuses a terrain change of more than 2,500 points.`;
    case "wall":
      return coreT`Zero-K refuses a wall that long. It allows 700 points, a point every 16 elmos.`;
    case "area":
      return coreT`Zero-K refuses an area wider or deeper than 2,000 elmos.`;
    case "ramp":
      return coreT`Zero-K refuses a ramp shorter than 64 or longer than 3,000 elmos, or narrower than 48 or wider than 1,600.`;
  }
}

const TOOLS: { tool: TerrainTool; icon: typeof Square }[] = [
  { tool: "wall", icon: BrickWall },
  { tool: "area", icon: Square },
  { tool: "ramp", icon: TrendingUp },
  { tool: "smooth", icon: Waves },
];

/**
 * The Terrain button beside Pick a unit. It is a toggle: on, the terrain
 * toolbar shows under the editor's own, and nothing pops up.
 */
export function TerrainToolsButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      variant={open ? "secondary" : "ghost"}
      className="h-8 gap-1.5 px-2 text-xs"
      aria-pressed={open}
      onClick={() => onOpen(!open)}
    >
      <Mountain className="size-3.5 shrink-0" />
      <Trans>Terrain</Trans>
    </Button>
  );
}

/** A number in elmos, typed and committed when the box is left. */
function ElmoField({
  label,
  value,
  onCommit,
  min,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useFieldText(String(value));
  const commit = () => {
    const read = Number(text);
    if (text.trim() !== "" && Number.isFinite(read) && read !== value) {
      onCommit(read);
    }
    // Back to the step's own value. A change that took arrives as the new
    // value, and one the game would refuse leaves the old one showing.
    setText(String(value));
  };
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        disabled={disabled}
        step={8}
        min={min}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-7 w-16 text-xs"
      />
    </span>
  );
}

/**
 * The buttons beside a selected step, the way a selected building has Turn
 * and Delete. A level or ramp also has Both ways, Only
 * raise and Only lower (issue #4804).
 */
export function TerrainStepBar({
  step,
  number,
  onChange,
  onDelete,
}: {
  step: TerrainStep;
  /** Where it is in the build order, counting from 1. */
  number: number;
  onChange: (patch: StepPatch) => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const heightened = step.kind === "raise" || step.kind === "level";
  const choosing = step.kind === "level" || step.kind === "ramp";
  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card p-1 pl-2">
      <span className="text-[11px]">
        {stepName(step)}
        <span className="ml-1.5 text-muted-foreground">
          {t`step ${number} of the build order`}
        </span>
      </span>
      {heightened && (
        <>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={step.kind}
            onValueChange={(value) =>
              value && onChange({ kind: value as "raise" | "level" })
            }
            aria-label={t`Raise or level`}
          >
            <ToggleGroupItem value="raise" className="h-7 px-2 text-xs">
              <Trans>Raise</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="level" className="h-7 px-2 text-xs">
              <Trans>Level</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <ElmoField
            label={t`Height`}
            value={step.height ?? 0}
            onCommit={(height) => onChange({ height })}
          />
        </>
      )}
      {step.kind === "ramp" && (
        <>
          <ElmoField
            label={t`Width`}
            value={step.width ?? 0}
            min={48}
            onCommit={(width) => onChange({ width })}
          />
          <ElmoField
            label={t`Low end`}
            value={step.heights?.[0] ?? 0}
            onCommit={(low) =>
              onChange({ heights: [low, step.heights?.[1] ?? 0] })
            }
          />
          <ElmoField
            label={t`High end`}
            value={step.heights?.[1] ?? 0}
            onCommit={(high) =>
              onChange({ heights: [step.heights?.[0] ?? 0, high] })
            }
          />
        </>
      )}
      {choosing && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={step.only ?? "both"}
          onValueChange={(value) =>
            value && onChange({ only: value as "both" | "raise" | "lower" })
          }
          aria-label={t`Which way the ground changes`}
        >
          <ToggleGroupItem value="both" className="h-7 px-2 text-xs">
            <Trans>Both ways</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="raise" className="h-7 px-2 text-xs">
            <Trans>Only raise</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="lower" className="h-7 px-2 text-xs">
            <Trans>Only lower</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" /> <Trans>Delete</Trans>
      </Button>
    </div>
  );
}

/**
 * The terrain toolbar, shown while the Terrain button is on: the four tools,
 * what the step being drawn will be made with, and Done and Cancel. No tool is
 * pressed until one is picked. The settings apply to the step being drawn, so
 * they can be set before the first click and changed part way through.
 *
 * The game's Terrain changes switch is in the blueprint page's header, the
 * one place it is offered there.
 */
export function TerrainDraftBar({
  tool,
  onTool,
  settings,
  onSettings,
  drawing,
  onDone,
  onCancel,
}: {
  tool: TerrainTool | null;
  onTool: (tool: TerrainTool | null) => void;
  settings: DraftSettings;
  onSettings: (settings: Partial<DraftSettings>) => void;
  /** Whether part of a step has been drawn, which is what Done makes. */
  drawing: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  // With no tool picked, Raise or Level and Height show disabled, so the bar
  // does not change shape when one is.
  const heightened = tool === "wall" || tool === "area" || tool === null;
  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-card p-1">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={tool ?? ""}
        onValueChange={(value) => onTool((value || null) as TerrainTool | null)}
        aria-label={t`Terrain tools`}
      >
        {TOOLS.map(({ tool: one, icon: Icon }) => (
          <ToggleGroupItem
            key={one}
            value={one}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Icon className="size-3.5" />
            {toolName(one)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {heightened && (
        <>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={settings.kind}
            onValueChange={(value) =>
              value && onSettings({ kind: value as "raise" | "level" })
            }
            aria-label={t`Raise or level`}
            disabled={!tool}
          >
            <ToggleGroupItem value="raise" className="h-7 px-2 text-xs">
              <Trans>Raise</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="level" className="h-7 px-2 text-xs">
              <Trans>Level</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <ElmoField
            label={t`Height`}
            value={settings.height}
            onCommit={(height) => onSettings({ height })}
            disabled={!tool}
          />
        </>
      )}
      {tool === "ramp" && (
        <>
          <ElmoField
            label={t`Width`}
            value={settings.width}
            min={48}
            onCommit={(width) => onSettings({ width })}
          />
          <ElmoField
            label={t`Low end`}
            value={settings.heights[0]}
            onCommit={(low) =>
              onSettings({ heights: [low, settings.heights[1]] })
            }
          />
          <ElmoField
            label={t`High end`}
            value={settings.heights[1]}
            onCommit={(high) =>
              onSettings({ heights: [settings.heights[0], high] })
            }
          />
        </>
      )}
      {/* Done and Cancel only mean different things while a step is being
          drawn. Before the first click both put the tool down, so that is the
          one button. */}
      {drawing ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onDone}
          >
            <Check className="size-3.5" /> <Trans>Done</Trans>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onCancel}
          >
            <X className="size-3.5" /> <Trans>Cancel</Trans>
          </Button>
        </>
      ) : (
        tool && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onCancel}
          >
            <X className="size-3.5" /> <Trans>Close tool</Trans>
          </Button>
        )
      )}
    </div>
  );
}
