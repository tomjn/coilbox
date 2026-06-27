import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { AlertCircle, FolderPlus, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type ContentState,
  contentAddRoot,
  contentRemoveRoot,
  contentRescan,
  contentScanRoot,
} from "../bindings";
import { useContentPrefs, useContentState } from "../config";
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
      const { state } = await contentAddRoot({ path: picked });
      setState(state);
      setAddError(null);
    } catch (e) {
      setAddError({ path: picked, message: msg(e) });
    }
  };

  const addAnyway = async () => {
    if (!addError) return;
    try {
      const { state } = await contentAddRoot({
        path: addError.path,
        force: true,
      });
      setState(state);
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
    openPath(path).catch((e) => setActionError(msg(e)));
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
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{error ?? actionError}</span>
          </div>
        )}

        {addError && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
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
          </div>
        )}

        {loading && !state ? (
          <div className="flex flex-col gap-3">
            <div className="h-32 animate-pulse rounded-lg border border-border/50 bg-card" />
            <div className="h-32 animate-pulse rounded-lg border border-border/50 bg-card" />
          </div>
        ) : roots.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No content folders found yet. Rescan to detect standard locations,
              or add one manually.
            </p>
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
