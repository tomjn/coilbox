import { Button } from "@picoframe/frame";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
} from "lucide-react";
import { type ComponentType, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Axis, Edge } from "../../align";
import { transformRoots } from "../../groupTransform";
import { type LegoProject, pieceById } from "../../model";
import { parentOptions } from "../../reparent";

const AXES: Axis[] = ["x", "y", "z"];
const EDGES: Edge[] = ["low", "middle", "high"];

/** Low, middle and high read differently on the vertical axis. */
const ALIGN_ICONS: Record<Axis, ComponentType<{ className?: string }>[]> = {
  x: [AlignStartVertical, AlignCenterVertical, AlignEndVertical],
  y: [AlignEndHorizontal, AlignCenterHorizontal, AlignStartHorizontal],
  z: [AlignStartVertical, AlignCenterVertical, AlignEndVertical],
};

/** Radix needs a non-empty value, and "they do not agree" needs one of its own. */
const MIXED_PARENT = "mixed";

/**
 * The panel for a set: what is in it, and the one thing that can be said about
 * all of it at once.
 *
 * No name, transform, pivot, role or anchor list, because those are one
 * piece's answers and three pieces do not have one between them. A field
 * showing the last-clicked piece's name in a panel headed "3 pieces" would
 * invite an edit that only landed on one of them. What is left is what a set
 * genuinely shares: what carries it, and the gizmo in the viewport.
 */
export function SetPanel({
  project,
  selectedIds,
  onSelect,
  onReparent,
  onAlign,
  onDistribute,
}: {
  project: LegoProject;
  selectedIds: string[];
  onSelect: (pieceId: string) => void;
  onReparent: (parentId: string, pieceIds: string[]) => void;
  /** Each answers the names of the joined pieces the move freed. */
  onAlign: (axis: Axis, edge: Edge) => string[];
  onDistribute: (axis: Axis) => string[];
}) {
  const [freed, setFreed] = useState<{ names: string[]; of: string } | null>(
    null,
  );
  const selection = selectedIds.join(",");
  const say = (names: string[]) => setFreed({ names, of: selection });
  const roots = transformRoots(project, selectedIds);
  const parents = new Set(
    roots.map((id) => pieceById(project, id)?.parentId ?? project.rootPieceId),
  );
  const shared = parents.size === 1 ? [...parents][0] : MIXED_PARENT;

  return (
    <div className="max-h-[55%] min-h-0 overflow-y-auto border-t border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">
        {selectedIds.length} pieces selected
      </p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {selectedIds.map((pieceId) => {
          const piece = pieceById(project, pieceId);
          if (!piece) return null;
          return (
            <li key={pieceId}>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => onSelect(pieceId)}
                title={`Select ${piece.name} on its own`}
              >
                {piece.name}
              </Button>
            </li>
          );
        })}
      </ul>

      {roots.length > 0 ? (
        <div className="mt-2">
          <span className="text-xs text-muted-foreground">Hangs off</span>
          <Select
            value={shared}
            onValueChange={(parentId) => onReparent(parentId, roots)}
          >
            <SelectTrigger
              size="sm"
              className="mt-1 w-full"
              aria-label="Parent piece"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shared === MIXED_PARENT ? (
                <SelectItem value={MIXED_PARENT} disabled>
                  Several
                </SelectItem>
              ) : null}
              {parentOptions(project, roots).map(({ piece, depth }) => (
                <SelectItem
                  key={piece.id}
                  value={piece.id}
                  style={{ paddingLeft: 8 + depth * 12 }}
                >
                  {piece.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {roots.length > 1 ? (
        <div className="mt-2 space-y-1">
          {AXES.map((axis) => (
            <div key={axis} className="flex items-center gap-1">
              <span className="w-8 text-xs uppercase text-muted-foreground">
                {axis}
              </span>
              {EDGES.map((edge, i) => {
                const Icon = ALIGN_ICONS[axis][i];
                const label = `Align ${axis.toUpperCase()} ${edge}`;
                return (
                  <Button
                    key={edge}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2"
                    aria-label={label}
                    title={`${label}. A piece with no shape lines up by its origin.`}
                    onClick={() => say(onAlign(axis, edge))}
                  >
                    <Icon className="size-3.5" />
                  </Button>
                );
              })}
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2"
                aria-label={`Distribute ${axis.toUpperCase()}`}
                title={`Distribute ${axis.toUpperCase()}: equal gaps, ends stay. Needs 3 pieces.`}
                disabled={roots.length < 3}
                onClick={() => say(onDistribute(axis))}
              >
                {axis === "y" ? (
                  <AlignVerticalSpaceBetween className="size-3.5" />
                ) : (
                  <AlignHorizontalSpaceBetween className="size-3.5" />
                )}
              </Button>
            </div>
          ))}
          {freed && freed.of === selection && freed.names.length > 0 ? (
            <p role="status" className="text-xs text-muted-foreground">
              Detached: {freed.names.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        Moving, turning or scaling this set works on each piece about the middle
        of the set, so it keeps its shape. A piece already carried by another in
        the set is left to its parent.
      </p>
    </div>
  );
}
