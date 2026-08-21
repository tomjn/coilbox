import { Button } from "@picoframe/frame";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { transformRoots } from "../../groupTransform";
import { type LegoProject, pieceById } from "../../model";
import { parentOptions } from "../../reparent";

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
}: {
  project: LegoProject;
  selectedIds: string[];
  onSelect: (pieceId: string) => void;
  onReparent: (parentId: string, pieceIds: string[]) => void;
}) {
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

      <p className="mt-2 text-xs text-muted-foreground">
        Moving, turning or scaling this set works on each piece about the middle
        of the set, so it keeps its shape. A piece already carried by another in
        the set is left to its parent.
      </p>
    </div>
  );
}
