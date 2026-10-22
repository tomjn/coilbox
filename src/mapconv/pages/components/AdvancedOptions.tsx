import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@picoframe/frame";
import { CheckField, Field } from "@/components/Field";
import { HelpTip, LearnMore, WIKI } from "./Help";
import { PathField } from "./PathField";

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
  const { t } = useLingui();
  const set = (p: Partial<AdvancedCompileOpts>) => onChange({ ...value, ...p });
  // Image file filters shared by the optional map pickers.
  const IMAGE_FILTERS = [
    {
      name: t`Images`,
      extensions: ["png", "bmp", "tga", "jpg", "jpeg", "tif", "tiff"],
    },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Source maps</Trans>
        </h3>
        <PathField
          label={t`Heightmap (-h)`}
          hint={t`grayscale; white = high, black = low`}
          help={
            <HelpTip>
              <span>
                <Trans>
                  Defines the terrain elevation. A grayscale image where{" "}
                  <strong>
                    white is the highest point and black the lowest
                  </strong>
                  . Greys are heights in between. It should be{" "}
                  <code>(texture ÷ 8) + 1</code> pixels on each side (e.g. an
                  8192px texture needs a 1025px heightmap).
                </Trans>
              </span>
            </HelpTip>
          }
          learnMore={<LearnMore href={WIKI.height} />}
          value={value.heightmap}
          onChange={(v) => set({ heightmap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
          preview
        />
        <PathField
          label={t`Metal map (-m)`}
          hint={t`red channel marks metal deposits`}
          help={
            <HelpTip>
              <span>
                <Trans>
                  Marks where reclaimable/extractable metal is. The{" "}
                  <strong>red channel</strong> sets metal density (brighter red
                  = more); paint small red spots where you want metal spots in
                  game.
                </Trans>
              </span>
            </HelpTip>
          }
          learnMore={<LearnMore href={WIKI.metal} />}
          value={value.metalmap}
          onChange={(v) => set({ metalmap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
          preview
        />
        <PathField
          label={t`Type map (-z)`}
          hint={t`terrain-type index per pixel`}
          help={
            <HelpTip>
              <span>
                <Trans>
                  Assigns a terrain type per pixel (each pixel value is an index
                  into the map's terrain types, which set speed/hardness for
                  units).
                </Trans>
              </span>
            </HelpTip>
          }
          learnMore={<LearnMore href={WIKI.terraintype} />}
          value={value.typemap}
          onChange={(v) => set({ typemap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
          preview
        />
        <PathField
          label={t`Minimap (-minimap)`}
          hint={t`the small overview image shown in-lobby and in-game`}
          help={
            <HelpTip>
              <span>
                <Trans>
                  The low-resolution overview image players see in the lobby and
                  the in-game minimap. If omitted, the engine can derive one
                  from the texture.
                </Trans>
              </span>
            </HelpTip>
          }
          learnMore={<LearnMore href={WIKI.minimap} />}
          value={value.minimap}
          onChange={(v) => set({ minimap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
          preview
        />
        <PathField
          label={t`Vegetation map (-v)`}
          hint={t`grayscale; brightness = grass density`}
          help={
            <HelpTip>
              <span>
                <Trans>
                  Controls where engine grass/vegetation grows. A grayscale
                  image where brighter = denser grass.
                </Trans>
              </span>
            </HelpTip>
          }
          learnMore={<LearnMore href={WIKI.grass} />}
          value={value.vegmap}
          onChange={(v) => set({ vegmap: v })}
          disabled={disabled}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
          preview
        />
        <PathField
          label={t`Features file (-features)`}
          hint={t`text file; one feature per line: [tdfname] [x] [y] [z] [rotation]`}
          help={
            <HelpTip>
              <span>
                <Trans>
                  Places map features (trees, rocks, wreckage). A text file with
                  one feature per line:{" "}
                  <code>[tdfname] [x] [y] [z] [rotation]</code>, where tdfname
                  is the feature's definition name.
                </Trans>
              </span>
            </HelpTip>
          }
          learnMore={<LearnMore href={WIKI.features} />}
          value={value.features}
          onChange={(v) => set({ features: v })}
          disabled={disabled}
          defaultPath={defaultPath}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Height range</Trans>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t`Min height (-minh)`}
            hint={t`world height at black; default 0`}
            help={
              <HelpTip>
                <span>
                  <Trans>
                    The in-world height (in map units) that pure black in the
                    heightmap maps to — the map's lowest point. Below 0 is
                    underwater.
                  </Trans>
                </span>
              </HelpTip>
            }
          >
            <Input
              type="number"
              value={value.minh}
              onChange={(e) => set({ minh: e.target.value })}
              disabled={disabled}
              placeholder="0"
            />
          </Field>
          <Field
            label={t`Max height (-maxh)`}
            hint={t`world height at white; default 1`}
            help={
              <HelpTip>
                <span>
                  <Trans>
                    The in-world height (in map units) that pure white maps to —
                    the map's highest point. The gap between min and max sets
                    how steep the terrain is.
                  </Trans>
                </span>
              </HelpTip>
            }
          >
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
          label={t`Disable height clamping (-noclamp)`}
          hint={t`Not recommended; you lose precision. Prefer min/max height instead.`}
          checked={value.noclamp}
          onChange={(v) => set({ noclamp: v })}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Compression tuning</Trans>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t`Threshold (-th)`}
            hint={t`tile match tolerance; default 0.8`}
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
            label={t`Compare count (-ccount)`}
            hint={t`tiles to compare in modes 2 & 4; default 64`}
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
          label={t`Smooth texture (-smooth)`}
          hint={t`Blur the main texture before compiling.`}
          checked={value.smooth}
          onChange={(v) => set({ smooth: v })}
        />
      </section>
    </div>
  );
}
