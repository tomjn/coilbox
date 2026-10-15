import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
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
  const [cfg, setCfg] = useDownloadsConfig();
  // The bundled content folder is read-only to coilbox, so it is never
  // offered as somewhere to download to.
  const usable = roots.filter((r) => !r.bundled);
  if (usable.length === 0) return null;

  const folders = usable.map((root) => ({
    value: root.id,
    label: root.label || root.path,
    description: root.label ? root.path : undefined,
  }));
  const withDefault = [
    { value: SAME_AS_DEFAULT, label: "Same as default" },
    ...folders,
  ];
  // A folder that has been removed reads as following the default, which is
  // what downloads do with it.
  const own = (id: string | undefined) =>
    id && usable.some((r) => r.id === id) ? id : SAME_AS_DEFAULT;
  const chosen = (value: string) =>
    value === SAME_AS_DEFAULT ? undefined : value;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        New content goes to
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Default">
          <OptionSelect
            value={cfg.writeRootId ?? ""}
            onValueChange={(v) => setCfg({ ...cfg, writeRootId: v })}
            placeholder="Select a content folder…"
            options={folders}
          />
        </Field>
        <Field label="Games">
          <OptionSelect
            value={own(cfg.gamesRootId)}
            onValueChange={(v) => setCfg({ ...cfg, gamesRootId: chosen(v) })}
            options={withDefault}
          />
        </Field>
        <Field label="Maps">
          <OptionSelect
            value={own(cfg.mapsRootId)}
            onValueChange={(v) => setCfg({ ...cfg, mapsRootId: chosen(v) })}
            options={withDefault}
          />
        </Field>
      </div>
    </section>
  );
}
