import { Trans, useLingui } from "@lingui/react/macro";
import { OptionSelect } from "@/components/OptionSelect";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { useDownloadsConfig } from "../../../downloads/config";
import type { ContentRoot } from "../../bindings";

/** The option that leaves a kind following the default folder. */
const SAME_AS_DEFAULT = "same-as-default";

/**
 * Which content folder new content is written into: a default, and a folder of
 * their own for games and for maps when the user wants one. Both of those
 * follow the default until they are set, and go back to it when their folder
 * is removed, which `pickWriteRoot` decides for every download.
 *
 * Renders nothing when there is no folder to choose, because the folder list
 * below already says so and offers to add one.
 */
export function DownloadFolders({ roots }: { roots: ContentRoot[] }) {
  const { t } = useLingui();
  const [cfg, setCfg] = useDownloadsConfig();
  // The bundled content folder and any folder set to read only are never
  // written into, so they are never offered as somewhere to download to.
  const usable = roots.filter((r) => !r.bundled && !r.readOnly);
  if (usable.length === 0) return null;

  const folders = usable.map((root) => ({
    value: root.id,
    label: root.label || root.path,
    description: root.label ? root.path : undefined,
  }));
  const withDefault = [
    { value: SAME_AS_DEFAULT, label: t`Same as default` },
    ...folders,
  ];
  // A folder that has been removed reads as following the default, which is
  // what downloads do with it.
  const own = (id: string | undefined) =>
    id && usable.some((r) => r.id === id) ? id : SAME_AS_DEFAULT;
  const chosen = (value: string) =>
    value === SAME_AS_DEFAULT ? undefined : value;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">
        <Trans>New content goes to</Trans>
      </h2>
      <SettingList>
        <SettingRow id="write-root-default" label={t`Default`}>
          <OptionSelect
            id="write-root-default"
            size="sm"
            className="w-64"
            value={cfg.writeRootId ?? ""}
            onValueChange={(v) => setCfg({ ...cfg, writeRootId: v })}
            placeholder={t`Select a content folder…`}
            options={folders}
          />
        </SettingRow>
        <SettingRow id="write-root-games" label={t`Games`}>
          <OptionSelect
            id="write-root-games"
            size="sm"
            className="w-64"
            value={own(cfg.gamesRootId)}
            onValueChange={(v) => setCfg({ ...cfg, gamesRootId: chosen(v) })}
            options={withDefault}
          />
        </SettingRow>
        <SettingRow id="write-root-maps" label={t`Maps`}>
          <OptionSelect
            id="write-root-maps"
            size="sm"
            className="w-64"
            value={own(cfg.mapsRootId)}
            onValueChange={(v) => setCfg({ ...cfg, mapsRootId: chosen(v) })}
            options={withDefault}
          />
        </SettingRow>
      </SettingList>
    </section>
  );
}
