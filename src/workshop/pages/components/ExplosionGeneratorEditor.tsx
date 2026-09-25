/**
 * Creating and editing a custom explosion generator from a weapon field
 * (issue #2643): `explosionGenerator`, `bounceExplosionGenerator` or
 * `cegTag`, wherever `WeaponSlotsPanel` finds one on screen.
 *
 * A popover, the same choice `EquipWeaponPopover` makes and for the same
 * reason: the field it acts on stays on screen. Coilbox cannot render what a
 * generator looks like (the issue's own scoping), so the form says that
 * plainly and points at the local test launch (`PlayLocallyButton`, issue
 * #1278) as the way to see it.
 *
 * A generator holds a list of spawns plus an optional ground flash (issue
 * #3066): `GeneratorForm` lists the spawns with add, remove and reorder
 * controls, then a ground flash toggle and a `useDefaultExplosions` toggle
 * below them.
 */
import { Button, Input } from "@picoframe/frame";
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addExplosionSpawn,
  CEG_CLASS_FIELDS,
  type CegFieldSpec,
  type CegWeaponField,
  cegFieldValue,
  cegKeyFromFieldValue,
  checkExplosionGeneratorName,
  type ExplosionGenerator,
  type ExplosionGenerators,
  type ExplosionSpawn,
  type GroundFlash,
  moveExplosionSpawn,
  newExplosionGenerator,
  removeExplosionGenerator,
  removeExplosionSpawn,
  SPAWN_CLASSES,
  type SpawnClass,
  setExplosionGenerator,
  setExplosionSpawn,
  suggestExplosionGeneratorKey,
} from "../../explosionGenerators";

const hexToColor = (hex: string) => ({
  r: Number.parseInt(hex.slice(1, 3), 16) / 255,
  g: Number.parseInt(hex.slice(3, 5), 16) / 255,
  b: Number.parseInt(hex.slice(5, 7), 16) / 255,
});

const colorToHex = (color: { r: number; g: number; b: number } | undefined) => {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return color
    ? `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
    : "#ffffff";
};

/** "a" or "an", for a field label that starts a sentence lowercase, e.g.
 *  "impact effect" against "bounce effect". */
const articleFor = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** One class specific field's control, by {@link CegFieldSpec.key}, shared by
 *  a spawn and the ground flash: both are plain objects with the same
 *  optional `texture`/`color`/`size`/`lifetime`/`particles` fields. */
function ClassField<T extends Partial<ExplosionSpawn> & Partial<GroundFlash>>({
  spec,
  value,
  onPatch,
}: {
  spec: CegFieldSpec;
  value: T;
  onPatch: (patch: Partial<T>) => void;
}) {
  if (spec.key === "color")
    return (
      <Field label={spec.label} hint={spec.help}>
        <input
          type="color"
          className="h-8 w-16 rounded border border-input"
          value={colorToHex(value.color)}
          onChange={(e) =>
            onPatch({ color: hexToColor(e.target.value) } as Partial<T>)
          }
        />
      </Field>
    );
  if (spec.key === "texture")
    return (
      <Field label={spec.label} hint={spec.help}>
        <Input
          className="h-8 font-mono text-xs"
          value={value.texture ?? ""}
          onChange={(e) => onPatch({ texture: e.target.value } as Partial<T>)}
          placeholder="gfx/flare.tga"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    );
  // size, lifetime, particles: all plain numbers.
  return (
    <Field label={spec.label} hint={spec.help}>
      <Input
        type="number"
        className="h-8 text-xs"
        value={(value[spec.key as keyof T] as number | undefined) ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onPatch({
            [spec.key]: raw === "" ? undefined : Number(raw),
          } as Partial<T>);
        }}
      />
    </Field>
  );
}

function SpawnForm({
  spawn,
  index,
  spawnCount,
  onPatch,
  onRemove,
  onMove,
}: {
  spawn: ExplosionSpawn;
  index: number;
  spawnCount: number;
  onPatch: (patch: Partial<ExplosionSpawn>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Spawn {index + 1}
        </span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={index === 0}
            onClick={() => onMove("up")}
            aria-label="Move spawn up"
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={index === spawnCount - 1}
            onClick={() => onMove("down")}
            aria-label="Move spawn down"
          >
            <ArrowDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onRemove}
            aria-label="Remove spawn"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <Field label="Class">
        <OptionSelect
          value={spawn.class}
          onValueChange={(value) => onPatch({ class: value as SpawnClass })}
          options={SPAWN_CLASSES.map((c) => ({
            value: c.value,
            label: c.label,
          }))}
          size="sm"
        />
      </Field>
      {CEG_CLASS_FIELDS[spawn.class].map((spec) => (
        <ClassField
          key={spec.key}
          spec={spec}
          value={spawn}
          onPatch={onPatch}
        />
      ))}
      <Field label="Count" hint="How many times this fires per explosion.">
        <Input
          type="number"
          min={1}
          className="h-8 text-xs"
          value={spawn.count}
          onChange={(e) =>
            onPatch({ count: Math.max(1, Number(e.target.value) || 1) })
          }
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Fires on</span>
        <div className="grid grid-cols-2 gap-1.5">
          <CheckField
            label="Ground"
            checked={spawn.ground}
            onChange={(v) => onPatch({ ground: v })}
          />
          <CheckField
            label="Water"
            checked={spawn.water}
            onChange={(v) => onPatch({ water: v })}
          />
          <CheckField
            label="Air"
            checked={spawn.air}
            onChange={(v) => onPatch({ air: v })}
          />
          <CheckField
            label="Underwater"
            checked={spawn.underwater}
            onChange={(v) => onPatch({ underwater: v })}
          />
        </div>
      </div>
    </div>
  );
}

function GeneratorForm({
  generator,
  onPatchSpawn,
  onRemoveSpawn,
  onMoveSpawn,
  onAddSpawn,
  onSetGroundFlash,
  onPatch,
}: {
  generator: ExplosionGenerator;
  onPatchSpawn: (index: number, patch: Partial<ExplosionSpawn>) => void;
  onRemoveSpawn: (index: number) => void;
  onMoveSpawn: (index: number, direction: "up" | "down") => void;
  onAddSpawn: (cegClass: SpawnClass) => void;
  onSetGroundFlash: (groundFlash: GroundFlash | undefined) => void;
  onPatch: (patch: Partial<ExplosionGenerator>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {generator.spawns.map((spawn, index) => (
        <SpawnForm
          // Spawns have no other stable identity, and reordering already
          // updates every field a change here could confuse.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          spawn={spawn}
          index={index}
          spawnCount={generator.spawns.length}
          onPatch={(patch) => onPatchSpawn(index, patch)}
          onRemove={() => onRemoveSpawn(index)}
          onMove={(direction) => onMoveSpawn(index, direction)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onAddSpawn(SPAWN_CLASSES[0].value)}
      >
        <Plus className="size-3.5" />
        Add spawn
      </Button>
      <div className="flex flex-col gap-3 rounded border border-border p-3">
        <CheckField
          label="Ground flash"
          checked={!!generator.groundFlash}
          onChange={(v) => onSetGroundFlash(v ? {} : undefined)}
        />
        {generator.groundFlash &&
          CEG_CLASS_FIELDS.CStandardGroundFlash.map((spec) => (
            <ClassField
              key={spec.key}
              spec={spec}
              value={generator.groundFlash as GroundFlash}
              onPatch={(patch) =>
                onSetGroundFlash({ ...generator.groundFlash, ...patch })
              }
            />
          ))}
      </div>
      <CheckField
        label="Also play the engine's own explosion"
        checked={generator.useDefaultExplosions}
        onChange={(v) => onPatch({ useDefaultExplosions: v })}
      />
    </div>
  );
}

export function ExplosionGeneratorEditor({
  field,
  label,
  value,
  generators,
  onSetGenerators,
  onSetField,
}: {
  /** Which weapon field this control sits beside. */
  field: CegWeaponField;
  /** The field's own label, e.g. "Impact effect". */
  label: string;
  /** The field's current raw value. */
  value: unknown;
  generators: ExplosionGenerators;
  onSetGenerators: (next: ExplosionGenerators) => void;
  onSetField: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const currentKey = cegKeyFromFieldValue(field, value);
  const owned = currentKey ? generators[currentKey] : undefined;

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next && !owned) setDraftName(suggestExplosionGeneratorKey(generators));
  };

  const check = checkExplosionGeneratorName(draftName, generators);

  const create = () => {
    if (!check.ok) return;
    const generator = newExplosionGenerator(check.key, SPAWN_CLASSES[0].value);
    onSetGenerators(setGeneratorsWith(generators, generator));
    onSetField(cegFieldValue(field, check.key));
    setOpen(false);
  };

  const remove = () => {
    if (!currentKey) return;
    onSetGenerators(removeExplosionGenerator(generators, currentKey) ?? {});
    onSetField("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant={owned ? "default" : "outline"} size="sm">
          <Sparkles className="size-3.5" />
          {owned
            ? `Edit ${owned.key}`
            : `Create ${articleFor(label)} ${label.toLowerCase()}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-96 flex-col gap-4">
        {owned ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">
                {label}: <span className="font-mono">{owned.key}</span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Written as effects/{owned.key}.lua. Coilbox cannot render what
                this looks like in game; use Test to launch a real skirmish and
                see it.
              </p>
            </div>
            <GeneratorForm
              generator={owned}
              onPatchSpawn={(index, patch) =>
                onSetGenerators(
                  setExplosionSpawn(generators, owned.key, index, patch) ??
                    generators,
                )
              }
              onRemoveSpawn={(index) =>
                onSetGenerators(
                  removeExplosionSpawn(generators, owned.key, index) ??
                    generators,
                )
              }
              onMoveSpawn={(index, direction) =>
                onSetGenerators(
                  moveExplosionSpawn(generators, owned.key, index, direction) ??
                    generators,
                )
              }
              onAddSpawn={(cegClass) =>
                onSetGenerators(
                  addExplosionSpawn(generators, owned.key, cegClass) ??
                    generators,
                )
              }
              onSetGroundFlash={(groundFlash) =>
                onSetGenerators(
                  setExplosionGenerator(generators, owned.key, {
                    groundFlash,
                  }) ?? generators,
                )
              }
              onPatch={(patch) =>
                onSetGenerators(
                  setExplosionGenerator(generators, owned.key, patch) ??
                    generators,
                )
              }
            />
            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={remove}
              >
                Remove
              </Button>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">
                Create {articleFor(label)} {label.toLowerCase()}
              </h3>
              <p className="text-xs text-muted-foreground">
                {currentKey
                  ? `${label} already names ${currentKey}, which this project does not manage. Creating one here replaces it.`
                  : "A custom explosion generator, written into the game as its own file and bound to this field."}
              </p>
            </div>
            <Field
              label="Effect name"
              hint="Lowercase letters, numbers and underscores."
            >
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value.toLowerCase())}
                className="h-8 font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {!check.ok && (
              <p className="text-xs text-muted-foreground">
                {check.verdict === "empty"
                  ? "Give the effect a name."
                  : check.verdict === "invalid"
                    ? "A name can only use lowercase letters, numbers and underscores."
                    : `The project already has an effect called ${check.key}.`}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!check.ok}>
                Create
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

function setGeneratorsWith(
  generators: ExplosionGenerators,
  generator: ExplosionGenerator,
): ExplosionGenerators {
  return { ...generators, [generator.key]: generator };
}
