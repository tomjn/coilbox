import { Button } from "@picoframe/frame";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLink, FolderSearch } from "lucide-react";
import type { ReactNode } from "react";
import { contentOpenPath } from "@/content/bindings";
import { formatDateTime } from "@/lib/format";
import type { InfologTail } from "@/play/bindings";

/** A log's timestamp, in the reader's own locale. */
function when(ms: number): string {
  return formatDateTime(new Date(ms));
}

/**
 * Where the engine's log file is: its path, when it was written, and buttons to
 * open it and to show it in its folder.
 *
 * The Engine log page and the crash drawer both use this, so the two point at
 * the file the same way. Neither shows a line of it: a slice of `infolog.txt`
 * passes for the whole file, and the start, where the engine records the system
 * and the GPU, is the part a slice leaves out (issues #4064 and #4167).
 *
 * `children` go at the start of the button row.
 */
export function EngineLogFile({
  log,
  children,
}: {
  log: InfologTail | null;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {log ? (
          <>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void contentOpenPath({ path: log.path }).catch(() => {});
              }}
            >
              <ExternalLink className="size-4" /> Open the log file
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void revealItemInDir(log.path).catch(() => {});
              }}
            >
              <FolderSearch className="size-4" /> Show in folder
            </Button>
          </>
        ) : null}
      </div>
      {log ? (
        <p className="break-all text-sm">
          <code>{log.path}</code>
          <span className="block text-xs text-muted-foreground">
            Written {when(log.modifiedMs)}
          </span>
        </p>
      ) : null}
    </>
  );
}
