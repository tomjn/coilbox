import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { FileArchive, Loader2, Trash2, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  type CompatBuilt,
  type CompatExported,
  type CompatStatus,
  compatBuild,
  compatExport,
  compatRemove,
  compatStatus,
} from "../../../compat/bindings";
import { staleReason } from "../../../compat/staleReason";
import {
  useCompatSettings,
  withCompatEntry,
  withoutCompatEntry,
} from "../../compatSettings";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Compatibility mode for one game (issue #4561). The switch is the only thing
 * that builds the game's mutator: turning it on builds from the latest manifest,
 * turning it off keeps the folder and changes the setting. Rebuild shows when
 * the folder is stale and Remove deletes it.
 */
export function CompatMode({
  enginePath,
  dataDir,
  archiveName,
  gameName,
  checksum,
}: {
  enginePath: string;
  dataDir: string;
  archiveName: string;
  gameName: string;
  /** The archive's checksum from unitsync, or undefined while it is read. */
  checksum?: string;
}) {
  const [settings, setSettings] = useCompatSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [status, setStatus] = useState<CompatStatus | null>(null);
  const [built, setBuilt] = useState<CompatBuilt | null>(null);
  const [busy, setBusy] = useState<"build" | "remove" | "export" | null>(null);
  const [exported, setExported] = useState<CompatExported | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!checksum) return null;
    try {
      const next = await compatStatus({
        dataDir,
        archiveName,
        baseChecksum: checksum,
      });
      setStatus(next);
      return next;
    } catch (e) {
      setError(msg(e));
      return null;
    }
  }, [dataDir, archiveName, checksum]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabled = settings[archiveName]?.enabled ?? false;
  const stale = status?.stale ?? [];
  const current = !!status?.folder && stale.length === 0;

  const build = async (enable: boolean) => {
    if (!checksum || !status) return;
    setBusy("build");
    setError(null);
    try {
      const result = await compatBuild({
        dataDir,
        enginePath,
        archiveName,
        gameName,
        baseChecksum: checksum,
        manifestVersion: status.latest,
      });
      setBuilt(result);
      setExported(null);
      setSettings(
        withCompatEntry(settingsRef.current, archiveName, {
          enabled: enable,
          version: status.latest,
        }),
      );
      await refresh();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (on: boolean) => {
    if (!on) {
      setSettings(
        withCompatEntry(settingsRef.current, archiveName, {
          enabled: false,
          version:
            settingsRef.current[archiveName]?.version ?? status?.latest ?? 0,
        }),
      );
      return;
    }
    if (current && status) {
      setSettings(
        withCompatEntry(settingsRef.current, archiveName, {
          enabled: true,
          version: status.latest,
        }),
      );
      return;
    }
    void build(true);
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      await compatRemove({ dataDir, archiveName });
      setBuilt(null);
      setExported(null);
      setSettings(withoutCompatEntry(settingsRef.current, archiveName));
      await refresh();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const exportSdz = async () => {
    if (!checksum || !status?.folder) return;
    setError(null);
    try {
      const dest = await save({
        title: "Export compatibility mutator",
        defaultPath: status.folder.replace(/\.sdd$/i, ".sdz"),
        filters: [{ name: "Mutator archive", extensions: ["sdz"] }],
      });
      if (!dest) return;
      setBusy("export");
      setExported(
        await compatExport({
          dataDir,
          archiveName,
          baseChecksum: checksum,
          dest,
        }),
      );
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(null);
    }
  };

  const label = "Compatibility mode";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="compat-mode"
            aria-label={label}
            checked={enabled}
            disabled={!checksum || !status || busy !== null}
            onCheckedChange={toggle}
          />
          <label htmlFor="compat-mode" className="text-sm">
            {label}
          </label>
          {busy === "build" && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Building
            </span>
          )}
        </div>
        {status?.folder && stale.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy !== null}
            onClick={() => void build(enabled)}
          >
            <Wrench className="size-4" /> Rebuild
          </Button>
        )}
        {current && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy !== null}
            onClick={() => void exportSdz()}
          >
            {busy === "export" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileArchive className="size-4" />
            )}
            Export .sdz
          </Button>
        )}
        {status?.folder && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === "remove" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Remove
          </Button>
        )}
      </div>

      {status?.folder && (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{status.folder}</span>
          {stale.length > 0 && (
            <> is out of date: {stale.map(staleReason).join("; ")}.</>
          )}
        </p>
      )}

      {exported && (
        <p className="text-xs text-muted-foreground">
          Exported {plural(exported.files.length, "file", "files")} to{" "}
          <span className="font-mono">{exported.path}</span>
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {built && <BuildResult built={built} />}
    </div>
  );
}

/** What a build wrote, and why its models are not used when they are not. */
export function BuildResult({ built }: { built: CompatBuilt }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <ul className="flex flex-col gap-0.5">
        <li>
          {plural(built.models.modelsWritten, "model", "models")} converted
          {built.models.modelsFound > built.models.modelsWritten
            ? ` of ${built.models.modelsFound}`
            : ""}
        </li>
        <li>
          {plural(
            built.preludeFixes.length,
            "prelude function",
            "prelude functions",
          )}
        </li>
        <li>
          Gadgets enabled:{" "}
          {built.gadgets.length > 0 ? built.gadgets.join(", ") : "none"}
        </li>
        <li>{plural(built.defOverrides, "def override", "def overrides")}</li>
      </ul>
      {built.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {built.models.errors.map((e) => (
        <p key={e} className="text-destructive">
          {e}
        </p>
      ))}
    </div>
  );
}
