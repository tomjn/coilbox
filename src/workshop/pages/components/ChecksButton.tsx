/**
 * Whether this project is in a fit state to use, as one control (issue #2748).
 *
 * Six toolbar buttons landed on this page in the same handful of days, three
 * of which answer the same question: diagnostics reports what unitsync said
 * reading the game's definitions, delivery routes says which of the two ways
 * an edit reaches a game this game supports, and preflight reports what is
 * wrong with the compiled output. Next to each other they read as three
 * buttons rather than one answer, and all three were styled like the actions
 * beside them (Lua, Test), which mixes a verdict with a thing you do.
 *
 * `DiagnosticsButton` in `src/content/pages/components/states.tsx` set the
 * pattern this follows: present in every state the check can be in, so a
 * button that only appears once something is wrong cannot be mistaken for one
 * that has not run yet (issue #2272). This goes a step further, because with
 * three sources merged into one verdict a button carrying a label all the
 * time is back to being noise. Clean shows a tick and nothing else, with a
 * tooltip to say why, and the label returns once there is something to read.
 * `DiagnosticsButton` itself is shared with other pages and keeps its own
 * always-labelled style. This is a page-local composition, not a change to
 * it.
 *
 * Preflight is read here whenever a project is open, not only while its
 * drawer is up. A quiet tick has to mean something was actually checked, and
 * checking only when somebody opens the drawer would leave the tick claiming
 * a clean project nobody has looked at yet. `ScenarioEditPage`'s own problems
 * button reads the same way, live off the document rather than gated on a
 * drawer.
 */
import { Button, Drawer } from "@picoframe/frame";
import {
  Check,
  CircleCheck,
  CircleX,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ConfigOption } from "@/content/bindings";
import { deliveryRoutes } from "../../deliveryRoutes";
import type { PreflightReport } from "../../preflight";
import { usePreflightReport } from "../../preflight";
import type { ModProject } from "../../project";

/** One labelled group of preflight lines, styled by what the group means.
 *  Kept apart from the other two groups on purpose: a blocker that stops an
 *  export is not a review item the compiler already chose to proceed past,
 *  and folding the count into this drawer must not fold that distinction
 *  away too (issue #2748). */
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

/** What unitsync said reading the game's own definitions. First in the
 *  drawer, because it is the most basic question: did the game read at all. */
function UnitsyncSection({ errors }: { errors: string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">Game definitions</h3>
      {errors.length > 0 ? (
        <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
          {errors.map((e) => (
            <li key={e} className="break-words">
              {e}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          unitsync read everything it was asked for without complaining.
        </p>
      )}
    </section>
  );
}

/** Which of the two delivery routes this game supports, and why when one is
 *  not. Second in the drawer: once the game reads cleanly, this is how an
 *  edit actually reaches it. */
function RoutesSection({
  gameName,
  options,
  checking,
}: {
  gameName: string;
  options: ConfigOption[] | undefined;
  checking: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">Delivery routes</h3>
      {checking ? (
        <p className="text-muted-foreground text-sm">
          Reading which routes {gameName} supports…
        </p>
      ) : !options ? (
        <p className="text-muted-foreground text-sm">
          {gameName}'s mod options could not be read, so which routes it
          supports is not known.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {deliveryRoutes(options, gameName).map((r) => (
            <li key={r.route} className="flex gap-2">
              {r.available ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">{r.label}</span>
                <span className="text-muted-foreground text-xs">
                  {r.detail}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What preflight found in the compiled output. Last in the drawer: this is
 *  what is wrong with what you have written, once the two questions above it
 *  are answered. */
function PreflightSection({
  project,
  report,
  loading,
  error,
}: {
  project: ModProject | undefined;
  report: PreflightReport | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">Preflight</h3>
      {!project ? (
        <p className="text-muted-foreground text-sm">
          No project is open yet, so there is nothing compiled to check.
        </p>
      ) : error ? (
        <p className="text-destructive text-sm">
          The preflight check could not run: {error}
        </p>
      ) : report ? (
        <div className="flex flex-col gap-3">
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
                This project changes nothing yet, so there is nothing to check.
              </p>
            )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {loading ? "Checking…" : "Nothing has been checked yet."}
        </p>
      )}
    </section>
  );
}

/**
 * A few words on what was found, or null when there is nothing to say.
 * Blockers lead because they are the one severity that would reach the game
 * broken. Everything else, unitsync's diagnostics included, reads as "to
 * review" rather than being counted twice by name, matching the wording
 * `PreflightButton` used before this replaced it. The button's own face
 * shows this as-is; the accessible name and the tooltip add " found" so it
 * reads as a sentence rather than a fragment (issue #2748).
 */
function verdict(
  blockers: number,
  review: number,
  diagnostics: number,
): string | null {
  if (blockers === 0 && review === 0 && diagnostics === 0) return null;
  const parts: string[] = [];
  if (blockers > 0)
    parts.push(`${blockers} blocker${blockers === 1 ? "" : "s"}`);
  const rest = review + diagnostics;
  if (rest > 0) parts.push(`${rest} to review`);
  return parts.join(", ");
}

export function ChecksButton({
  gameName,
  diagnosticErrors,
  diagnosticsChecking,
  routeOptions,
  routesChecking,
  project,
}: {
  gameName: string;
  /** What unitsync said reading the game's definitions. */
  diagnosticErrors: string[];
  /** The game's own read is still going, so the count is not known yet. */
  diagnosticsChecking: boolean;
  /** The game's mod options, once read. Undefined while checking or if the
   *  read failed. `routesChecking` tells the two apart. */
  routeOptions: ConfigOption[] | undefined;
  routesChecking: boolean;
  /** The open project, so preflight has something to compile. Undefined
   *  when no project is open yet, in which case preflight has nothing to
   *  say and does not affect the verdict. */
  project: ModProject | undefined;
}) {
  const [open, setOpen] = useState(false);
  // Read whenever a project is open, not only while the drawer is up: see
  // the module doc comment for why the button needs a live answer.
  const preflight = usePreflightReport(project, true);

  const blockers = preflight.report?.blockers.length ?? 0;
  const review = preflight.report?.review.length ?? 0;
  const diagnostics = diagnosticErrors.length;
  // A command that failed to answer is not a clean project, it is a question
  // this button could not settle. Kept apart from the counted severities
  // rather than folded into "review", which would say preflight ran and
  // found one thing rather than that it never ran at all.
  const preflightFailed = !!project && !!preflight.error;

  const preflightChecking = !!project && preflight.loading && !preflight.report;
  const checking = diagnosticsChecking || routesChecking || preflightChecking;
  const attention =
    !checking &&
    (preflightFailed || blockers > 0 || review > 0 || diagnostics > 0);
  const clean = !checking && !attention;

  const found = verdict(blockers, review, diagnostics);
  const shortLabelText = preflightFailed ? "Preflight error" : (found ?? "");
  const ariaLabel = checking
    ? "Checking the project"
    : preflightFailed
      ? `Preflight could not run: ${preflight.error}`
      : found
        ? `${found} found`
        : "No problems found";

  const colour = checking
    ? "text-muted-foreground"
    : clean
      ? "text-emerald-600 dark:text-emerald-400"
      : blockers > 0
        ? "text-destructive"
        : "text-amber-700 dark:text-amber-400";

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={checking}
              className={colour}
              aria-label={ariaLabel}
              onClick={() => setOpen(true)}
            >
              {checking ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : clean ? (
                <Check className="size-4" />
              ) : (
                <TriangleAlert className="size-4" />
              )}
              {checking && "Checking…"}
              {!checking && !clean && shortLabelText}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{ariaLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Checks"
        description={`Whether ${gameName} is in a fit state to use: the game's own definitions, how an edit reaches it, and what is wrong with what you have written.`}
        width="34rem"
      >
        <div className="flex flex-col gap-5">
          <UnitsyncSection errors={diagnosticErrors} />
          <RoutesSection
            gameName={gameName}
            options={routeOptions}
            checking={routesChecking}
          />
          <PreflightSection
            project={project}
            report={preflight.report}
            loading={preflight.loading}
            error={preflight.error}
          />
        </div>
      </Drawer>
    </>
  );
}
