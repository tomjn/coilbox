/**
 * The connectors a piece carries, and the two ways to add one.
 *
 * A connector is a place another part can join, with a name, a position, the
 * way out of the part and an up direction that fixes the twist. Clicking the
 * model is the way that matters: the parts this exists for are curved, and the
 * seat is somewhere you can see but could not have guessed the coordinates of.
 * It takes its facing from the face clicked. The fields are for afterwards, and
 * for anyone without a pointer, who adds one at the origin and types it into
 * place.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Crosshair, Plus, Trash2 } from "lucide-react";

import { ButtonGroup } from "@/components/ui/button-group";
import type { LegoConnector } from "../../connectors";
import type { LegoAnchor, LegoPiece } from "../../model";
import { Vec3Row } from "./TransformFields";

type Vec3 = [number, number, number];

/** One component of a direction changed, kept at unit length. A change that
 *  would leave no direction at all is dropped. */
function turned(values: Vec3, axis: number, value: number): Vec3 | null {
  const next: Vec3 = [...values];
  next[axis] = value;
  const length = Math.hypot(...next);
  if (length === 0) return null;
  return [next[0] / length, next[1] / length, next[2] / length];
}

interface Props {
  piece: LegoPiece;
  /** The piece's connectors as they resolve, so an anchor saved without a
   *  facing still shows the one it is using. */
  connectors: LegoConnector[];
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
  connectors,
  placing,
  onPlacingChange,
  onAddAtOrigin,
  onChange,
  onRemove,
}: Props) {
  const { t } = useLingui();
  const anchors = piece.customAnchors ?? [];

  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">
        <Trans>Connectors</Trans>
      </span>
      <ButtonGroup className="mt-1 flex w-full">
        <Button
          size="sm"
          variant={placing ? "default" : "outline"}
          className="flex-1"
          onClick={() => onPlacingChange(!placing)}
          aria-pressed={placing}
        >
          <Crosshair size={14} />{" "}
          {placing ? (
            <Trans>Click the model</Trans>
          ) : (
            <Trans>On the model</Trans>
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={onAddAtOrigin}
        >
          <Plus size={14} /> <Trans>At the origin</Trans>
        </Button>
      </ButtonGroup>

      {anchors.map((anchor) => {
        const anchorName = anchor.name;
        return (
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
                aria-label={t`Connector name`}
                className="h-7 flex-1 text-xs"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                onClick={() => onRemove(anchor.id)}
                aria-label={t`Remove ${anchorName}`}
                title={t`Remove this connector`}
              >
                <Trash2 size={12} />
              </Button>
            </div>
            <Vec3Row
              label={t`Position`}
              values={anchor.position}
              onCommit={(axis, value) => {
                const position: [number, number, number] = [...anchor.position];
                position[axis] = value;
                onChange(anchor.id, { position });
              }}
            />
            <Direction
              label={t`Facing`}
              values={connectors.find((c) => c.id === anchor.id)?.facing}
              onChange={(facing) => onChange(anchor.id, { facing })}
            />
            <Direction
              label={t`Up`}
              values={connectors.find((c) => c.id === anchor.id)?.up}
              onChange={(up) => onChange(anchor.id, { up })}
            />
          </div>
        );
      })}
    </div>
  );
}

function Direction({
  label,
  values,
  onChange,
}: {
  label: string;
  values: Vec3 | undefined;
  onChange: (values: Vec3) => void;
}) {
  if (!values) return null;
  return (
    <Vec3Row
      label={label}
      values={values}
      onCommit={(axis, value) => {
        const next = turned(values, axis, value);
        if (next) onChange(next);
      }}
    />
  );
}
