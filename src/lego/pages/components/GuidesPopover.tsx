/**
 * The guide planes' panel (issue #3318): add one by axis and offset or by
 * clicking the model, then rename, move, hide or delete it.
 *
 * A popover in the view's own controls, not a dialog, so the model stays in
 * view while a guide is being placed.
 */

import { Button, Input } from "@picoframe/frame";
import { Eye, EyeOff, MousePointerClick, Ruler, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { addGuide, removeGuide, updateGuide } from "../../guides";
import {
  GUIDE_AXES,
  type GuideAxis,
  type LegoGuide,
  type LegoProject,
} from "../../model";
import { AXES, NumberField } from "./TransformFields";

interface Props {
  guides: LegoGuide[];
  /** One edit of the unit, so it is one step of undo. */
  onEdit: (edit: (project: LegoProject) => LegoProject) => void;
  /** The axis the next click on the model places a guide on, or null. */
  picking: GuideAxis | null;
  onPick: (axis: GuideAxis | null) => void;
}

const AXIS_COLOUR = Object.fromEntries(
  AXES.map((axis) => [axis.label.toLowerCase(), axis.colour]),
) as Record<GuideAxis, string>;

export function GuidesPopover({ guides, onEdit, picking, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [axis, setAxis] = useState<GuideAxis>("x");
  const [offset, setOffset] = useState("0");

  const parsed = Number.parseFloat(offset);

  function add() {
    if (!Number.isFinite(parsed)) return;
    onEdit((project) =>
      addGuide(project, {
        id: crypto.randomUUID(),
        name: `${axis} = ${parsed}`,
        axis,
        offset: parsed,
      }),
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          title="Guides"
          aria-label="Guides"
          aria-pressed={picking !== null}
        >
          <Ruler className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 space-y-3">
        {guides.length > 0 ? (
          <ul className="space-y-1">
            {guides.map((guide) => (
              <GuideRow
                key={guide.id}
                guide={guide}
                onChange={(change) =>
                  onEdit((project) => updateGuide(project, guide.id, change))
                }
                onRemove={() =>
                  onEdit((project) => removeGuide(project, guide.id))
                }
              />
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-1">
          {GUIDE_AXES.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={axis === a ? "default" : "outline"}
              aria-pressed={axis === a}
              aria-label={`${a.toUpperCase()} axis`}
              onClick={() => setAxis(a)}
              className="w-8 px-0"
            >
              {a.toUpperCase()}
            </Button>
          ))}
          <Input
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            inputMode="decimal"
            aria-label="Offset"
            className="h-8 min-w-0 flex-1 text-right text-xs"
          />
          <Button size="sm" onClick={add} disabled={!Number.isFinite(parsed)}>
            Add
          </Button>
          <Button
            size="icon"
            variant={picking ? "default" : "outline"}
            title="Click the model to place it"
            aria-label="Click the model to place it"
            aria-pressed={picking !== null}
            onClick={() => {
              onPick(picking ? null : axis);
              setOpen(false);
            }}
          >
            <MousePointerClick className="size-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GuideRow({
  guide,
  onChange,
  onRemove,
}: {
  guide: LegoGuide;
  onChange: (change: Partial<Omit<LegoGuide, "id">>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(guide.name);
  useEffect(() => setName(guide.name), [guide.name]);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed === "") setName(guide.name);
    else if (trimmed !== guide.name) onChange({ name: trimmed });
  }

  return (
    <li className="flex items-center gap-1">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setName(guide.name);
        }}
        aria-label={`Name of ${guide.name}`}
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <div className="w-20 shrink-0">
        <NumberField
          value={guide.offset}
          axis={guide.axis.toUpperCase()}
          colour={AXIS_COLOUR[guide.axis]}
          label={`Offset of ${guide.name}`}
          onCommit={(offset) => onChange({ offset })}
        />
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        title={guide.hidden ? "Show" : "Hide"}
        aria-label={`${guide.hidden ? "Show" : "Hide"} ${guide.name}`}
        onClick={() => onChange({ hidden: !guide.hidden })}
      >
        {guide.hidden ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-7"
        title="Delete"
        aria-label={`Delete ${guide.name}`}
        onClick={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
