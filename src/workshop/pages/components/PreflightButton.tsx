/**
 * Preflight, as a toolbar button (issue #1276).
 *
 * `DiagnosticsButton` in `src/content/pages/components/states.tsx` is the
 * model: a button that carries its own count and its own drawer, present
 * whichever state the check is in rather than only appearing once something
 * is wrong (issue #2272's reasoning applies here too). What differs is the
 * shape of the result. unitsync's diagnostics are one flat list with nothing
 * in it to say whether the thing it names still worked, so that button has
 * two colours. Preflight's three lists carry that distinction already: a
 * blocker means the export should wait, a review item does not, and folding
 * them into one amber count would erase the difference the issue asks to
 * keep.
 *
 * A change ledger will sit beside these results on the project page once
 * issue #2653 lands. This button is scoped to the unit page's own toolbar and
 * does not assume it owns that wider space.
 */
import { Button, Drawer } from "@picoframe/frame";
import { Check, Loader2, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { usePreflightReport } from "../../preflight";
import type { ModProject } from "../../project";

/** One labelled group of preflight lines, styled by what the group means. */
function PreflightGroup({
  heading,
  lines,
  className,
}: {
  heading: string;
  lines: string[];
  className: string;
}) {
  if (lines.length === 0) return null;
  return (
    <section
      className={`flex flex-col gap-2 rounded-md border p-3 ${className}`}
    >
      <h3 className="font-medium text-sm">{heading}</h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

export function PreflightButton({ project }: { project: ModProject }) {
  const [open, setOpen] = useState(false);
  const { report, loading, error } = usePreflightReport(project, open);
  const blockers = report?.blockers.length ?? 0;
  const review = report?.review.length ?? 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={
          blockers > 0
            ? "text-destructive"
            : review > 0
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground"
        }
        onClick={() => setOpen(true)}
        title="Check the Lua this project compiles to before it leaves the app"
      >
        {loading ? (
          <Loader2 className="mr-1 size-3.5 motion-safe:animate-spin" />
        ) : blockers > 0 ? (
          <ShieldAlert className="mr-1 size-3.5" />
        ) : review > 0 ? (
          <ShieldQuestion className="mr-1 size-3.5" />
        ) : (
          <Check className="mr-1 size-3.5" />
        )}
        {loading
          ? "Preflight…"
          : blockers > 0
            ? `${blockers} blocker${blockers === 1 ? "" : "s"}`
            : review > 0
              ? `${review} to review`
              : "Preflight"}
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Preflight"
        description={`What ${project.name} compiles to, checked against Beyond All Reason's tweak slots and the mutator route before either ever leaves the app.`}
        width="32rem"
      >
        <div className="flex flex-col gap-4">
          {loading && (
            <p className="text-muted-foreground text-sm">Checking…</p>
          )}
          {error && (
            <p className="text-destructive text-sm">
              The preflight check could not run: {error}
            </p>
          )}
          {report && (
            <>
              <PreflightGroup
                heading="Blockers"
                lines={report.blockers}
                className="border-destructive/40 bg-destructive/10 text-destructive"
              />
              <PreflightGroup
                heading="Worth a look"
                lines={report.review}
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              />
              <PreflightGroup
                heading="Passed"
                lines={report.passes}
                className="border-border/60 bg-muted/40 text-muted-foreground"
              />
              {report.blockers.length === 0 &&
                report.review.length === 0 &&
                report.passes.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    This project changes nothing yet, so there is nothing to
                    check.
                  </p>
                )}
            </>
          )}
        </div>
      </Drawer>
    </>
  );
}
