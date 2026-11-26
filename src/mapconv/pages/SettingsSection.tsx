import { i18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { OptionSelect } from "@/components/OptionSelect";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { errorText } from "@/lib/helpers";
import { type CompressionType, mcProbe } from "../bindings";
import { CT_OPTIONS } from "../compression";
import { useMapconvConfig } from "../config";

type Probe = { compile: boolean; decompile: boolean };

/**
 * The plugin's settings section, hosted in the frame settings page at
 * `/settings/mapconv`. Edits persist immediately via `useMapconvConfig` (frame
 * settings store, Tauri-backed), so there is no Save button. The frame renders
 * the section title and padding, so this is just the body.
 */
export default function MapconvSettings() {
  const { t } = useLingui();
  const [cfg, setCfg] = useMapconvConfig();
  const [probe, setProbe] = useState<Probe | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    mcProbe(undefined)
      .then((p) => live && setProbe(p))
      .catch((e) => live && setProbeError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          <Trans>Compiling</Trans>
        </h2>
        <SettingList>
          <SettingRow
            id="mapconv-compression"
            label={t`Compression`}
            helpLabel={t`About compression`}
            help={
              <p>
                <Trans>
                  The Compile page starts with this choice. You can still change
                  it there for each map.
                </Trans>
              </p>
            }
          >
            <OptionSelect
              id="mapconv-compression"
              value={String(cfg.defaultCompressionType)}
              onValueChange={(v) =>
                setCfg({
                  ...cfg,
                  defaultCompressionType: Number(v) as CompressionType,
                })
              }
              size="sm"
              className="w-72"
              options={CT_OPTIONS.map((o) => ({
                ...o,
                label: i18n._(o.label),
              }))}
            />
          </SettingRow>
          <SettingRow
            id="mapconv-remember-folders"
            label={t`Remember folders`}
            helpLabel={t`About remembering folders`}
            help={
              <p>
                <Trans>
                  The file pickers open in the folders you used last time.
                  Turning this off forgets them.
                </Trans>
              </p>
            }
          >
            <Switch
              id="mapconv-remember-folders"
              checked={cfg.rememberDirs}
              onCheckedChange={(v) =>
                setCfg(
                  v === true
                    ? { ...cfg, rememberDirs: true }
                    : {
                        ...cfg,
                        rememberDirs: false,
                        lastTextureDir: undefined,
                        lastOutDir: undefined,
                        lastSmfDir: undefined,
                      },
                )
              }
            />
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Tools</Trans>
          </h2>
          <HelpPopover label={t`About the map tools`}>
            <p>
              <Trans>
                Coilbox comes with the SpringMapConvNG tools. Compile needs
                mapcompile and Decompile needs mapdecompile.
              </Trans>
            </p>
          </HelpPopover>
        </div>
        <SettingList>
          <ToolRow
            name="mapcompile"
            found={probe?.compile}
            failed={probeError !== null}
          />
          <ToolRow
            name="mapdecompile"
            found={probe?.decompile}
            failed={probeError !== null}
          />
        </SettingList>
        {probeError && (
          <p
            role="alert"
            className="select-text break-words text-xs text-destructive"
          >
            {t`Could not check for the tools: ${probeError}`}
          </p>
        )}
      </section>
    </div>
  );
}

function ToolRow({
  name,
  found,
  failed,
}: {
  name: string;
  found?: boolean;
  failed: boolean;
}) {
  const { t } = useLingui();
  let status: string;
  if (failed) status = t`Not checked`;
  else if (found === undefined) status = t`Checking…`;
  else status = found ? t`Found` : t`Missing`;
  return (
    <SettingRow label={name}>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {found ? (
          <CheckCircle2
            aria-hidden
            className="size-4 text-emerald-600 dark:text-emerald-400"
          />
        ) : found === false ? (
          <XCircle aria-hidden className="size-4 text-destructive" />
        ) : null}
        {status}
      </span>
    </SettingRow>
  );
}
