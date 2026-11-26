import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLink, FolderSearch } from "lucide-react";
import { type ReactNode, useState } from "react";
import { contentOpenPath } from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
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
 * The crash drawer uses this. Like the Engine log settings page, it shows no
 * line of the file: a slice of `infolog.txt` passes for the whole file, and the
 * start, where the engine records the system and the GPU, is the part a slice
 * leaves out (issues #4064 and #4167).
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
  const writtenAt = log ? when(log.modifiedMs) : "";
  const [openError, setOpenError] = useState<string | null>(null);
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
                setOpenError(null);
                contentOpenPath({ path: log.path }).catch((e) =>
                  setOpenError(describeError(e)),
                );
              }}
            >
              <ExternalLink className="size-4" />{" "}
              <Trans>Open the log file</Trans>
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                setOpenError(null);
                revealItemInDir(log.path).catch((e) =>
                  setOpenError(describeError(e)),
                );
              }}
            >
              <FolderSearch className="size-4" /> <Trans>Show in folder</Trans>
            </Button>
          </>
        ) : null}
      </div>
      {openError && (
        <p
          role="alert"
          className="select-text break-words text-xs text-destructive"
        >
          {openError}
        </p>
      )}
      {log ? (
        <p className="break-all text-sm">
          <code>{log.path}</code>
          <span className="block text-xs text-muted-foreground">
            <Trans>Written {writtenAt}</Trans>
          </span>
        </p>
      ) : null}
    </>
  );
}
