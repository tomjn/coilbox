/**
 * The scale figure standing beside what you are building: whether it is there,
 * and which unit it is. One button in the viewport's camera group, as the
 * backdrop and ground are, rather than a toggle and a picker side by side for
 * the same one thing.
 *
 * The built-in solar collector is the default and the fallback, because it is
 * the only figure everyone has: see `referenceObject.ts`. Anyone with a game
 * installed can stand one of its units there instead, which is the point of a
 * reference figure for anyone building something that is not a small building.
 *
 * The reading is done by the game unit viewer's hooks, so a model read for the
 * viewer is already in the session cache when it is picked here, and there is
 * one place that knows how to read a model. This component only picks, reports
 * what went wrong, and hands the result up to the viewport, which owns the
 * scene.
 *
 * Held for as long as the viewport is open and no longer, like the backdrop and
 * the ground: opening a project always opens on the built-in figure, so nothing
 * mounts the builder behind a unitsync read of a game.
 */

import { Button } from "@picoframe/frame";
import { SwatchBook } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type {
  UnitDatasetEntry,
  UnitModelResult,
} from "../../../content/bindings";
import {
  useUnitsyncScan,
  useUnitsyncUnitDataset,
  useUnitsyncUnitModel,
} from "../../../content/config";
import { UnitPickerButton } from "../../../content/pages/components/UnitPicker";
import { unitLabel } from "../../../content/unitChoices";
import { countTriangles } from "../../../content/unitModel";
import { withoutGeneratedGames } from "../../../lib/generatedGames";
import { usePreferredTarget } from "../../../play/config";
import { OptionSelect } from "../../../uberstress/pages/components/OptionSelect";

/** What the viewport needs to stand a unit in the scene, and what to call it. */
export interface GameReferenceChoice {
  model: UnitModelResult;
  label: string;
}

/**
 * The built-in figure, as the game list's own option. A value rather than the
 * empty string, because a select reading empty has nothing selected and shows
 * its placeholder, which would say no game is installed while the list it
 * opens is full of them.
 */
const BUILT_IN = "coilbox:built-in";

export function ReferencePicker({
  show,
  onShowChange,
  onReference,
}: {
  /** Whether the figure is in the scene at all. */
  show: boolean;
  onShowChange: (on: boolean) => void;
  /** Called with the unit to stand in the scene, or `null` to go back to the
   *  built-in solar collector. */
  onReference: (choice: GameReferenceChoice | null) => void;
}) {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const [gameName, setGameName] = useState(BUILT_IN);
  /** Empty until a unit is picked, so the select shows its placeholder. */
  const [unitName, setUnitName] = useState("");

  // Coilbox's own scratch game holds whatever was last tested, which is the
  // unit being built. Standing that beside itself measures nothing.
  const games = uniqueByName(withoutGeneratedGames(scan.data?.games ?? []));
  const game = games.find((g) => g.name === gameName);
  const archive = game?.primaryArchive.name;

  const dataset = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    archive,
  );
  const units = dataset.dataset?.units ?? [];
  const unit = units.find((u) => u.name === unitName);
  const object = unit?.objectName?.trim();

  const { model, loading, failed } = useUnitsyncUnitModel(
    target?.enginePath,
    target?.dataDir,
    archive,
    object,
  );

  // The viewport is told the moment there is something to stand, and told again
  // with nothing the moment there is not, so a game that cannot be read leaves
  // the built-in figure standing rather than an empty space.
  const onReferenceRef = useRef(onReference);
  onReferenceRef.current = onReference;
  const drawable = model?.root ? countTriangles(model.root) > 0 : false;
  useEffect(() => {
    onReferenceRef.current(
      model && drawable
        ? { model, label: unit ? unitLabel(unit) : model.path }
        : null,
    );
  }, [model, drawable, unit]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          title="A unit at its real size, for scale"
          aria-label="Reference unit"
          aria-pressed={show}
        >
          <SwatchBook className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="lego-reference-show" className="text-xs font-medium">
            Stand it beside the build
          </Label>
          <Switch
            id="lego-reference-show"
            checked={show}
            onCheckedChange={onShowChange}
          />
        </div>

        <Field label="Game">
          <OptionSelect
            value={gameName}
            onValueChange={(value) => {
              setGameName(value);
              setUnitName("");
            }}
            options={[
              { value: BUILT_IN, label: "None: solar collector" },
              ...games.map((g) => ({ value: g.name, label: g.name })),
            ]}
            disabled={games.length === 0}
          />
        </Field>

        {game && (
          <Field label="Unit">
            <UnitPickerButton
              units={units}
              value={unitName}
              onValueChange={setUnitName}
              loading={dataset.loading}
            />
          </Field>
        )}

        <Note
          scanning={scan.loading}
          game={game?.name}
          unit={unit}
          object={object}
          model={model}
          drawable={drawable}
          loading={loading}
          failed={failed}
          datasetFailed={
            dataset.status === "error" || dataset.status === "unsyncable"
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * What is standing in the scene, or why nothing from the game is.
 *
 * Every way of having nothing to draw says which one it is and says the
 * built-in figure is what you are looking at instead, because a reference that
 * silently stays a solar collector reads as a broken picker.
 */
function Note({
  scanning,
  game,
  unit,
  object,
  model,
  drawable,
  loading,
  failed,
  datasetFailed,
}: {
  scanning: boolean;
  game?: string;
  unit?: UnitDatasetEntry;
  object?: string;
  model: UnitModelResult | null;
  drawable: boolean;
  loading: boolean;
  failed: boolean;
  datasetFailed: boolean;
}) {
  if (!game) {
    return (
      <Text>
        The solar collector is built in, so it is here whether or not a game is.
        {scanning
          ? " Reading the installed games."
          : " Pick a game to stand one of its units at its real size instead."}
      </Text>
    );
  }
  if (datasetFailed) {
    return (
      <Text>Could not read {game}'s units. Showing the solar collector.</Text>
    );
  }
  if (!unit) return <Text>Pick a unit of {game} to stand beside yours.</Text>;
  if (!object) {
    return (
      <Text>
        This unit's definition names no model, so the engine draws nothing for
        it either. Showing the solar collector.
      </Text>
    );
  }
  if (loading)
    return (
      <Text>
        Reading {object} out of {game}.
      </Text>
    );
  if (failed) {
    return (
      <Text>
        Could not reach unitsync to read {object}. Showing the solar collector.
      </Text>
    );
  }
  if (!model) return null;
  if (!drawable) {
    return (
      <Text>
        {model.errors[0] ?? `Nothing drawable came out of ${object}.`} Showing
        the solar collector.
      </Text>
    );
  }

  const missing = model.textures.filter((t) => !t.file && !t.teamColour);
  return (
    <>
      <Text>
        {unitLabel(unit)} is standing to the left of the plates at the size the
        engine draws it.
      </Text>
      {missing.length > 0 && (
        <Text>
          {missing.length} of its textures are not in {game}, so those faces are
          drawn plain: {missing.map((t) => t.name).join(", ")}.
        </Text>
      )}
    </>
  );
}

function Field({
  label: text,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">{text}</span>
      {children}
    </div>
  );
}

function Text({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Two installed archives can carry the same game name, which is the same
 *  choice offered twice. */
function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}
