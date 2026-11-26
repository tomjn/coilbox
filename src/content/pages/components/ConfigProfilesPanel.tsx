import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/i18n/uiError";
import { formatDateTime } from "@/lib/format";
import {
  type ConfigProfile,
  contentConfigBackup,
  contentConfigDeleteProfile,
  contentConfigProfiles,
  contentConfigRestore,
} from "../../bindings";
import { useContentPrefs } from "../../config";
import { SkeletonList } from "./states";

/** Friendly label for each captured artifact id, read when a row draws. */
const ARTIFACT_LABEL: Record<string, MessageDescriptor> = {
  "springsettings.cfg": msg`settings`,
  "uikeys.txt": msg`keybinds`,
  "LuaUI/Config": msg`widget config`,
};

/** The name the automatic backup is saved under, and the slug that gives. */
const AUTO_BACKUP_NAME = "Auto-backup";
const AUTO_BACKUP_SLUG = "auto-backup";

/**
 * The folder name the backend saves a copy under, as `slug` in
 * `settings_backup.rs` makes it. Two names with the same slug are the same
 * copy, so this is how a save knows it would replace one. Empty when the name
 * has no ASCII letter or digit, which the backend refuses.
 */
export function configSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Pending =
  | { kind: "restore"; slug: string }
  | { kind: "delete"; slug: string };

/**
 * Saved copies of the selected content root's engine config
 * (`springsettings.cfg`, `LuaUI/Config/`, `uikeys.txt`). Save the current
 * config under a name, put one back, or delete one. Each of the last two asks
 * first, as does a save that would replace a copy with the same name. The
 * optional automatic backup saves the current config just before a restore
 * overwrites it.
 */
export function ConfigProfilesPanel({ rootPath }: { rootPath: string }) {
  const { t, i18n } = useLingui();
  const [prefs, setPrefs] = useContentPrefs();
  // Null until the first list for this root arrives.
  const [profiles, setProfiles] = useState<ConfigProfile[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [replacing, setReplacing] = useState(false);

  const load = useCallback(
    async (live: () => boolean = () => true) => {
      try {
        const { profiles } = await contentConfigProfiles({ rootPath });
        if (live()) setProfiles(profiles);
      } catch (e) {
        if (!live()) return;
        setProfiles((prev) => prev ?? []);
        setError(describeError(e));
      }
    },
    [rootPath],
  );

  // A new root starts empty, so a copy listed for the last root can never be
  // restored into this one, and a slow answer for the old root is dropped.
  useEffect(() => {
    let live = true;
    setProfiles(null);
    setPending(null);
    setReplacing(false);
    setStatus(null);
    setError(null);
    void load(() => live);
    return () => {
      live = false;
    };
  }, [load]);

  const displayName = (p: ConfigProfile) =>
    p.slug === AUTO_BACKUP_SLUG && p.name === AUTO_BACKUP_NAME
      ? t`Automatic backup`
      : p.name;

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await work();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const trimmed = name.trim();
  const slug = configSlug(trimmed);

  const save = (replace: boolean) => {
    if (!slug) return;
    if (!replace && profiles?.some((p) => p.slug === slug)) {
      setReplacing(true);
      return;
    }
    setReplacing(false);
    void run(async () => {
      await contentConfigBackup({ rootPath, name: trimmed });
      setName("");
      setStatus(t`Saved "${trimmed}".`);
      await load();
    });
  };

  const restore = (p: ConfigProfile, overwrite: boolean) =>
    run(async () => {
      // Backing up before restoring the backup itself would replace it with
      // the current config first, so restoring it would change nothing.
      if (
        overwrite &&
        prefs.autoBackupEngineConfig &&
        p.slug !== AUTO_BACKUP_SLUG
      ) {
        await contentConfigBackup({ rootPath, name: AUTO_BACKUP_NAME });
      }
      const res = await contentConfigRestore({
        rootPath,
        slug: p.slug,
        overwrite,
      });
      if (res.needsOverwrite) {
        setPending({ kind: "restore", slug: p.slug });
        return;
      }
      setPending(null);
      const copyName = displayName(p);
      setStatus(
        res.restored > 0
          ? t`Restored "${copyName}".`
          : t`"${copyName}" had nothing this folder can use, so nothing changed.`,
      );
      await load();
    });

  const remove = (p: ConfigProfile) =>
    run(async () => {
      await contentConfigDeleteProfile({ rootPath, slug: p.slug });
      setPending(null);
      await load();
    });

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Saved copies</Trans>
          </h2>
          <HelpPopover label={t`About saved copies`}>
            <p>
              <Trans>
                A copy holds this content folder's{" "}
                <span className="font-mono">springsettings.cfg</span>,{" "}
                <span className="font-mono">LuaUI/Config</span> and{" "}
                <span className="font-mono">uikeys.txt</span>, including the
                ones inside each engine folder. Restoring one puts all of them
                back.
              </Trans>
            </p>
          </HelpPopover>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setReplacing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save(false);
            }}
            placeholder={t`Name this copy`}
            aria-label={t`Name this copy`}
            disabled={busy}
          />
          <Button
            size="sm"
            onClick={() => save(false)}
            disabled={busy || !slug}
          >
            <Trans>Save</Trans>
          </Button>
        </div>

        {replacing && (
          <ConfirmBar
            message={t`A copy called "${trimmed}" already exists. Replace it?`}
            confirmLabel={t`Replace`}
            busy={busy}
            onCancel={() => setReplacing(false)}
            onConfirm={() => save(true)}
          />
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        {profiles === null ? (
          <SkeletonList />
        ) : profiles.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            <Trans>No saved copies for this content folder yet.</Trans>
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {profiles.map((p) => {
              const copyName = displayName(p);
              const parts = p.artifacts
                .map((a) => (ARTIFACT_LABEL[a] ? i18n._(ARTIFACT_LABEL[a]) : a))
                .join(", ");
              const confirming = pending?.slug === p.slug ? pending.kind : null;
              return (
                <li key={p.slug} className="py-2 ps-4 pe-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block truncate text-sm">{copyName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDateTime(new Date(p.createdAtMs))}
                        {" · "}
                        {parts || t`empty`}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void restore(p, false)}
                        disabled={busy}
                      >
                        <Trans>Restore</Trans>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setPending({ kind: "delete", slug: p.slug })
                        }
                        disabled={busy}
                        aria-label={t`Delete ${copyName}`}
                        title={t`Delete ${copyName}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {confirming === "restore" && (
                    <ConfirmBar
                      message={t`Overwrite your current config with this copy?`}
                      confirmLabel={t`Overwrite`}
                      busy={busy}
                      onCancel={() => setPending(null)}
                      onConfirm={() => void restore(p, true)}
                    />
                  )}
                  {confirming === "delete" && (
                    <ConfirmBar
                      message={t`Delete this copy? It cannot be undone.`}
                      confirmLabel={t`Delete`}
                      busy={busy}
                      onCancel={() => setPending(null)}
                      onConfirm={() => void remove(p)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SettingList>
        <SettingRow
          id="auto-backup-engine-config"
          label={t`Back up before restoring`}
          helpLabel={t`About backing up before restoring`}
          help={
            <p>
              <Trans>
                Saves your current config as "Automatic backup" just before a
                restore overwrites it, replacing the last one.
              </Trans>
            </p>
          }
        >
          <Switch
            id="auto-backup-engine-config"
            checked={prefs.autoBackupEngineConfig}
            onCheckedChange={(v) =>
              setPrefs({ ...prefs, autoBackupEngineConfig: v === true })
            }
          />
        </SettingRow>
      </SettingList>
    </div>
  );
}

/** An inline "are you sure" under the thing it is about. */
function ConfirmBar({
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  message: ReactNode;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
    >
      <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
        <TriangleAlert className="size-4 shrink-0" />
        {message}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
