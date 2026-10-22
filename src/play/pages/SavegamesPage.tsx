import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Play, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { contentDeleteSave } from "@/content/bindings";
import {
  useContentState,
  useSaves,
  useScanTargetSelection,
} from "@/content/config";
import { BrowserToolbar } from "@/content/pages/components/BrowserToolbar";
import { FilterBar } from "@/content/pages/components/FilterBar";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "@/content/pages/components/states";
import { describeError } from "@/i18n/uiError";
import { formatBytes, formatDateTime } from "@/lib/format";
import { usePlay } from "../PlayProvider";

type SortKey = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const SORT_OPTIONS = [
  { value: "date-desc", label: msg`Newest` },
  { value: "date-asc", label: msg`Oldest` },
  { value: "name-asc", label: msg`Name A–Z` },
  { value: "name-desc", label: msg`Name Z–A` },
];

function savedAt(ms: number): string {
  if (!ms) return "";
  return formatDateTime(new Date(ms), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Local singleplayer savegames in the selected content root's `Saves/` folder.
 * Each save lists its map/game/date; Resume launches the engine into it (passing
 * the save as the positional arg, like a replay), and Delete removes the file.
 * A save must resume with the root it was saved in, so `dataDir` is the selected
 * root and the engine is that root's selected engine.
 */
export default function SavegamesPage() {
  const { t, i18n } = useLingui();
  const { targets, selected, selectedKey } = useScanTargetSelection();
  const { state } = useContentState();
  const { saves, loading, error, refresh, ready } = useSaves(
    selected?.rootPath,
  );
  const { running, launchSave } = usePlay();

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("date-desc");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // The save must launch with an engine + the root it lives in. Resolve the
  // selected target's engine executable from content state.
  const executable = useMemo(() => {
    if (!selected) return undefined;
    const root = state?.roots.find((r) => r.path === selected.rootPath);
    return root?.engines.find((e) => e.path === selected.enginePath)
      ?.executable;
  }, [state, selected]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return saves;
    return saves.filter(
      (s) =>
        s.filename.toLowerCase().includes(q) ||
        (s.mapName?.toLowerCase().includes(q) ?? false),
    );
  }, [saves, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "date-asc":
          return a.modifiedMs - b.modifiedMs;
        case "name-asc":
          return a.filename.localeCompare(b.filename);
        case "name-desc":
          return b.filename.localeCompare(a.filename);
        default:
          return b.modifiedMs - a.modifiedMs;
      }
    });
    return arr;
  }, [filtered, sort]);

  const resume = async (savePath: string) => {
    if (!executable || !selected) return;
    setPending(true);
    setActionError(null);
    try {
      const res = await launchSave({
        savePath,
        executable,
        dataDir: selected.rootPath,
      });
      if (res.exitCode && res.exitCode !== 0) {
        const exitCode = res.exitCode;
        setActionError(t`Engine exited with code ${exitCode}.`);
      }
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setPending(false);
    }
  };

  const remove = async (savePath: string) => {
    setActionError(null);
    try {
      await contentDeleteSave({ path: savePath });
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      setActionError(describeError(e));
    }
  };

  const busy = loading || (!!selected && !ready);
  const trimmedFilter = filter.trim();

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">
          <Trans>Save Games</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Singleplayer saves in your content folder. Resume one to launch the
            engine into it.
          </Trans>
        </p>
      </header>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onRescan={refresh}
        scanning={loading}
      />

      {!busy && saves.length > 0 && (
        <FilterBar
          search={filter}
          onSearch={setFilter}
          searchPlaceholder={t`Filter savegames…`}
          searchLabel={t`Filter savegames`}
          sort={sort}
          onSort={(v) => setSort(v as SortKey)}
          sortOptions={SORT_OPTIONS.map((o) => ({
            value: o.value,
            label: i18n._(o.label),
          }))}
          total={saves.length}
          shown={sorted.length}
          noun={t`savegames`}
        />
      )}

      {error && <ErrorBanner message={error} />}
      {actionError && <ErrorBanner message={actionError} />}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : saves.length === 0 ? (
        <EmptyState
          label={t`No savegames found. Saves you make in-game appear here.`}
        />
      ) : sorted.length === 0 ? (
        <EmptyState label={t`No savegames match “${trimmedFilter}”.`} />
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((s) => {
            const meta = [
              savedAt(s.modifiedMs),
              formatBytes(s.sizeBytes),
            ].filter(Boolean);
            const confirming = confirmDelete === s.path;
            const saveFilename = s.filename;
            return (
              <li
                key={s.path}
                className="rounded-lg border border-border/50 bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <span
                      className="truncate text-sm font-medium"
                      title={s.filename}
                    >
                      {s.mapName ?? s.filename}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {meta.join(" · ")}
                    </span>
                    {s.gameType && (
                      <span className="truncate text-xs text-muted-foreground">
                        {s.gameType}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={() => resume(s.path)}
                      disabled={running || !executable}
                      title={
                        !executable
                          ? t`Install an engine to resume savegames.`
                          : running && !pending
                            ? t`A game is already running.`
                            : undefined
                      }
                      className="gap-1.5"
                    >
                      <Play className="size-4 fill-current" />
                      {pending ? t`Resuming…` : t`Resume`}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setConfirmDelete(s.path)}
                      disabled={running}
                      aria-label={t`Delete savegame ${saveFilename}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {confirming && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="size-4 shrink-0" />
                      <Trans>Delete this savegame? This can't be undone.</Trans>
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        <Trans>Cancel</Trans>
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(s.path)}
                      >
                        <Trans>Delete</Trans>
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
