import { Button, Drawer } from "@picoframe/frame";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Inbox,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
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

/** What unitsync said, one line each, wherever the lines are being shown. */
function DiagnosticsLines({ errors }: { errors: string[] }) {
  return (
    <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      {errors.map((e) => (
        <li key={e} className="break-words">
          {e}
        </li>
      ))}
    </ul>
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
      <CollapsibleContent className="mt-2">
        <DiagnosticsLines errors={errors} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The same diagnostics as a button that opens a drawer, for a page that cannot
 * spare a strip of its bottom edge (issue #2667). The panel above is right where
 * the content flows and the reader scrolls past it. It is wrong on a page that
 * claims the window height and scrolls its panes internally, because there the
 * panel never leaves and collapsing it gives no height back.
 *
 * The scenario editor's problems button is the model, down to being present in
 * all three states the read can be in: a button that only appears when something
 * is wrong looks exactly like one for a game nobody has read yet (issue #2272).
 *
 * Two colours rather than the editor's three. The editor turns destructive when
 * a problem stops the mission launching, and unitsync carries no such split: a
 * diagnostic is a line of text, with nothing in it to say whether the thing it
 * names still worked. So this is amber whenever there is anything to read and
 * muted otherwise, rather than sorting the lines by a severity they do not have.
 */
export function DiagnosticsButton({
  errors,
  checking,
  title,
  description,
}: {
  errors: string[];
  /** The read is still going, so the count is not known yet. */
  checking: boolean;
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const count = errors.length;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={checking}
        className={
          count > 0
            ? "text-amber-700 dark:text-amber-400"
            : "text-muted-foreground"
        }
        onClick={() => setOpen(true)}
      >
        {checking ? (
          <Loader2 className="size-4 motion-safe:animate-spin" />
        ) : count > 0 ? (
          <TriangleAlert className="size-4" />
        ) : (
          <Check className="size-4" />
        )}
        {checking
          ? "Checking…"
          : count > 0
            ? `${count} diagnostic${count === 1 ? "" : "s"}`
            : "No problems"}
      </Button>
      {/* Controlled, for the reason the scenario editor's is: the frame's own
        drawer snapshots its content when it opens. These lines are fixed once
        the read lands, but a retry or a change of game replaces them, and this
        drawer stays open across both. */}
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        width="32rem"
      >
        {count > 0 ? (
          <DiagnosticsLines errors={errors} />
        ) : (
          <p className="text-sm text-muted-foreground">
            unitsync read everything it was asked for without complaining.
          </p>
        )}
      </Drawer>
    </>
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

/**
 * A muted sentence centred in whatever space it is given, for a pane that has
 * nothing to show. The archive browser's preview pane says every one of its
 * empty states this way, so a model that will not draw reads like the rest.
 */
export function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** Empty result state. */
export function EmptyState({ label }: { label: ReactNode }) {
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
