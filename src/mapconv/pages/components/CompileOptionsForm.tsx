import { Button, Input } from "@picoframe/frame";
import { Check } from "lucide-react";
import { useState } from "react";
import { CheckField, Field } from "./Field";
import { PathField } from "./PathField";

/** Image file filters shared by the optional map pickers. */
const IMAGE_FILTERS = [{ name: "Images", extensions: ["png", "bmp", "tga", "jpg", "jpeg", "tif", "tiff"] }];

/**
 * The optional `mapcompile` flags, held as strings so empty == omit. The page
 * keeps a snapshot of this and parses it into `CompileOpts` at run time.
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
 * Body of the "Compile options" side drawer. Manages its own draft seeded from
 * the page's current advanced opts, then commits the whole draft via `onApply`
 * (mirrors the SeedSqlForm drawer pattern — the drawer content is captured once,
 * so it owns local state and writes back on Apply rather than two-way binding).
 */
export default function CompileOptionsForm({
  initial,
  defaultPath,
  onApply,
}: {
  initial: AdvancedCompileOpts;
  defaultPath?: string;
  onApply: (opts: AdvancedCompileOpts) => void;
}) {
  const [draft, setDraft] = useState<AdvancedCompileOpts>(initial);
  const set = (p: Partial<AdvancedCompileOpts>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <div className="space-y-6 p-5">
      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source maps</h3>
        <PathField
          label="Heightmap (-h)"
          hint="grayscale; black = min height, white = max height"
          value={draft.heightmap}
          onChange={(v) => set({ heightmap: v })}
          filters={IMAGE_FILTERS}
          defaultPath={defaultPath}
        />
        <PathField label="Metal map (-m)" value={draft.metalmap} onChange={(v) => set({ metalmap: v })} filters={IMAGE_FILTERS} defaultPath={defaultPath} />
        <PathField label="Type map (-z)" value={draft.typemap} onChange={(v) => set({ typemap: v })} filters={IMAGE_FILTERS} defaultPath={defaultPath} />
        <PathField label="Minimap (-minimap)" value={draft.minimap} onChange={(v) => set({ minimap: v })} filters={IMAGE_FILTERS} defaultPath={defaultPath} />
        <PathField label="Vegetation map (-v)" value={draft.vegmap} onChange={(v) => set({ vegmap: v })} filters={IMAGE_FILTERS} defaultPath={defaultPath} />
        <PathField
          label="Features file (-features)"
          hint="text: [tdfname] [x] [y] [z] [rotation] per line"
          value={draft.features}
          onChange={(v) => set({ features: v })}
          defaultPath={defaultPath}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Height range</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Min height (-minh)" hint="height at black; default 0">
            <Input type="number" value={draft.minh} onChange={(e) => set({ minh: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Max height (-maxh)" hint="height at white; default 1">
            <Input type="number" value={draft.maxh} onChange={(e) => set({ maxh: e.target.value })} placeholder="1" />
          </Field>
        </div>
        <CheckField
          label="Disable height clamping (-noclamp)"
          hint="Not recommended; you lose precision. Prefer min/max height instead."
          checked={draft.noclamp}
          onChange={(v) => set({ noclamp: v })}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compression tuning</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Threshold (-th)" hint="tile match tolerance; default 0.8">
            <Input type="number" step="0.1" value={draft.th} onChange={(e) => set({ th: e.target.value })} placeholder="0.8" />
          </Field>
          <Field label="Compare count (-ccount)" hint="tiles to compare in modes 2 & 4; default 64">
            <Input type="number" min={1} value={draft.ccount} onChange={(e) => set({ ccount: e.target.value })} placeholder="64" />
          </Field>
        </div>
        <CheckField
          label="Smooth texture (-smooth)"
          hint="Blur the main texture before compiling."
          checked={draft.smooth}
          onChange={(v) => set({ smooth: v })}
        />
      </section>

      <Button onClick={() => onApply(draft)}>
        <Check /> Apply options
      </Button>
    </div>
  );
}
