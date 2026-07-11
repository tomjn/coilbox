import { cn } from "@picoframe/frame";
import { Badge } from "@/components/ui/badge";
import type { ArchiveKind } from "../../config";

const STYLES: Record<ArchiveKind, string> = {
  game: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  map: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  other: "bg-muted text-muted-foreground",
};

const LABELS: Record<ArchiveKind, string> = {
  game: "Game",
  map: "Map",
  other: "Other",
};

/** A small chip marking an archive's type (map / game / other). */
export function ArchiveTypeBadge({ kind }: { kind: ArchiveKind }) {
  return (
    <Badge
      variant="ghost"
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 font-mono text-[0.625rem] font-medium uppercase tracking-wide",
        STYLES[kind],
      )}
    >
      {LABELS[kind]}
    </Badge>
  );
}

/** A chip marking a game's primary (own) archive. */
export function PrimaryBadge() {
  return (
    <Badge
      variant="ghost"
      className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[0.625rem] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-400"
      title="This is a game's primary archive"
    >
      Primary
    </Badge>
  );
}
