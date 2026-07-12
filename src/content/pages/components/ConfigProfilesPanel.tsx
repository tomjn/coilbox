import { Button, Input } from "@picoframe/frame";
import { RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  type ConfigProfile,
  contentConfigBackup,
  contentConfigDeleteProfile,
  contentConfigProfiles,
  contentConfigRestore,
} from "../../bindings";
import { useContentPrefs } from "../../config";

/** Friendly label for each captured artifact id. */
const ARTIFACT_LABEL: Record<string, string> = {
  "springsettings.cfg": "settings",
  "uikeys.txt": "keybinds",
  "LuaUI/Config": "widget config",
};

const AUTO_BACKUP_NAME = "Auto-backup";

/**
 * Backup/restore profiles for the selected content root's engine config
 * (`springsettings.cfg`, `LuaUI/Config/`, `uikeys.txt`). Save the current config
 * as a named profile, restore one (with an overwrite confirmation, since restore
 * clobbers the live files), or delete a profile. An optional auto-backup snapshots
 * the current config to a reserved profile just before a restore.
 */
export function ConfigProfilesPanel({ rootPath }: { rootPath: string }) {
  const [prefs, setPrefs] = useContentPrefs();
  const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // A restore that needs overwrite confirmation (target files already exist).
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { profiles } = await contentConfigProfiles({ rootPath });
      setProfiles(profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [rootPath]);

  useEffect(() => {
    setConfirmSlug(null);
    setStatus(null);
    setError(null);
    void refresh();
  }, [refresh]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await contentConfigBackup({ rootPath, name: trimmed });
      setName("");
      setStatus(`Saved profile "${trimmed}".`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (p: ConfigProfile, overwrite: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // Optional safety net: snapshot the live config before overwriting it.
      if (overwrite && prefs.autoBackupEngineConfig) {
        await contentConfigBackup({ rootPath, name: AUTO_BACKUP_NAME });
      }
      const res = await contentConfigRestore({
        rootPath,
        slug: p.slug,
        overwrite,
      });
      if (res.needsOverwrite) {
        setConfirmSlug(p.slug);
        setStatus(null);
      } else {
        setConfirmSlug(null);
        setStatus(`Restored "${p.name}" (${res.restored} item(s)).`);
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: ConfigProfile) => {
    setBusy(true);
    setError(null);
    try {
      await contentConfigDeleteProfile({ rootPath, slug: p.slug });
      if (confirmSlug === p.slug) setConfirmSlug(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
      <div>
        <h2 className="text-sm font-semibold">Settings profiles</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Snapshot and swap this content folder's{" "}
          <span className="font-mono">springsettings.cfg</span>,{" "}
          <span className="font-mono">LuaUI/Config</span> and{" "}
          <span className="font-mono">uikeys.txt</span>.
        </p>
      </div>

      {/* Save the current config as a named profile. */}
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          placeholder="New profile name"
          className="h-8 flex-1"
          disabled={busy}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={save}
          disabled={busy || !name.trim()}
        >
          <Save className="size-4" /> Back up
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {status && !error && (
        <p className="text-xs text-muted-foreground">{status}</p>
      )}

      {profiles.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">
          No saved profiles yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {profiles.map((p) => {
            const confirming = confirmSlug === p.slug;
            const parts = p.artifacts
              .map((a) => ARTIFACT_LABEL[a] ?? a)
              .join(", ");
            return (
              <li
                key={p.slug}
                className="rounded-md border border-border/50 bg-background p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {p.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {new Date(p.createdAtMs).toLocaleString()}
                      {parts ? ` · ${parts}` : " · empty"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => restore(p, false)}
                      disabled={busy}
                    >
                      <RotateCcw className="size-4" /> Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(p)}
                      disabled={busy}
                      aria-label={`Delete profile ${p.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {confirming && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="size-4 shrink-0" />
                      Overwrite the current settings with this profile?
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmSlug(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => restore(p, true)}
                        disabled={busy}
                      >
                        Overwrite
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          id="auto-backup-engine-config"
          checked={prefs.autoBackupEngineConfig}
          onCheckedChange={(v) =>
            setPrefs({ ...prefs, autoBackupEngineConfig: v === true })
          }
        />
        <Label
          htmlFor="auto-backup-engine-config"
          className="font-normal text-muted-foreground"
        >
          Auto-backup current settings before restoring
        </Label>
      </div>
    </section>
  );
}
