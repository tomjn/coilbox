import { Input } from "@picoframe/frame";
import { CheckField, Field } from "./Field";
import { PathField } from "./PathField";

/** Image file filters shared by the optional map pickers. */
const IMAGE_FILTERS = [
  {
    name: "Images",
    extensions: ["png", "bmp", "tga", "jpg", "jpeg", "tif", "tiff"],
  },
];

/**
 * The optional `mapcompile` flags, held as strings so empty == omit. The page
 * keeps this and parses it into `CompileOpts` at run time.
 */
export interface AdvancedCompileOpts {
  heightmap: string;
  metalmap: string;
  typemap: string;
  minimap: string;
  vegmap: string;
  features: string;
  maxh: string;
  minh: string;
  th: string;
  ccount: string;
  noclamp: boolean;
  smooth: boolean;
}

export const defaultAdvanced: AdvancedCompileOpts = {
  heightmap: "",
  metalmap: "",
  typemap: "",
  minimap: "",
  vegmap: "",
  features: "",
  maxh: "",
  minh: "",
  th: "",
  ccount: "",
  noclamp: false,
  smooth: false,
};

/**
 * The optional/advanced compile flags, rendered inline inside a collapsible
 * section on the Compile page. Fully controlled — edits flow straight back to
 * the page's `advanced` state via `onChange`.
 */
export default function AdvancedOptions({
  value,
  onChange,
  defaultPath,
  disabled,
}: {
  value: AdvancedCompileOpts;
  onChange: (opts: AdvancedCompileOpts) => void;
  defaultPath?: string;
  disabled?: boolean;
}) {
  const set = (p: Partial<AdvancedCompileOpts>) => onChange({ ...value, ...p });

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Source maps
        </h3>
        <PathField
          label="Heightmap (-h)"
          hint="grayscale image (PNG/TGA/BMP); black = min height, white = max height"
          value={value.heightmap}
          onChange={(v) => set({ heightmap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
        />
        <PathField
          label="Metal map (-m)"
          hint="grayscale image; brightness = metal density"
          value={value.metalmap}
          onChange={(v) => set({ metalmap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
        />
        <PathField
          label="Type map (-z)"
          hint="grayscale image; terrain-type index per pixel"
          value={value.typemap}
          onChange={(v) => set({ typemap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
        />
        <PathField
          label="Minimap (-minimap)"
          hint="image (PNG/TGA/BMP); optional preview"
          value={value.minimap}
          onChange={(v) => set({ minimap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
        />
        <PathField
          label="Vegetation map (-v)"
          hint="grayscale image; vegetation density"
          value={value.vegmap}
          onChange={(v) => set({ vegmap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
        />
        <PathField
          label="Features file (-features)"
          hint="text file; one feature per line: [tdfname] [x] [y] [z] [rotation]"
          value={value.features}
          onChange={(v) => set({ features: v })}
          disabled={disabled}
          defaultPath={defaultPath}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Height range
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min height (-minh)" hint="height at black; default 0">
            <Input
              type="number"
              value={value.minh}
              onChange={(e) => set({ minh: e.target.value })}
              disabled={disabled}
              placeholder="0"
            />
          </Field>
          <Field label="Max height (-maxh)" hint="height at white; default 1">
            <Input
              type="number"
              value={value.maxh}
              onChange={(e) => set({ maxh: e.target.value })}
              disabled={disabled}
              placeholder="1"
            />
          </Field>
        </div>
        <CheckField
          label="Disable height clamping (-noclamp)"
          hint="Not recommended; you lose precision. Prefer min/max height instead."
          checked={value.noclamp}
          onChange={(v) => set({ noclamp: v })}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compression tuning
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Threshold (-th)"
            hint="tile match tolerance; default 0.8"
          >
            <Input
              type="number"
              step="0.1"
              value={value.th}
              onChange={(e) => set({ th: e.target.value })}
              disabled={disabled}
              placeholder="0.8"
            />
          </Field>
          <Field
            label="Compare count (-ccount)"
            hint="tiles to compare in modes 2 & 4; default 64"
          >
            <Input
              type="number"
              min={1}
              value={value.ccount}
              onChange={(e) => set({ ccount: e.target.value })}
              disabled={disabled}
              placeholder="64"
            />
          </Field>
        </div>
        <CheckField
          label="Smooth texture (-smooth)"
          hint="Blur the main texture before compiling."
          checked={value.smooth}
          onChange={(v) => set({ smooth: v })}
        />
      </section>
    </div>
  );
}
