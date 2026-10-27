/**
 * The blueprint editor's terrain tools (issue #4793): the Terrain button with
 * its four tools and the game's Terrain changes switch, and the buttons beside
 * a selected step.
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
  Mountain,
  Square,
  Trash2,
  TrendingUp,
  Waves,
} from "lucide-react";
import { useId, useState } from "react";

import type { TerrainStep } from "@/blueprint/model";
import type { StepLimit } from "@/blueprint/terraform";
import type { TerrainTool } from "@/blueprint/terrainEdit";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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

/** What the line over the surface says while a tool is in use. */
export function toolHint(tool: TerrainTool): string {
  switch (tool) {
    case "wall":
      return coreT`Click points along the wall. Enter or a double click finishes it, Escape cancels.`;
    case "ramp":
      return coreT`Click the low end, then the high end. Escape cancels.`;
    default:
      return coreT`Click the corners, or drag a rectangle. Enter or a double click finishes it, Escape cancels.`;
  }
}

const TOOLS: { tool: TerrainTool; icon: typeof Square }[] = [
  { tool: "wall", icon: BrickWall },
  { tool: "area", icon: Square },
  { tool: "ramp", icon: TrendingUp },
  { tool: "smooth", icon: Waves },
];

/**
 * The Terrain button beside Pick a unit, and the tools it opens.
 *
 * The game's Terrain changes switch is in here as well, so it can be found
 * from a blueprint. Turning it off takes the button away with it, and the
 * library's game list has the switch to turn it back on.
 */
export function TerrainToolsButton({
  tool,
  onTool,
  enabled,
  onEnabled,
}: {
  tool: TerrainTool | null;
  onTool: (tool: TerrainTool | null) => void;
  enabled: boolean;
  onEnabled: (on: boolean) => void;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={tool ? "secondary" : "ghost"}
          className="h-8 gap-1.5 px-2 text-xs"
        >
          <Mountain className="size-3.5 shrink-0" />
          {tool ? t`Terrain: ${toolName(tool)}` : t`Terrain`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={tool ?? ""}
          onValueChange={(value) => {
            onTool((value || null) as TerrainTool | null);
            if (value) setOpen(false);
          }}
          aria-label={t`Terrain tools`}
          className="w-full"
        >
          {TOOLS.map(({ tool: one, icon: Icon }) => (
            <ToggleGroupItem
              key={one}
              value={one}
              className="flex-1 gap-1 text-xs"
            >
              <Icon className="size-3.5" />
              {toolName(one)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <label
            htmlFor="blueprint-terrain-changes"
            className="text-xs font-medium"
          >
            <Trans>Terrain changes in this game</Trans>
          </label>
          <Switch
            id="blueprint-terrain-changes"
            checked={enabled}
            onCheckedChange={onEnabled}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A number in elmos, typed and committed when the box is left. */
function ElmoField({
  label,
  value,
  onCommit,
  min,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
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
 * and Delete. A wrapping row, so a later choice (issue #4804) has room.
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
  onChange: (
    patch: Partial<Pick<TerrainStep, "kind" | "height" | "heights" | "width">>,
  ) => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const heightened = step.kind === "raise" || step.kind === "level";
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
