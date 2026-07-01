import { Boxes } from "lucide-react";
import { Link } from "react-router";
import { useArchives, useScanTargetSelection } from "../config";
import { formatBytes, isSdd } from "../format";
import { ArchiveTypeBadge, PrimaryBadge } from "./components/ArchiveTypeBadge";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { SddBadge } from "./components/SddBadge";
import {
  Diagnostics,
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "./components/states";

/**
 * Every archive the selected engine's scan references — game primaries, map
 * primaries and all dependency archives — deduped and classified. Each row links
 * to the archive's detail page (metadata, dependencies, contents).
 */
export default function ArchivesPage() {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { archives, data, loading, error, cancelled, run, cancel } =
    useArchives(selected?.enginePath, selected?.rootPath);
  const busy = loading || (!!selected && !data && !error && !cancelled);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Archives</h1>
        <p className="text-sm text-muted-foreground">
          Every archive your content references, read via unitsync. Click one to
          browse its contents.
        </p>
      </header>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={() => run(true)}
        scanning={loading}
        onCancel={cancel}
      />

      {error && <ErrorBanner message={error} />}
      {data?.errors?.length ? <Diagnostics errors={data.errors} /> : null}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : cancelled && archives.length === 0 ? (
        <EmptyState label="Scan cancelled. Press Rescan to load archives." />
      ) : archives.length === 0 ? (
        <EmptyState label="No archives found for this engine." />
      ) : (
        <ul className="flex flex-col gap-2">
          {archives.map((a) => {
            const size = formatBytes(a.size);
            return (
              <li key={a.name}>
                <Link
                  to={`/content/archives/${encodeURIComponent(a.name)}`}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/40"
                >
                  <Boxes className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 break-all font-mono text-sm">
                    {a.name}
                  </span>
                  {isSdd(a) && <SddBadge />}
                  {a.primary && <PrimaryBadge />}
                  <ArchiveTypeBadge kind={a.kind} />
                  {size && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {size}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
