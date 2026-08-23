import { Button } from "@picoframe/frame";
import { AlertTriangle, ClipboardCopy, ExternalLink, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import { contentOpenPath } from "@/content/bindings";
import { buildCrashReport, describeExit } from "@/play/crash";
import type { CrashTriage } from "@/play/useCrashTriage";
import { InfologView } from "./InfologView";

/**
 * What the engine left behind when it died (issue #379).
 *
 * A crash used to be silent: the window closed, the badge cleared, and nothing
 * said the engine had gone. This says what happened, shows the end of the log
 * with the engine's own error lines picked out, and puts a report on the
 * clipboard for pasting into Discord or a bug report.
 *
 * A right-hand sheet like `DebriefDrawer`, per the repo's preference for drawers
 * over modal dialogs.
 */
export function CrashDrawer({
  open,
  onOpenChange,
  triage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triage: CrashTriage | null;
}) {
  const [copied, setCopied] = useState(false);

  if (!triage) return null;
  const { outcome, runKind, game, map, engine, file, log, stale } = triage;

  const copyReport = () => {
    const text = buildCrashReport({
      outcome,
      runKind,
      game,
      map,
      engine,
      file,
      logPath: log?.path,
      lines: log?.lines ?? [],
    });
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[680px] max-w-[96vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              The game stopped unexpectedly
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="size-8 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{describeExit(outcome)}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
                  <dt>Playing</dt>
                  <dd>{runKind}</dd>
                  {game ? (
                    <>
                      <dt>Game</dt>
                      <dd>{game}</dd>
                    </>
                  ) : null}
                  {map ? (
                    <>
                      <dt>Map</dt>
                      <dd>{map}</dd>
                    </>
                  ) : null}
                  {file ? (
                    <>
                      <dt>File</dt>
                      <dd className="break-all">{file}</dd>
                    </>
                  ) : null}
                  {engine ? (
                    <>
                      <dt>Engine</dt>
                      <dd className="break-all">{engine}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
            </div>

            {log ? (
              <>
                <p className="break-all text-xs text-muted-foreground">
                  From <code>{log.path}</code>
                </p>
                <InfologView log={log} className="max-h-[52vh]" />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {stale
                  ? "The engine wrote no log for this run, so it stopped before it got that far. The newest log on disk is from an earlier session, and would tell you nothing about this."
                  : "No engine log was found, so there is nothing to show beyond how it exited."}
              </p>
            )}

            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
              <Button onClick={copyReport} className="gap-1.5">
                <ClipboardCopy className="size-4" />
                {copied ? "Copied" : "Copy report"}
              </Button>
              {log ? (
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    void contentOpenPath({ path: log.path }).catch(() => {});
                  }}
                >
                  <ExternalLink className="size-4" /> Open the log file
                </Button>
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
