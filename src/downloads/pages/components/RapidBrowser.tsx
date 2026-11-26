import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn, Input } from "@picoframe/frame";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Loader2,
  Package,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { isDeletableArchive } from "../../../content/format";
import { DeleteArchiveButton } from "../../../content/pages/components/DeleteArchiveButton";
import {
  EmptyState,
  ErrorBanner,
} from "../../../content/pages/components/states";
import { errorText } from "../../../lib/helpers";
import { refreshedLabel } from "../../../lib/relativeTime";
import { visibleRowWindow } from "../../../lib/rowVirtualize";
import {
  dlRepos,
  dlVersion,
  dlVersions,
  type Repo,
  type Version,
} from "../../bindings";
import { useDownloadsConfig } from "../../config";
import {
  identityOf,
  useDownloadComplete,
  useDownloadQueue,
} from "../../DownloadQueueProvider";
import { usableRapidRepos } from "../../rapidMasters";
import { orderRapidVersions } from "../../rapidVersionOrder";
import { QueueProgress } from "./ProgressBar";

const DEFAULT_MASTER = "https://repos.springrts.com";

/** Every version row is this tall, so the list can render only the rows on
 *  screen. Beyond All Reason's `byar` repository lists over 12,000 versions,
 *  and a DOM row for each froze the window on every keystroke in the filter. */
const VERSION_ROW_HEIGHT = 80;
const OVERSCAN = 6;

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
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (!error) return null;

  return (
    <Alert
      variant="destructive"
      className="flex items-start gap-2 rounded-none border-x-0 border-t-0 px-6"
    >
      <AlertCircle size={16} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <Trans>pr-downloader is unavailable</Trans>
        </p>
        <p className="break-words text-destructive/90">{error}</p>
      </div>
      <Button variant="outline" size="sm" onClick={check}>
        <Trans>Retry</Trans>
      </Button>
    </Alert>
  );
}

/**
 * Rapid-content browser: a master dropdown (from configured repositories) over a
 * repositories/versions master-detail. Downloads the chosen tag through the
 * sidecar, pointing it at the selected master and the configured write root.
 * Shared by the Browse Rapid page and the Games page's rapid source.
 */
export function RapidBrowser({ writePath }: { writePath?: string }) {
  const { t } = useLingui();
  const [cfg] = useDownloadsConfig();
  const masters = usableRapidRepos(cfg.rapidRepos);
  const [masterUrl, setMasterUrl] = useState(
    () => masters[0]?.url ?? DEFAULT_MASTER,
  );
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [reposAge, setReposAge] = useState<number | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  const [selected, setSelected] = useState<Repo | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsAge, setVersionsAge] = useState<number | null>(null);
  const [versionFilter, setVersionFilter] = useState("");
  const deferredVersionFilter = useDeferredValue(versionFilter);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    if (!scroller) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  // Each load bumps its counter, and a reply whose number is no longer the
  // latest is dropped, so a slow answer for an earlier click never replaces
  // what the user has picked since.
  const reposRequest = useRef(0);
  const versionsRequest = useRef(0);

  const loadRepos = useCallback(async (url: string, refresh = false) => {
    const request = ++reposRequest.current;
    versionsRequest.current++;
    setReposLoading(true);
    setReposError(null);
    setSelected(null);
    setVersions(null);
    setVersionsLoading(false);
    setVersionsError(null);
    const masterUrl = url.trim() || DEFAULT_MASTER;
    try {
      const { repos, ageSecs, stale } = await dlRepos({ masterUrl, refresh });
      if (request !== reposRequest.current) return;
      setRepos(repos);
      setReposAge(ageSecs);
      setReposLoading(false);
      if (!stale) return;
      // Show the disk copy, then fetch it once this launch and swap it in.
      const fresh = await dlRepos({ masterUrl, revalidate: true });
      if (request !== reposRequest.current) return;
      setRepos(fresh.repos);
      setReposAge(fresh.ageSecs);
    } catch (e) {
      if (request !== reposRequest.current) return;
      setRepos(null);
      setReposAge(null);
      setReposError(errorText(e));
    } finally {
      if (request === reposRequest.current) setReposLoading(false);
    }
  }, []);

  // Auto-load the initial master once on mount so there's no "Load repos" click.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (autoLoaded.current || masters.length === 0) return;
    autoLoaded.current = true;
    loadRepos(masterUrl);
  }, [masters.length, masterUrl, loadRepos]);

  async function selectRepo(repo: Repo, refresh = false) {
    const request = ++versionsRequest.current;
    setSelected(repo);
    setVersions(null);
    setVersionsAge(null);
    setVersionsError(null);
    setVersionsLoading(true);
    if (!refresh) setVersionFilter("");
    const args = { repoUrl: repo.url, dataDir: writePath };
    try {
      const { versions, ageSecs, stale } = await dlVersions({
        ...args,
        refresh,
      });
      if (request !== versionsRequest.current) return;
      setVersions(orderRapidVersions(versions));
      setVersionsAge(ageSecs);
      setVersionsLoading(false);
      if (!stale) return;
      const fresh = await dlVersions({ ...args, revalidate: true });
      if (request !== versionsRequest.current) return;
      setVersions(orderRapidVersions(fresh.versions));
      setVersionsAge(fresh.ageSecs);
    } catch (e) {
      if (request !== versionsRequest.current) return;
      setVersionsError(errorText(e));
    } finally {
      if (request === versionsRequest.current) setVersionsLoading(false);
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
    const q = deferredVersionFilter.trim().toLowerCase();
    if (!q) return versions;
    return versions.filter(
      (v) =>
        v.name.toLowerCase().includes(q) || v.tag.toLowerCase().includes(q),
    );
  }, [versions, deferredVersionFilter]);

  // Another repository or filter starts at the top, or a filter that narrows
  // 12,000 rows to 3 would leave the view scrolled far past all of them. A
  // finished download marking its row installed keeps the place.
  const listKey = `${selected?.url ?? ""}\n${deferredVersionFilter}`;
  const shownListKey = useRef(listKey);
  useLayoutEffect(() => {
    if (!scroller || shownListKey.current === listKey) return;
    shownListKey.current = listKey;
    scroller.scrollTop = 0;
    setScrollTop(0);
  }, [listKey, scroller]);

  // Several tags can name one package, so installing or deleting it changes
  // every row with its md5.
  const setInstalled = useCallback((md5: string, installed: boolean) => {
    if (!md5) return;
    setVersions((list) =>
      list?.some((v) => v.md5 === md5 && v.installed !== installed)
        ? list.map((v) => (v.md5 === md5 ? { ...v, installed } : v))
        : list,
    );
  }, []);

  // The queue forgets a finished download shortly after, so the row has to
  // remember it was installed rather than read it from the queue.
  useDownloadComplete((item) => {
    if (item.kind !== "rapid") return;
    const { tag } = item.args;
    const md5 = versions?.find((v) => v.tag === tag)?.md5;
    if (md5) setInstalled(md5, true);
  });

  const { start, end } = visibleRowWindow(
    scrollTop,
    viewportHeight,
    filteredVersions?.length ?? 0,
    VERSION_ROW_HEIGHT,
    OVERSCAN,
  );

  const repoQuery = repoFilter.trim();
  const versionQuery = versionFilter.trim();
  const shownVersions = filteredVersions?.length ?? 0;
  const totalVersions = versions?.length ?? 0;
  const repoName = selected?.name ?? "";
  return (
    <div className="@container flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        {masters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No rapid repositories configured. Add one in{" "}
              <Link
                className="underline underline-offset-4"
                to="/settings/sources"
              >
                Sources settings
              </Link>
              .
            </Trans>
          </p>
        ) : (
          <>
            <OptionSelect
              value={masterUrl}
              onValueChange={(url) => {
                setMasterUrl(url);
                loadRepos(url);
              }}
              placeholder={t`Select a rapid repository…`}
              className="max-w-xs"
              options={masters.map((r) => ({
                value: r.url,
                label: r.name || r.url,
              }))}
            />
            <Button
              onClick={() => loadRepos(masterUrl, true)}
              disabled={reposLoading}
            >
              {reposLoading && <Loader2 className="animate-spin" />}
              {reposLoading ? t`Loading…` : t`Load repos`}
            </Button>
            {reposAge !== null && (
              <span className="text-xs text-muted-foreground">
                {refreshedLabel(reposAge)}
              </span>
            )}
          </>
        )}
      </div>

      <SidecarWarning />

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 @[38rem]:grid-cols-[18rem_1fr] @[38rem]:grid-rows-1">
        {/* Left: repositories */}
        <aside className="flex min-h-0 flex-col border-b border-border bg-card/30 @[38rem]:border-r @[38rem]:border-b-0">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>
              <Trans>Repositories</Trans>
            </span>
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
                placeholder={t`Filter repositories…`}
                aria-label={t`Filter repositories`}
                className="h-8 pl-7 text-xs"
              />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {reposError && (
              <div className="m-3">
                <ErrorBanner message={reposError} />
              </div>
            )}
            {!repos && !reposError && (
              <div className="m-3">
                <EmptyState
                  icon={Package}
                  label={t`Load a rapid master to list its repositories.`}
                />
              </div>
            )}
            {repos && filteredRepos?.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted-foreground">
                <Trans>No repositories match “{repoQuery}”.</Trans>
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
            <div className="m-6">
              <EmptyState
                icon={FolderOpen}
                label={t`Select a repository to see its downloadable versions.`}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-border px-6 py-3">
                <Package size={16} className="text-muted-foreground" />
                <h2 className="font-medium">{selected.name}</h2>
                {versions && (
                  <span className="text-sm text-muted-foreground">
                    ·{" "}
                    {versionFilter.trim() && filteredVersions
                      ? t`${shownVersions} / ${totalVersions} versions`
                      : plural(totalVersions, {
                          one: "# version",
                          other: "# versions",
                        })}
                  </span>
                )}
                {versionsAge !== null && (
                  <span className="text-xs text-muted-foreground">
                    {refreshedLabel(versionsAge)}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => selectRepo(selected, true)}
                  disabled={versionsLoading}
                  aria-label={t`Refresh ${repoName} versions`}
                  className={versions && versions.length > 0 ? "" : "ml-auto"}
                >
                  <RefreshCw />
                  <Trans>Refresh</Trans>
                </Button>
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
                      placeholder={t`Filter versions…`}
                      aria-label={t`Filter versions`}
                      className="h-8 w-56 pl-7 text-xs"
                    />
                  </div>
                )}
              </div>
              <div
                ref={setScroller}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                className="min-h-0 flex-1 overflow-auto"
              >
                {versionsLoading && (
                  <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" />{" "}
                    <Trans>loading versions…</Trans>
                  </p>
                )}
                {versionsError && (
                  <div className="m-6">
                    <ErrorBanner message={versionsError} />
                  </div>
                )}
                {versions?.length === 0 && (
                  <div className="m-6">
                    <EmptyState
                      icon={Package}
                      label={t`No versions in this repository.`}
                    />
                  </div>
                )}
                {versions &&
                  versions.length > 0 &&
                  filteredVersions?.length === 0 && (
                    <div className="m-6">
                      <EmptyState
                        icon={Search}
                        label={t`No versions match “${versionQuery}”.`}
                      />
                    </div>
                  )}
                {filteredVersions && filteredVersions.length > 0 && (
                  <ul
                    className="relative"
                    style={{
                      height: filteredVersions.length * VERSION_ROW_HEIGHT,
                    }}
                  >
                    {filteredVersions.slice(start, end).map((v, i) => (
                      <VersionRow
                        key={v.tag}
                        version={v}
                        top={(start + i) * VERSION_ROW_HEIGHT}
                        masterUrl={masterUrl}
                        writePath={writePath}
                        onDeleted={() => setInstalled(v.md5, false)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** One version in the list, placed at `top` and exactly `VERSION_ROW_HEIGHT`
 *  tall. The md5 and dependencies share one line, and a running download's
 *  progress takes that line's place. */
function VersionRow({
  version: v,
  top,
  masterUrl,
  writePath,
  onDeleted,
}: {
  version: Version;
  top: number;
  masterUrl: string;
  writePath?: string;
  onDeleted: () => void;
}) {
  const { t } = useLingui();
  const { enqueue, itemFor, active } = useDownloadQueue();
  const input = {
    kind: "rapid" as const,
    label: v.name || v.tag,
    args: { tag: v.tag, masterUrl, writePath },
  };
  const item = itemFor(identityOf(input));
  const status = item?.status ?? null;
  const installed = v.installed;
  const packagePath = packagePathOf(writePath, v.md5);
  const tag = v.tag;
  const dependencies = v.depends.join(", ");
  const details = [
    v.md5 && `md5 ${v.md5}`,
    v.depends.length > 0 && t`Depends on ${dependencies}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      className="absolute inset-x-0 flex items-center justify-between gap-3 overflow-hidden border-b border-border px-6"
      style={{ top, height: VERSION_ROW_HEIGHT }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{v.name}</p>
          <Badge variant="outline">
            {v.kind === "snapshot" ? t`Snapshot` : t`Release`}
          </Badge>
          {installed && (
            <Badge variant="secondary">
              <CheckCircle2 className="text-emerald-500" />
              <Trans>Installed</Trans>
            </Badge>
          )}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {v.tag}
        </p>
        {item?.progress ? (
          <QueueProgress item={item} />
        ) : (
          details && (
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={details}
            >
              {details}
            </p>
          )
        )}
      </div>
      {installed && packagePath && isDeletableArchive(packagePath) ? (
        <DeleteArchiveButton
          path={packagePath}
          name={v.name || v.tag}
          onDeleted={onDeleted}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => enqueue(input)}
          disabled={installed || status === "queued" || status === "active"}
          aria-label={t`Download ${tag}`}
        >
          {status === "active" ? (
            <Loader2 className="animate-spin" />
          ) : installed ? (
            <CheckCircle2 className="text-emerald-500" />
          ) : (
            <Download />
          )}
          {status === "active"
            ? t`Downloading…`
            : status === "queued"
              ? t`Queued`
              : status === "done"
                ? t`Done`
                : installed
                  ? t`Installed`
                  : active
                    ? t`Add to queue`
                    : t`Download`}
        </Button>
      )}
    </li>
  );
}

/** Where a rapid package's `.sdp` sits in the write root, which is what makes
 *  a version installed, or null when there is no write root to look in. */
function packagePathOf(writePath: string | undefined, md5: string) {
  if (!writePath || !md5) return null;
  const sep = writePath.includes("\\") ? "\\" : "/";
  const root = writePath.replace(/[\\/]+$/, "");
  return `${root}${sep}packages${sep}${md5.toLowerCase()}.sdp`;
}
