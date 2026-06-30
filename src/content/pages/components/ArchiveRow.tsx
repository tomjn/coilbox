import { Button } from "@picoframe/frame";
import { Boxes } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { Archive } from "../../bindings";
import type { ArchiveClassification } from "../../config";
import { formatBytes } from "../../format";
import { ArchiveTypeBadge } from "./ArchiveTypeBadge";

/**
 * One archive row. The name links through to the archive's detail page; when the
 * archive is itself a map or game, a sibling "View map/game" button jumps to that
 * screen (kept outside the link to avoid nesting interactive elements).
 */
export function ArchiveRow({
  archive,
  classification,
}: {
  archive: Archive;
  classification?: ArchiveClassification;
}) {
  const navigate = useNavigate();
  const size = formatBytes(archive.size);
  const detailTo = `/content/archives/${encodeURIComponent(archive.name)}`;
  const linked =
    classification?.kind === "game" && classification.gameName
      ? {
          label: "View game",
          to: `/content/games/${encodeURIComponent(classification.gameName)}`,
        }
      : classification?.kind === "map" && classification.mapName
        ? {
            label: "View map",
            to: `/content/maps/${encodeURIComponent(classification.mapName)}`,
          }
        : null;

  return (
    <li className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-3 transition-colors hover:border-border hover:bg-accent/40">
      <Link to={detailTo} className="flex min-w-0 flex-1 items-start gap-2">
        <Boxes className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="break-all font-mono text-sm">{archive.name}</p>
          {archive.path && (
            <p
              className="break-all font-mono text-xs text-muted-foreground"
              title={archive.path}
            >
              {archive.path}
            </p>
          )}
        </div>
      </Link>
      {classification && <ArchiveTypeBadge kind={classification.kind} />}
      {size && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {size}
        </span>
      )}
      {archive.checksum && (
        <span className="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:inline">
          {archive.checksum}
        </span>
      )}
      {linked && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => navigate(linked.to)}
        >
          {linked.label}
        </Button>
      )}
    </li>
  );
}
