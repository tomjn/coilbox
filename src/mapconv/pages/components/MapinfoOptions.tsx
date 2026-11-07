import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Plus, RotateCcw, X } from "lucide-react";
import { Field } from "@/components/Field";
import {
  COLOUR_DEFAULTS,
  type ColourKey,
  type MapinfoDraft,
  rgbToHex,
  SUN_DIR_DEFAULT,
} from "../../mapinfoForm";

/** A colour that is the default until the user picks one, with a way back. */
function ColourField({
  label,
  value,
  fallback,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  return (
    <div className="flex items-end gap-1">
      <Field label={label} className="min-w-0 flex-1">
        <input
          type="color"
          className={`h-8 w-full rounded border border-input ${value === "" ? "opacity-50" : ""}`}
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
      {value !== "" && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Reset ${label}`}
          onClick={() => onChange("")}
          disabled={disabled}
        >
          <RotateCcw size={14} />
        </Button>
      )}
    </div>
  );
}

/**
 * The fields the Compile page writes into `mapinfo.lua`. Fully controlled. An
 * empty field means the page has no opinion, so an existing file keeps its
 * value there and a new file gets the writer's default.
 */
export default function MapinfoOptions({
  value,
  onChange,
  outSuffix,
  disabled,
}: {
  value: MapinfoDraft;
  onChange: (next: MapinfoDraft) => void;
  outSuffix: string;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const set = (p: Partial<MapinfoDraft>) => onChange({ ...value, ...p });
  const colour = (key: ColourKey, label: string) => (
    <ColourField
      label={label}
      value={value[key]}
      fallback={rgbToHex(COLOUR_DEFAULTS[key])}
      onChange={(hex) => set({ [key]: hex })}
      disabled={disabled}
    />
  );
  const starts = value.startPositions ?? [];
  const setStart = (i: number, p: Partial<{ x: string; z: string }>) =>
    set({
      startPositions: starts.map((s, j) => (j === i ? { ...s, ...p } : s)),
    });

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-medium">
          <Trans>Identity</Trans>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t`Name`}>
            <Input
              value={value.name}
              onChange={(e) => set({ name: e.target.value })}
              disabled={disabled}
              placeholder={outSuffix}
            />
          </Field>
          <Field label={t`Short name`}>
            <Input
              value={value.shortname}
              onChange={(e) => set({ shortname: e.target.value })}
              disabled={disabled}
              placeholder={outSuffix}
            />
          </Field>
        </div>
        <Field label={t`Description`}>
          <Input
            value={value.description}
            onChange={(e) => set({ description: e.target.value })}
            disabled={disabled}
          />
        </Field>
        <Field label={t`Author`}>
          <Input
            value={value.author}
            onChange={(e) => set({ author: e.target.value })}
            disabled={disabled}
          />
        </Field>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium">
          <Trans>Sky and light</Trans>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {colour("skyColor", t`Sky colour`)}
          {colour("fogColor", t`Fog colour`)}
          {colour("sunColor", t`Sun colour`)}
          {colour("groundAmbientColor", t`Ground ambient`)}
          {colour("groundDiffuseColor", t`Ground diffuse`)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <Field key={axis} label={t`Sun direction ${axis}`}>
              <Input
                type="number"
                step="0.1"
                value={value.sunDir[i]}
                onChange={(e) => {
                  const next: MapinfoDraft["sunDir"] = [...value.sunDir];
                  next[i] = e.target.value;
                  set({ sunDir: next });
                }}
                disabled={disabled}
                placeholder={String(SUN_DIR_DEFAULT[i])}
              />
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium">
          <Trans>Water and ground</Trans>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {colour("waterSurfaceColor", t`Water colour`)}
          <Field label={t`Water opacity`}>
            <Input
              type="number"
              step="0.05"
              min={0}
              max={1}
              value={value.waterSurfaceAlpha}
              onChange={(e) => set({ waterSurfaceAlpha: e.target.value })}
              disabled={disabled}
              placeholder="0.55"
            />
          </Field>
          <Field label={t`Terrain hardness`}>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={value.terrainHardness}
              onChange={(e) => set({ terrainHardness: e.target.value })}
              disabled={disabled}
              placeholder="1"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">
          <Trans>Start positions (elmos)</Trans>
        </h3>
        {starts.map((pos, i) => {
          const team = i + 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their team number
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-sm text-muted-foreground">
                <Trans>Team {team}</Trans>
              </span>
              <Input
                type="number"
                aria-label={t`Team ${team} X`}
                placeholder="x"
                value={pos.x}
                onChange={(e) => setStart(i, { x: e.target.value })}
                disabled={disabled}
              />
              <Input
                type="number"
                aria-label={t`Team ${team} Z`}
                placeholder="z"
                value={pos.z}
                onChange={(e) => setStart(i, { z: e.target.value })}
                disabled={disabled}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t`Remove team ${team}`}
                onClick={() =>
                  set({
                    startPositions: starts.filter((_, j) => j !== i),
                  })
                }
                disabled={disabled}
              >
                <X size={14} />
              </Button>
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          onClick={() => set({ startPositions: [...starts, { x: "", z: "" }] })}
          disabled={disabled}
        >
          <Plus /> <Trans>Add start position</Trans>
        </Button>
      </section>
    </div>
  );
}
