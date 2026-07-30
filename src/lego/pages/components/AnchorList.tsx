/**
 * The snap anchors a piece carries, and the two ways to add one.
 *
 * Clicking the model is the way that matters: the parts this exists for are
 * curved, and the seat is somewhere you can see but could not have guessed the
 * coordinates of. The fields are for afterwards, and for anyone without a
 * pointer, who adds one at the origin and types it into place.
 */

import { Button, Input } from "@picoframe/frame";
import { Crosshair, Plus, Trash2 } from "lucide-react";

import { ButtonGroup } from "@/components/ui/button-group";
import type { LegoAnchor, LegoPiece } from "../../model";
import { Vec3Row } from "./TransformFields";

interface Props {
  piece: LegoPiece;
  /** Whether the next click on the model drops an anchor. */
  placing: boolean;
  onPlacingChange: (placing: boolean) => void;
  /** Add one at the piece's own origin, to be typed into place. */
  onAddAtOrigin: () => void;
  onChange: (anchorId: string, change: Partial<Omit<LegoAnchor, "id">>) => void;
  onRemove: (anchorId: string) => void;
}

export function AnchorList({
  piece,
  placing,
  onPlacingChange,
  onAddAtOrigin,
  onChange,
  onRemove,
}: Props) {
  const anchors = piece.customAnchors ?? [];

  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">Snap anchors</span>
      <ButtonGroup className="mt-1 flex w-full">
        <Button
          size="sm"
          variant={placing ? "default" : "outline"}
          className="flex-1"
          onClick={() => onPlacingChange(!placing)}
          aria-pressed={placing}
        >
          <Crosshair size={14} /> {placing ? "Click the model" : "On the model"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={onAddAtOrigin}
        >
          <Plus size={14} /> At the origin
        </Button>
      </ButtonGroup>

      {anchors.map((anchor) => (
        <div
          key={anchor.id}
          className="mt-2 rounded-md border border-border px-2 py-1.5"
        >
          <div className="flex items-center gap-1">
            <Input
              value={anchor.name}
              onChange={(event) =>
                onChange(anchor.id, { name: event.target.value })
              }
              aria-label="Anchor name"
              className="h-7 flex-1 text-xs"
            />
            <Button
              size="icon"
              variant="ghost"
              className="size-7 shrink-0"
              onClick={() => onRemove(anchor.id)}
              aria-label={`Remove ${anchor.name}`}
              title="Remove this anchor"
            >
              <Trash2 size={12} />
            </Button>
          </div>
          <Vec3Row
            label="Position"
            values={anchor.position}
            onCommit={(axis, value) => {
              const position: [number, number, number] = [...anchor.position];
              position[axis] = value;
              onChange(anchor.id, { position });
            }}
          />
        </div>
      ))}

      <p className="mt-1 text-xs text-muted-foreground">
        Where this piece seats against its neighbours, in the part's own space.
        While it has any of its own, they are the only ones it offers: the
        fifteen from its box are a guess, and on a curved part the guess is
        wrong.
      </p>
    </div>
  );
}
