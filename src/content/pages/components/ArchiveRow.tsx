import { Boxes } from "lucide-react";
import type { Archive } from "../../bindings";

/** One archive row: name, optional on-disk path, optional checksum chip. */
export function ArchiveRow({ archive }: { archive: Archive }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border/50 bg-card p-3">
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
      {archive.checksum && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {archive.checksum}
        </span>
      )}
    </li>
  );
}
