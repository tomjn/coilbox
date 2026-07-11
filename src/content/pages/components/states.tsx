import { Button } from "@picoframe/frame";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Inbox,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";

/** Inline error banner (matches the content settings pages). */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription className="break-words">{message}</AlertDescription>
    </Alert>
  );
}

/** Collapsible list of non-fatal unitsync diagnostics from a scan. */
export function Diagnostics({ errors }: { errors: string[] }) {
  return (
    <Collapsible className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-left text-amber-700 dark:text-amber-400">
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        unitsync reported {errors.length} diagnostic
        {errors.length === 1 ? "" : "s"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          {errors.map((e) => (
            <li key={e} className="break-words">
              {e}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Small amber glyph for a list item that has unitsync warnings. The warning
 * text is surfaced on hover; the detail page shows the full banner.
 */
export function WarningIcon({ warnings }: { warnings: string[] }) {
  return (
    <span
      title={warnings.join("\n")}
      className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
    >
      <TriangleAlert
        className="size-3.5"
        aria-label={`${warnings.length} unitsync warning${
          warnings.length === 1 ? "" : "s"
        }`}
      />
    </span>
  );
}

/** Amber banner listing the unitsync warnings for a single map or game. */
export function WarningBanner({
  warnings,
  noun,
}: {
  warnings: string[];
  noun: string;
}) {
  return (
    <Alert variant="warning">
      <TriangleAlert />
      <AlertTitle>
        unitsync reported {warnings.length} warning
        {warnings.length === 1 ? "" : "s"} for this {noun}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          {warnings.map((w) => (
            <li key={w} className="break-words">
              {w}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/** Loading skeleton rows. */
export function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {["a", "b", "c", "d"].map((k) => (
        <Skeleton
          key={k}
          className="h-14 rounded-lg border border-border/50 bg-card"
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

/** Detail-page error state (the scan for this target failed). */
export function DetailError({
  backTo,
  message,
  onRetry,
}: {
  backTo: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>
      <Alert
        variant="destructive"
        className="flex items-center justify-between gap-3"
      >
        <span className="break-words text-destructive">{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </Alert>
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
