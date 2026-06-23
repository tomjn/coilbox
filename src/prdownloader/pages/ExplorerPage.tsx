import { Button, Input, cn } from "@picoframe/frame";
import { AlertCircle, CheckCircle2, Download, FolderOpen, Loader2, Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Repo, type Version, prdDownload, prdRepos, prdVersion, prdVersions } from "../bindings";

const DEFAULT_MASTER = "https://repos.springrts.com";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Checks the bundled sidecar on mount and renders a warning *only* when it is
 * missing or won't run; nothing when it's healthy. Surfaces a wiring problem
 * (binary not bundled / not executable) before the user hits a confusing
 * download failure.
 */
function SidecarWarning() {
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      await prdVersion(undefined);
      setError(null);
    } catch (e) {
      setError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (!error) return null;

  return (
    <div className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-6 py-3 text-sm text-destructive">
      <AlertCircle size={16} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">pr-downloader sidecar unavailable</p>
        <p className="break-words text-destructive/90">{error}</p>
      </div>
      <Button variant="outline" size="sm" onClick={check}>
        Retry
      </Button>
    </div>
  );
}

function EmptyState({ icon: Icon, children }: { icon: typeof Package; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      <Icon size={28} className="opacity-40" />
      <p className="max-w-xs">{children}</p>
    </div>
  );
}

/** Rapid-content explorer: repositories on the left, the selected repo's versions on the right. */
export default function ExplorerPage() {
  const [masterUrl, setMasterUrl] = useState(DEFAULT_MASTER);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Repo | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadResult, setDownloadResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function loadRepos() {
    setReposLoading(true);
    setReposError(null);
    setSelected(null);
    setVersions(null);
    setDownloadResult(null);
    try {
      const { repos } = await prdRepos({ masterUrl: masterUrl.trim() || DEFAULT_MASTER });
      setRepos(repos);
    } catch (e) {
      setRepos(null);
      setReposError(errMessage(e));
    } finally {
      setReposLoading(false);
    }
  }

  async function selectRepo(repo: Repo) {
    setSelected(repo);
    setVersions(null);
    setVersionsError(null);
    setVersionsLoading(true);
    setDownloadResult(null);
    try {
      const { versions } = await prdVersions({ repoUrl: repo.url });
      setVersions(versions);
    } catch (e) {
      setVersionsError(errMessage(e));
    } finally {
      setVersionsLoading(false);
    }
  }

  async function download(tag: string) {
    setDownloading(tag);
    setDownloadResult(null);
    try {
      const { message } = await prdDownload({ tag });
      setDownloadResult({ ok: true, message });
    } catch (e) {
      setDownloadResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <header className="flex flex-col gap-4 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">pr-downloader</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Browse Spring/Recoil rapid content and download a tag through the bundled sidecar.
          </p>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            loadRepos();
          }}
        >
          <Input
            type="text"
            value={masterUrl}
            onChange={(e) => setMasterUrl(e.target.value)}
            placeholder={DEFAULT_MASTER}
            aria-label="Rapid master URL"
            className="max-w-md font-mono text-xs"
          />
          <Button type="submit" disabled={reposLoading}>
            {reposLoading && <Loader2 className="animate-spin" />}
            {reposLoading ? "Loading…" : "Load repos"}
          </Button>
        </form>
      </header>

      <SidecarWarning />

      {/* Master-detail */}
      <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr]">
        {/* Left: repositories */}
        <aside className="flex min-h-0 flex-col border-r border-border bg-card/30">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Repositories</span>
            {repos && <span className="font-normal normal-case">{repos.length}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {reposError && (
              <p className="m-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle size={14} className="mt-px shrink-0" />
                {reposError}
              </p>
            )}
            {!repos && !reposError && (
              <EmptyState icon={Package}>Load a rapid master to list its repositories.</EmptyState>
            )}
            {repos?.map((repo) => (
              <button
                type="button"
                key={repo.name}
                onClick={() => selectRepo(repo)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  selected?.name === repo.name && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <FolderOpen size={15} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{repo.name}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Right: versions in the selected repository */}
        <section className="flex min-h-0 flex-col">
          {!selected ? (
            <EmptyState icon={FolderOpen}>Select a repository to see its downloadable versions.</EmptyState>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-6 py-3">
                <Package size={16} className="text-muted-foreground" />
                <h2 className="font-medium">{selected.name}</h2>
                {versions && <span className="text-sm text-muted-foreground">· {versions.length} versions</span>}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {versionsLoading && (
                  <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" /> loading versions…
                  </p>
                )}
                {versionsError && (
                  <p className="m-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle size={15} className="mt-px shrink-0" />
                    {versionsError}
                  </p>
                )}
                {versions?.length === 0 && <EmptyState icon={Package}>No versions in this repository.</EmptyState>}
                <ul className="divide-y divide-border">
                  {versions?.map((v) => (
                    <li key={v.tag} className="flex items-center justify-between gap-3 px-6 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{v.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{v.tag}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => download(v.tag)}
                        disabled={downloading !== null}
                        aria-label={`Download ${v.tag}`}
                      >
                        {downloading === v.tag ? <Loader2 className="animate-spin" /> : <Download />}
                        {downloading === v.tag ? "Downloading…" : "Download"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {downloadResult && (
            <div
              className={cn(
                "flex items-start gap-2 border-t px-6 py-3 text-sm",
                downloadResult.ok
                  ? "border-border bg-card text-card-foreground"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {downloadResult.ok ? (
                <CheckCircle2 size={16} className="mt-px shrink-0 text-emerald-500" />
              ) : (
                <AlertCircle size={16} className="mt-px shrink-0" />
              )}
              <span className="min-w-0 break-words">{downloadResult.message}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
