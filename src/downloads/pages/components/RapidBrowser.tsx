import { Button, cn, Input } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  Package,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dlDownload,
  dlRepos,
  dlVersion,
  dlVersions,
  type Repo,
  type Version,
} from "../../bindings";
import { useDownloadsConfig } from "../../config";
import { OptionSelect } from "./OptionSelect";
import { EmptyState, errMessage } from "./states";

const DEFAULT_MASTER = "https://repos.springrts.com";

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
      await dlVersion(undefined);
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

/**
 * Rapid-content browser: a master dropdown (from configured repositories) over a
 * repositories/versions master-detail. Downloads the chosen tag through the
 * sidecar, pointing it at the selected master and the configured write root.
 * Shared by the Browse Rapid page and the Games page's rapid source.
 */
export function RapidBrowser({ writePath }: { writePath?: string }) {
  const [cfg] = useDownloadsConfig();
  const [masterUrl, setMasterUrl] = useState(
    () => cfg.rapidRepos[0]?.url ?? DEFAULT_MASTER,
  );
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  const [selected, setSelected] = useState<Repo | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionFilter, setVersionFilter] = useState("");

  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadResult, setDownloadResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function loadRepos(url = masterUrl) {
    setReposLoading(true);
    setReposError(null);
    setSelected(null);
    setVersions(null);
    setDownloadResult(null);
    try {
      const { repos } = await dlRepos({
        masterUrl: url.trim() || DEFAULT_MASTER,
      });
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
    setVersionFilter("");
    setDownloadResult(null);
    try {
      const { versions } = await dlVersions({ repoUrl: repo.url });
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
      const { message } = await dlDownload({ tag, masterUrl, writePath });
      setDownloadResult({ ok: true, message });
    } catch (e) {
      setDownloadResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
  }

  const filteredRepos = useMemo(() => {
    if (!repos) return null;
    const q = repoFilter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.name.toLowerCase().includes(q));
  }, [repos, repoFilter]);

  const filteredVersions = useMemo(() => {
    if (!versions) return null;
    const q = versionFilter.trim().toLowerCase();
    if (!q) return versions;
    return versions.filter(
      (v) =>
        v.name.toLowerCase().includes(q) || v.tag.toLowerCase().includes(q),
    );
  }, [versions, versionFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        {cfg.rapidRepos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rapid repositories configured. Add one in Downloads settings.
          </p>
        ) : (
          <>
            <OptionSelect
              value={masterUrl}
              onValueChange={(url) => {
                setMasterUrl(url);
                loadRepos(url);
              }}
              placeholder="Select a rapid repository…"
              className="max-w-xs"
              options={cfg.rapidRepos.map((r) => ({
                value: r.url,
                label: r.name || r.url,
              }))}
            />
            <Button onClick={() => loadRepos()} disabled={reposLoading}>
              {reposLoading && <Loader2 className="animate-spin" />}
              {reposLoading ? "Loading…" : "Load repos"}
            </Button>
          </>
        )}
      </div>

      <SidecarWarning />

      <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr]">
        {/* Left: repositories */}
        <aside className="flex min-h-0 flex-col border-r border-border bg-card/30">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Repositories</span>
            {repos && (
              <span className="font-normal normal-case">
                {repoFilter.trim() && filteredRepos
                  ? `${filteredRepos.length} / ${repos.length}`
                  : repos.length}
              </span>
            )}
          </div>
          {repos && repos.length > 0 && (
            <div className="relative px-3 pb-2">
              <Search
                size={14}
                className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="text"
                value={repoFilter}
                onChange={(e) => setRepoFilter(e.target.value)}
                placeholder="Filter repositories…"
                aria-label="Filter repositories"
                className="h-8 pl-7 text-xs"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {reposError && (
              <p className="m-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle size={14} className="mt-px shrink-0" />
                {reposError}
              </p>
            )}
            {!repos && !reposError && (
              <EmptyState icon={Package}>
                Load a rapid master to list its repositories.
              </EmptyState>
            )}
            {repos && filteredRepos?.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                No repositories match “{repoFilter.trim()}”.
              </p>
            )}
            {filteredRepos?.map((repo) => (
              <button
                type="button"
                key={repo.name}
                onClick={() => selectRepo(repo)}
                className={cn(
                  "flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  selected?.name === repo.name &&
                    "bg-accent font-medium text-accent-foreground",
                )}
              >
                <FolderOpen
                  size={15}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="truncate">{repo.name}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Right: versions in the selected repository */}
        <section className="flex min-h-0 flex-col">
          {!selected ? (
            <EmptyState icon={FolderOpen}>
              Select a repository to see its downloadable versions.
            </EmptyState>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-6 py-3">
                <Package size={16} className="text-muted-foreground" />
                <h2 className="font-medium">{selected.name}</h2>
                {versions && (
                  <span className="text-sm text-muted-foreground">
                    ·{" "}
                    {versionFilter.trim() && filteredVersions
                      ? `${filteredVersions.length} / ${versions.length}`
                      : versions.length}{" "}
                    versions
                  </span>
                )}
                {versions && versions.length > 0 && (
                  <div className="relative ml-auto">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      type="text"
                      value={versionFilter}
                      onChange={(e) => setVersionFilter(e.target.value)}
                      placeholder="Filter versions…"
                      aria-label="Filter versions"
                      className="h-8 w-56 pl-7 text-xs"
                    />
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {versionsLoading && (
                  <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" /> loading
                    versions…
                  </p>
                )}
                {versionsError && (
                  <p className="m-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircle size={15} className="mt-px shrink-0" />
                    {versionsError}
                  </p>
                )}
                {versions?.length === 0 && (
                  <EmptyState icon={Package}>
                    No versions in this repository.
                  </EmptyState>
                )}
                {versions &&
                  versions.length > 0 &&
                  filteredVersions?.length === 0 && (
                    <EmptyState icon={Search}>
                      No versions match “{versionFilter.trim()}”.
                    </EmptyState>
                  )}
                <ul className="divide-y divide-border">
                  {filteredVersions?.map((v) => (
                    <li
                      key={v.tag}
                      className="flex items-center justify-between gap-3 px-6 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{v.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {v.tag}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => download(v.tag)}
                        disabled={downloading !== null}
                        aria-label={`Download ${v.tag}`}
                      >
                        {downloading === v.tag ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Download />
                        )}
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
                <CheckCircle2
                  size={16}
                  className="mt-px shrink-0 text-emerald-500"
                />
              ) : (
                <AlertCircle size={16} className="mt-px shrink-0" />
              )}
              <span className="min-w-0 break-words">
                {downloadResult.message}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
