import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, FolderPlus, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useDefaultWriteRoot } from "../../downloads/config";
import {
  type ContentState,
  contentAddRoot,
  contentCreateStandardRoot,
  contentOpenPath,
  contentRemoveRoot,
  contentRescan,
  contentScanRoot,
} from "../bindings";
import { useContentPrefs, useContentState, useSetupStatus } from "../config";
import { RootCard } from "./components/RootCard";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Content Folders settings section: lists tracked Spring/Recoil data roots,
 * supports rescan / manual add (with an "Add anyway" override) / per-root rescan
 * & remove, and holds the detection preferences. The frame renders the section
 * title, so this is the body only.
 */
export default function FoldersSection() {
  const { state, setState, loading, error } = useContentState();
  const [prefs, setPrefs] = useContentPrefs();
  const [rescanning, setRescanning] = useState(false);
  const [busyRoot, setBusyRoot] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addError, setAddError] = useState<{
    path: string;
    message: string;
  } | null>(null);
  // Store the next added folder as a path relative to the app dir (portable).
  const [addPortable, setAddPortable] = useState(false);
  const { standardPath } = useSetupStatus();
  const ensureWriteRoot = useDefaultWriteRoot();

  const doRescan = useCallback(async () => {
    setRescanning(true);
    setActionError(null);
    try {
      const { state } = await contentRescan({
        withCounts: true,
        includeZerok: prefs.probeZeroK,
      });
      setState(state);
    } catch (e) {
      setActionError(msg(e));
    } finally {
      setRescanning(false);
    }
  }, [prefs.probeZeroK, setState]);

  // First-run detection: rescan once if there's no prior snapshot.
  const autoScanned = useRef(false);
  useEffect(() => {
    if (autoScanned.current || loading || !state) return;
    if (state.lastScanAt == null && prefs.autoScanOnStartup) {
      autoScanned.current = true;
      doRescan();
    }
  }, [loading, state, prefs.autoScanOnStartup, doRescan]);

  const pickAndAdd = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Select a Spring/Recoil data folder",
    });
    if (typeof picked !== "string") return;
    setActionError(null);
    try {
      const { state } = await contentAddRoot({
        path: picked,
        portable: addPortable,
      });
      setState(state);
      ensureWriteRoot(state);
      setAddError(null);
    } catch (e) {
      setAddError({ path: picked, message: msg(e) });
    }
  };

  const createStandard = async () => {
    setActionError(null);
    try {
      const { state } = await contentCreateStandardRoot(undefined);
      setState(state);
      ensureWriteRoot(state);
    } catch (e) {
      setActionError(msg(e));
    }
  };

  const addAnyway = async () => {
    if (!addError) return;
    try {
      const { state } = await contentAddRoot({
        path: addError.path,
        force: true,
        portable: addPortable,
      });
      setState(state);
      ensureWriteRoot(state);
    } catch (e) {
      setActionError(msg(e));
    } finally {
      setAddError(null);
    }
  };

  const rescanRoot = async (path: string) => {
    setBusyRoot(path);
    setActionError(null);
    try {
      const { root } = await contentScanRoot({ path });
      setState((s: ContentState | null) =>
        s
          ? { ...s, roots: s.roots.map((r) => (r.id === root.id ? root : r)) }
          : s,
      );
    } catch (e) {
      setActionError(msg(e));
    } finally {
      setBusyRoot(null);
    }
  };

  const removeRoot = async (path: string) => {
    setActionError(null);
    try {
      const { state } = await contentRemoveRoot({ path });
      setState(state);
    } catch (e) {
      setActionError(msg(e));
    }
  };

  const openRoot = (path: string) => {
    contentOpenPath({ path }).catch((e) => setActionError(msg(e)));
  };

  const roots = state?.roots ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Spring/Recoil data roots, auto-detected and added by hand.
          </p>
          <div className="flex items-center gap-2">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control */}
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              title="Store the added folder as a path relative to the app dir, so it follows the executable in a portable install. The folder must be inside the app folder."
            >
              <Checkbox
                checked={addPortable}
                onCheckedChange={(v) => setAddPortable(v === true)}
              />
              Portable
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={pickAndAdd}
            >
              <FolderPlus className="size-4" />
              Add folder
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={rescanning}
              onClick={doRescan}
            >
              {rescanning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Rescan
            </Button>
          </div>
        </div>

        {(error || actionError) && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription className="break-words">
              {error ?? actionError}
            </AlertDescription>
          </Alert>
        )}

        {addError && (
          <Alert variant="warning" className="flex flex-col gap-2">
            <span className="break-words">{addError.message}</span>
            <span className="break-all font-mono text-xs text-muted-foreground">
              {addError.path}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addAnyway}
              >
                Add anyway
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAddError(null)}
              >
                Cancel
              </Button>
            </div>
          </Alert>
        )}

        {loading && !state ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-32 rounded-lg border border-border/50 bg-card" />
            <Skeleton className="h-32 rounded-lg border border-border/50 bg-card" />
          </div>
        ) : roots.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No content folders found yet. Rescan to detect standard locations,
              or add one manually.
            </p>
            <div className="flex items-center gap-2">
              {standardPath && (
                <Button type="button" size="sm" onClick={createStandard}>
                  <FolderPlus className="size-4" />
                  Create folder at {standardPath}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={pickAndAdd}
              >
                <FolderPlus className="size-4" />
                Add folder
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {roots.map((root) => (
              <RootCard
                key={root.id}
                root={root}
                busy={busyRoot === root.path}
                onRescan={rescanRoot}
                onRemove={removeRoot}
                onOpen={openRoot}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Detection
        </h2>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control */}
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox
            checked={prefs.autoScanOnStartup}
            onCheckedChange={(v) =>
              setPrefs({ ...prefs, autoScanOnStartup: v === true })
            }
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium leading-none">Scan on startup</span>
            <span className="text-xs leading-snug text-muted-foreground">
              Detect standard data roots the first time this section opens.
            </span>
          </span>
        </label>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control */}
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox
            checked={prefs.probeZeroK}
            onCheckedChange={(v) =>
              setPrefs({ ...prefs, probeZeroK: v === true })
            }
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium leading-none">
              Probe Zero-K / Steam
            </span>
            <span className="text-xs leading-snug text-muted-foreground">
              Also check Steam install locations for Zero-K during a rescan.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
