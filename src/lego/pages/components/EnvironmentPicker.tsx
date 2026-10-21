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

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Mountain } from "lucide-react";
import { useEffect, useState } from "react";
import { CheckField, Field as LabelledField } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useUnitDefs } from "@/workshop/config";
import {
  BACKDROPS,
  type BackdropId,
  backdropById,
  GROUND_SURFACES,
  type GroundChoice,
  type GroundId,
  type GroundShape,
  groundById,
  MIN_BUMP_WIDTH,
  validGroundDegrees,
} from "../../environment";
import type { LegoMovement } from "../../model";
import { slopeVerdict } from "../../movement";
import { useTestGame } from "./useTestGame";

const ITEM_CLASS =
  "rounded-md border border-border/60 px-3 py-1 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10";

export function EnvironmentPicker({
  backdrop,
  onBackdrop,
  ground,
  onGround,
  shape,
  movement,
}: {
  backdrop: BackdropId;
  onBackdrop: (id: BackdropId) => void;
  ground: GroundChoice;
  onGround: (choice: GroundChoice) => void;
  /** What the choice draws, null for a flat ground. */
  shape: GroundShape | null;
  /** The unit's movement class, absent for a unit that does not move. */
  movement?: LegoMovement;
}) {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          title={t`Backdrop and ground`}
          aria-label={t`Backdrop and ground`}
        >
          <Mountain className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 space-y-3">
        <Field label={t`Backdrop`} hint={backdropById(backdrop).hint}>
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

        <Field label={t`Ground`} hint={groundById(ground.id).hint}>
          <ToggleGroup
            type="single"
            value={ground.id}
            onValueChange={(value) =>
              value && onGround({ ...ground, id: value as GroundId })
            }
            className="flex-wrap justify-start gap-2"
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

        {shape && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <NumberField
                label={t`Angle (°)`}
                value={ground.degrees}
                valid={validGroundDegrees}
                onCommit={(degrees) =>
                  degrees !== null && onGround({ ...ground, degrees })
                }
              />
              {shape.kind === "uneven" && (
                <NumberField
                  label={t`Width (elmos)`}
                  value={ground.width}
                  placeholder={String(shape.width)}
                  valid={(width) =>
                    Number.isFinite(width) && width >= MIN_BUMP_WIDTH
                  }
                  onCommit={(width) => onGround({ ...ground, width })}
                />
              )}
            </div>
            {movement && (
              <SlopeVerdict movement={movement} degrees={ground.degrees} />
            )}
            <CheckField
              label={t`Upright`}
              checked={ground.upright}
              onChange={(upright) => onGround({ ...ground, upright })}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          <Trans>
            A view setting. Neither one is saved with the unit or exported.
          </Trans>
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** Whether the unit's class climbs the slope drawn. Reads the game only once
 *  the unit has a class, so a static unit asks for nothing. */
function SlopeVerdict({
  movement,
  degrees,
}: {
  movement: LegoMovement;
  degrees: number;
}) {
  const { target, game } = useTestGame();
  const { defs, defsFor } = useUnitDefs(
    target?.enginePath,
    target?.dataDir,
    game?.primaryArchive.name,
  );
  const read =
    defs && defsFor === game?.primaryArchive.name
      ? { moveDefs: defs.moveDefs }
      : null;
  const verdict = slopeVerdict(movement, read, degrees);
  if (!verdict) return null;
  return <p className="text-xs text-muted-foreground">{verdict}</p>;
}

/**
 * A number typed in, committed only once it is one the ground can take. Held
 * as text while it is typed, so a half-typed number is not thrown back.
 * Emptying it commits null, which for the bump width means following the
 * unit's footprint again.
 */
function NumberField({
  label,
  value,
  placeholder,
  valid,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  valid: (value: number) => boolean;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((current) =>
      (current === "" ? null : Number(current)) === value
        ? current
        : value === null
          ? ""
          : String(value),
    );
  }, [value]);
  const parsed = text.trim() === "" ? null : Number(text);
  const ok = parsed === null || valid(parsed);
  return (
    <LabelledField label={label} className="min-w-0 flex-1 text-xs">
      <Input
        type="number"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-invalid={!ok}
        className="h-7 text-xs"
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          const number = next.trim() === "" ? null : Number(next);
          if (number === null || valid(number)) onCommit(number);
        }}
      />
    </LabelledField>
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
