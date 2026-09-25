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
 */
import { Button, Input } from "@picoframe/frame";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CEG_CLASS_FIELDS,
  CEG_CLASSES,
  type CegClass,
  type CegFieldSpec,
  type CegWeaponField,
  cegFieldValue,
  cegHasSpawnControls,
  cegKeyFromFieldValue,
  checkExplosionGeneratorName,
  type ExplosionGenerator,
  type ExplosionGenerators,
  newExplosionGenerator,
  removeExplosionGenerator,
  setExplosionGenerator,
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

/** One class specific field's control, by {@link CegFieldSpec.key}. */
function ClassField({
  spec,
  generator,
  onPatch,
}: {
  spec: CegFieldSpec;
  generator: ExplosionGenerator;
  onPatch: (patch: Partial<ExplosionGenerator>) => void;
}) {
  if (spec.key === "color")
    return (
      <Field label={spec.label} hint={spec.help}>
        <input
          type="color"
          className="h-8 w-16 rounded border border-input"
          value={colorToHex(generator.color)}
          onChange={(e) => onPatch({ color: hexToColor(e.target.value) })}
        />
      </Field>
    );
  if (spec.key === "texture")
    return (
      <Field label={spec.label} hint={spec.help}>
        <Input
          className="h-8 font-mono text-xs"
          value={generator.texture ?? ""}
          onChange={(e) => onPatch({ texture: e.target.value })}
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
        value={generator[spec.key] ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onPatch({ [spec.key]: raw === "" ? undefined : Number(raw) });
        }}
      />
    </Field>
  );
}

function GeneratorForm({
  generator,
  onPatch,
}: {
  generator: ExplosionGenerator;
  onPatch: (patch: Partial<ExplosionGenerator>) => void;
}) {
  const hasSpawnControls = cegHasSpawnControls(generator.class);
  return (
    <div className="flex flex-col gap-3">
      <Field label="Class">
        <OptionSelect
          value={generator.class}
          onValueChange={(value) => onPatch({ class: value as CegClass })}
          options={CEG_CLASSES.map((c) => ({ value: c.value, label: c.label }))}
          size="sm"
        />
      </Field>
      {CEG_CLASS_FIELDS[generator.class].map((spec) => (
        <ClassField
          key={spec.key}
          spec={spec}
          generator={generator}
          onPatch={onPatch}
        />
      ))}
      {hasSpawnControls && (
        <>
          <Field label="Count" hint="How many times this fires per explosion.">
            <Input
              type="number"
              min={1}
              className="h-8 text-xs"
              value={generator.count}
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
                checked={generator.ground}
                onChange={(v) => onPatch({ ground: v })}
              />
              <CheckField
                label="Water"
                checked={generator.water}
                onChange={(v) => onPatch({ water: v })}
              />
              <CheckField
                label="Air"
                checked={generator.air}
                onChange={(v) => onPatch({ air: v })}
              />
              <CheckField
                label="Underwater"
                checked={generator.underwater}
                onChange={(v) => onPatch({ underwater: v })}
              />
            </div>
          </div>
        </>
      )}
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
    const generator = newExplosionGenerator(check.key, CEG_CLASSES[0].value);
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
