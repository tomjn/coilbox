/**
 * What is behind the unit and what it stands on, as one button in the viewport's
 * camera group.
 *
 * A popover rather than more buttons in that group: it already holds the grid,
 * the reference unit, the shortcuts and the compass, and two more rows of
 * choices along the bottom edge would start eating the view. One button opens
 * them, and they close again.
 *
 * The sky and the ground are separate rows because they are separate surfaces.
 * See `environment.ts`.
 */

import { Button } from "@picoframe/frame";
import { Mountain } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  BACKDROPS,
  type BackdropId,
  backdropById,
  GROUND_SURFACES,
  type GroundId,
  groundById,
} from "../../environment";

const ITEM_CLASS =
  "rounded-md border border-border/60 px-3 py-1 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10";

export function EnvironmentPicker({
  backdrop,
  onBackdrop,
  ground,
  onGround,
}: {
  backdrop: BackdropId;
  onBackdrop: (id: BackdropId) => void;
  ground: GroundId;
  onGround: (id: GroundId) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          title="Backdrop and ground"
          aria-label="Backdrop and ground"
        >
          <Mountain className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 space-y-3">
        <Field label="Backdrop" hint={backdropById(backdrop).hint}>
          <ToggleGroup
            type="single"
            value={backdrop}
            onValueChange={(value) => value && onBackdrop(value as BackdropId)}
            className="justify-start gap-2"
          >
            {BACKDROPS.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                className={ITEM_CLASS}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <Field label="Ground" hint={groundById(ground).hint}>
          <ToggleGroup
            type="single"
            value={ground}
            onValueChange={(value) => value && onGround(value as GroundId)}
            className="justify-start gap-2"
          >
            {GROUND_SURFACES.map((option) => (
              <ToggleGroupItem
                key={option.id}
                value={option.id}
                className={ITEM_CLASS}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <p className="text-xs text-muted-foreground">
          A view setting. Neither one is saved with the unit or exported.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** A row of choices, with what the chosen one is for underneath. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
