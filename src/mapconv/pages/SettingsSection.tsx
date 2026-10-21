import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { type CompressionType, mcProbe } from "../bindings";
import { useMapconvConfig } from "../config";

const CT_OPTIONS = [
  { value: "1", label: msg`1 — No compression` },
  { value: "2", label: msg`2 — Fast` },
  { value: "3", label: msg`3 — Insane (slow)` },
  { value: "4", label: msg`4 — High quality fast` },
];

/**
 * The plugin's settings section, hosted in the frame settings page at
 * `/settings/mapconv`. Edits persist immediately via `useMapconvConfig` (frame
 * settings store, Tauri-backed) — no Save button. The frame renders the section
 * title + padding, so this is just the form body.
 */
export default function MapconvSettings() {
  const { t } = useLingui();
  const [cfg, setCfg] = useMapconvConfig();
  const [probe, setProbe] = useState<{
    available: boolean;
    compile: boolean;
    decompile: boolean;
  } | null>(null);

  useEffect(() => {
    mcProbe(undefined)
      .then(setProbe)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Defaults</Trans>
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={t`Default compression type`}
            hint={t`seeds the Compile page`}
          >
            <OptionSelect
              value={String(cfg.defaultCompressionType)}
              onValueChange={(v) =>
                setCfg({
                  ...cfg,
                  defaultCompressionType: Number(v) as CompressionType,
                })
              }
              options={CT_OPTIONS.map((o) => ({
                ...o,
                label: i18n._(o.label),
              }))}
            />
          </Field>
        </div>
        <CheckField
          label={t`Remember last-used folders`}
          hint={t`Pre-fill the file pickers with the folders you used last time.`}
          checked={cfg.rememberDirs}
          onChange={(v) => setCfg({ ...cfg, rememberDirs: v })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>SpringMapConvNG sidecars</Trans>
        </h2>
        <p className="text-xs text-muted-foreground">
          <Trans>
            The compile/decompile features shell out to the bundled
            SpringMapConvNG binaries.
          </Trans>
        </p>
        <ul className="space-y-1.5 text-sm">
          <SidecarRow label="mapcompile" ok={probe?.compile} />
          <SidecarRow label="mapdecompile" ok={probe?.decompile} />
        </ul>
      </section>
    </div>
  );
}

function SidecarRow({ label, ok }: { label: string; ok?: boolean }) {
  const { t } = useLingui();
  return (
    <li className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2
          size={15}
          className="text-emerald-600 dark:text-emerald-400"
        />
      ) : (
        <XCircle size={15} className="text-muted-foreground" />
      )}
      <code className="text-xs">{label}</code>
      <span className="text-xs text-muted-foreground">
        {ok === undefined ? t`checking…` : ok ? t`available` : t`not found`}
      </span>
    </li>
  );
}
