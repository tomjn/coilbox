import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { AlertCircle, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import {
  contentDuplicateReport,
  contentOpenPath,
  type DuplicateCopy,
  type DuplicateGroup,
  type DuplicateReport,
} from "../../bindings";

type State =
  | { status: "loading" }
  | { status: "ready"; report: DuplicateReport }
  | { status: "error"; message: string };

/** The folder a file is in, which is what the file manager should show. */
function parentFolder(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : path;
}

/**
 * Reports already read this session, keyed by the folders they cover. Reading
 * one parses every rapid package manifest, so leaving the section and coming
 * back must not pay for it again, as with the section's size walk. Cleared by
 * {@link clearDuplicateReportCache}.
 */
const reportCache = new Map<string, DuplicateReport>();

/** Forget every report, so the next read goes to the disk. */
export function clearDuplicateReportCache(): void {
  reportCache.clear();
}

/**
 * Content stored twice (issue #399): one archive name in two content folders,
 * and a map that is both a loose archive and inside a rapid package. A read
 * only list. Removing a copy stays a manual step, because a replay or save may
 * depend on it.
 *
 * `roots` are the content folder paths. `version` changes when the section's
 * Refresh is pressed or something is deleted, and the caller clears the cache
 * first so the folders are read again.
 */
export function DuplicateContent({
  roots,
  version,
}: {
  roots: string[];
  version: number;
}) {
  const rootKey = JSON.stringify(roots);
  const [state, setState] = useState<State>({ status: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the refresh signal
  useEffect(() => {
    const cached = reportCache.get(rootKey);
    if (cached) {
      setState({ status: "ready", report: cached });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    contentDuplicateReport({ roots: JSON.parse(rootKey) as string[] })
      .then(({ report }) => {
        // A read that a refresh has replaced must not be stored.
        if (!live) return;
        reportCache.set(rootKey, report);
        setState({ status: "ready", report });
      })
      .catch((e) => {
        if (live) setState({ status: "error", message: describeError(e) });
      });
    return () => {
      live = false;
    };
  }, [rootKey, version]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Trans>Duplicate content</Trans>
        </h2>
        {state.status === "ready" && state.report.groups.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <Plural
              value={state.report.groups.length}
              one="# duplicate"
              other="# duplicates"
            />
            {", "}
            <Trans>
              {formatBytes(state.report.wastedBytes)} in extra copies
            </Trans>
          </p>
        )}
      </div>

      {state.status === "loading" ? (
        <Skeleton className="h-16" />
      ) : state.status === "error" ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription className="break-words">
            {state.message}
          </AlertDescription>
        </Alert>
      ) : state.report.groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No duplicates found.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {state.report.groups.map((group) => (
            <GroupRow
              key={`${group.kind}:${group.category}:${group.name}`}
              group={group}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupRow({ group }: { group: DuplicateGroup }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border/50 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="break-all font-medium">{group.name}</span>
        <GroupBadge group={group} />
        <span className="ml-auto tabular-nums text-sm">
          {group.wastedBytes > 0 ? formatBytes(group.wastedBytes) : null}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {group.copies.map((copy) => (
          <CopyRow key={copy.path} copy={copy} />
        ))}
      </ul>
    </li>
  );
}

function GroupBadge({ group }: { group: DuplicateGroup }) {
  if (group.kind === "mapInRapid") {
    return (
      <Badge variant="secondary">
        <Trans>Loose map and rapid package</Trans>
      </Badge>
    );
  }
  if (group.sizesMatch === false) {
    return (
      <Badge variant="outline">
        <Trans>Same name, different sizes</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Trans>Same name and size</Trans>
    </Badge>
  );
}

function CopyRow({ copy }: { copy: DuplicateCopy }) {
  const { t } = useLingui();
  const folder = parentFolder(copy.path);
  return (
    <li className="flex items-center gap-3 text-xs">
      <span
        className="min-w-0 flex-1 break-all font-mono text-muted-foreground"
        title={copy.path}
      >
        {copy.path}
      </span>
      {copy.source === "rapid" && (
        <span className="text-muted-foreground">
          <Trans>Rapid package</Trans>
        </span>
      )}
      <span className="tabular-nums">{formatBytes(copy.bytes)}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title={t`Reveal ${folder}`}
        onClick={() => {
          contentOpenPath({ path: folder }).catch(() => {});
        }}
      >
        <FolderOpen className="size-4" />
        <span className="sr-only">
          <Trans>Reveal the folder holding {copy.path}</Trans>
        </span>
      </Button>
    </li>
  );
}
