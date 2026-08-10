import { Button } from "@picoframe/frame";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ProgressBar } from "../../../downloads/pages/components/ProgressBar";
import type { ContentRequirement } from "../../resolveContent";
import { useResolveContent } from "../../useResolveContent";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One missing-content row: label, a download button (or its live progress),
 * and an "unavailable" note when it can't be resolved automatically. */
function RequirementRow({
  req,
  resolve,
}: {
  req: ContentRequirement;
  resolve: ReturnType<typeof useResolveContent>;
}) {
  const status = resolve.statusFor(req);
  const progress = resolve.progressFor(req);
  const error = resolve.errorFor(req);
  const done = status === "done";
  const active = status === "active" || status === "queued";
  const kindLabel =
    req.kind === "game" ? "Game" : req.kind === "map" ? "Map" : "Engine";

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={req.label}>
            {req.label}
          </p>
          <p className="text-xs text-muted-foreground">{kindLabel}</p>
        </div>
        {done ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Installed
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => resolve.download(req)}
            disabled={active || !resolve.canDownload(req)}
            className="shrink-0 gap-1.5"
          >
            {active ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {status === "queued"
              ? "Queued"
              : status === "active"
                ? "Downloading…"
                : "Download"}
          </Button>
        )}
      </div>
      {active && progress && <ProgressBar progress={progress} />}
      {!resolve.canDownload(req) && !done && (
        <p className="text-xs text-muted-foreground">
          {req.kind === "engine"
            ? "No matching engine build found automatically — install one from Content → Engines."
            : "Set a download folder in Downloads settings to enable this."}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

/**
 * The shared "resolve content for this document" gate (issue #387): given the
 * requirements a decoded import needs (a game, a map, an engine version — see
 * `resolveContent.ts`), checks them against the recipient's own install and,
 * if anything's missing, offers downloads before letting the import complete.
 *
 * Renders nothing (no popup) once everything is already installed — a
 * fully-resolved import must not stop for a pointless prompt — and instead
 * calls `onContinue` itself. Only pops the drawer when there's something to
 * resolve. Closing the drawer (Cancel or the backdrop) calls `onCancel` and
 * the import never runs — nothing is saved until every requirement clears, so
 * an import can't half-apply.
 */
export function ResolveContentGate({
  requirements,
  target,
  targetLoading,
  title,
  description,
  onContinue,
  onCancel,
}: {
  requirements: ContentRequirement[];
  target: { enginePath?: string; dataDir?: string } | undefined;
  /** The caller's target read is still in flight, so `target` being undefined
   * does not yet mean there is no engine. The gate waits rather than reading it
   * as a machine with nothing installed (issue #1377). */
  targetLoading?: boolean;
  title: string;
  description?: string;
  /** Runs once every requirement is satisfied. May throw — the error is shown
   * inline and the drawer stays open so the user can retry or cancel. */
  onContinue: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const resolve = useResolveContent(requirements, target, targetLoading);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firedRef = useRef(false);

  const canProceed = resolve.resolved && !resolve.loading;

  /** Run the caller's completion step once. Used both by the auto-fire effect
   * below and by "Try again" after a failed attempt (content itself is
   * already resolved at that point — only the import step failed). */
  const runContinue = () => {
    firedRef.current = true;
    setContinuing(true);
    setError(null);
    Promise.resolve(onContinue()).catch((e) => {
      setError(errMessage(e));
      setContinuing(false);
      firedRef.current = false;
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: fires exactly once per resolution, guarded by firedRef — re-running on every render (e.g. from a new onContinue identity) would re-trigger the import
  useEffect(() => {
    if (!canProceed || firedRef.current) return;
    runContinue();
  }, [canProceed]);

  // Nothing missing (or everything just got resolved): no UI at all beyond a
  // brief spinner, either still checking or already handed off to onContinue
  // above. An `onContinue` failure falls through to the error view below
  // instead of looping here — `error` takes priority even though `canProceed`
  // is still true (the content resolved fine; the import step itself failed).
  if (
    !error &&
    (canProceed || (resolve.loading && resolve.missing.length === 0))
  ) {
    return (
      <DialogPrimitive.Root open onOpenChange={(o) => !o && onCancel()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[380px] max-w-[92vw] flex-col items-center justify-center gap-2 border-l border-border bg-background p-6 shadow-xl">
            <DialogPrimitive.Title className="sr-only">
              {title}
            </DialogPrimitive.Title>
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {continuing ? "Setting up…" : "Checking installed content…"}
            </p>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onCancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={onCancel}
              >
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {resolve.missing.length > 0 && (
              <>
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs text-muted-foreground">
                    {description ??
                      "Some content this needs isn't installed. Download it below, or cancel — nothing is imported until everything's ready."}
                  </p>
                </div>

                <ul className="flex flex-col gap-2">
                  {resolve.missing.map((req) => (
                    <RequirementRow
                      key={`${req.kind}:${req.label}`}
                      req={req}
                      resolve={resolve}
                    />
                  ))}
                </ul>

                <p className="text-xs text-muted-foreground">
                  Best-effort by name — a download may not be an exact match.
                  See{" "}
                  <Link
                    className="underline underline-offset-4"
                    to="/settings/downloads"
                  >
                    Downloads settings
                  </Link>{" "}
                  for the destination folder.
                </p>
              </>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            {error && resolve.missing.length === 0 && (
              <Button onClick={runContinue}>Try again</Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
