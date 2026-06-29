import { AlertCircle, ArrowLeft, Inbox } from "lucide-react";
import { Link } from "react-router";

/** Inline error banner (matches the content settings pages). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

/** Collapsible list of non-fatal unitsync diagnostics from a scan. */
export function Diagnostics({ errors }: { errors: string[] }) {
  return (
    <details className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
        unitsync reported {errors.length} diagnostic
        {errors.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
        {errors.map((e) => (
          <li key={e} className="break-words">
            {e}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Loading skeleton rows. */
export function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {["a", "b", "c", "d"].map((k) => (
        <div
          key={k}
          className="h-14 animate-pulse rounded-lg border border-border/50 bg-card"
        />
      ))}
    </div>
  );
}

/** Empty result state. */
export function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <Inbox className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** Detail-page loading state (the scan for this target is still resolving). */
export function DetailLoading({ backTo }: { backTo: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>
      <SkeletonList />
    </div>
  );
}

/** Shown when a detail page's item isn't in the (completed) scan. */
export function NotFound({ backTo, label }: { backTo: string; label: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm text-muted-foreground">
          This {label} isn't in the current scan. Go back and Scan the engine.
        </p>
      </div>
    </div>
  );
}
