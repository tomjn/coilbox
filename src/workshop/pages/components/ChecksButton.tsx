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
 * Compatibility is the fourth of the same kind (issue #1281): whether a game
 * update has moved anything the project names. It went in here rather than
 * behind a button of its own for exactly the reason the other three merged.
 * It is a verdict, it is about the same project, and a fifth control on a
 * toolbar that was shortened on purpose would have undone the shortening. It
 * is also the one section that can offer to act on what it found, which is why
 * a drawer suits it: a finding and the offer that goes with it sit on one row,
 * with the cost of taking the offer written beside the button.
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
 *
 * The post-processing check (issue #2744) is the fifth, and it reads live for
 * the same reason preflight does. It asks one question the other four cannot:
 * whether the file the compiler writes its executable Lua into is a file this
 * particular game already uses. `postHook.ts` holds the engine reasoning.
 *
 * The change ledger (issue #2653) is last, beside preflight rather than
 * folded into the verdict: it does not say whether the project is fit to
 * use, it says where each of its edits went once compiled, which is only
 * worth reading once you already know something is wrong. It is read only
 * while the drawer is open, unlike preflight, since nothing on the toolbar
 * face depends on it.
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
import { Link } from "react-router";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Archive, ConfigOption } from "@/content/bindings";
import type { ChangeLedger, LedgerChange } from "../../changeLedger";
import { ledgerByOutput, useChangeLedger } from "../../changeLedger";
import type { CompatFinding, CompatState } from "../../compatibility";
import { useCompiledProject } from "../../compile";
import { deliveryRoutes } from "../../deliveryRoutes";
import type { PostHookState } from "../../postHook";
import { POST_FILE, usePostHookCheck } from "../../postHook";
import type { PreflightReport } from "../../preflight";
import { usePreflightReport } from "../../preflight";
import type { ModProject } from "../../project";
import { projectPath } from "../../routes";

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

/** One finding, and the offer that goes with it when coilbox has one.
 *  The cost is on the button rather than behind it, because the alternative
 *  is a control that silently throws away an afternoon's tuning (issue
 *  #1281). A finding with no button is one where removing the reference is
 *  not the answer, and the sentence says what is. */
function CompatRow({
  finding,
  onFix,
}: {
  finding: CompatFinding;
  onFix: (finding: CompatFinding) => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5">
      <div className="flex items-start gap-2">
        {finding.severity === "broken" ? (
          <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        )}
        <span className="text-sm">{finding.detail}</span>
      </div>
      {finding.fix && (
        <div className="flex items-center gap-2 self-end">
          <span className="text-muted-foreground text-xs">
            Loses {finding.fix.cost}
          </span>
          <Button size="sm" variant="outline" onClick={() => onFix(finding)}>
            {finding.fix.label}
          </Button>
        </div>
      )}
    </li>
  );
}

/** What the game update did to this project's edits (issue #1281).
 *
 *  Second in the drawer, straight after the read that produced the
 *  definitions it compares against: it is a fact about those definitions, and
 *  on the rare open where it has anything to say it is the most important
 *  thing in here. Nothing to run and nothing to wait for, because the page
 *  already holds the game's whole unit table. */
function CompatibilitySection({
  gameName,
  state,
  onFix,
}: {
  gameName: string;
  state: CompatState | null;
  onFix: (finding: CompatFinding) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">Still fits {gameName}</h3>
      {!state ? (
        <p className="text-muted-foreground text-sm">
          No project is open yet, so there is nothing to compare.
        </p>
      ) : state.kind === "unknown" ? (
        <p className="text-muted-foreground text-sm">
          {gameName} could not be checksummed, so whether it has changed since
          this project was written is not known.
        </p>
      ) : state.kind === "unmoved" ? (
        <p className="text-muted-foreground text-sm">
          {gameName} is the same build this project was written against.
        </p>
      ) : state.report.findings.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {gameName} has been updated since this project was written, and
          everything the project names is still there.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            {gameName} has been updated since this project was written. These
            edits name things it no longer has.
          </p>
          <ul className="flex flex-col gap-2">
            {state.report.findings.map((finding) => (
              <CompatRow key={finding.id} finding={finding} onFix={onFix} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Which of the two delivery routes this game supports, and why when one is
 *  not. Third in the drawer: once the game reads cleanly and the project still
 *  fits it, this is how an edit actually reaches it. */
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

/**
 * Whether the mutator would cover the game's own unit post-processing (issue
 * #2744).
 *
 * Fourth in the drawer, straight after delivery routes, because it is the
 * same subject read one level down: routes says the mutator is available, and
 * this says what taking it would cost against this particular game. The two
 * belong next to each other, since the answer to a covered post file is
 * usually "take the other route".
 *
 * Silent for a project that writes no post file at all, which is most of
 * them. See `postHook.ts` for why both halves have to be true before there is
 * anything worth saying.
 */
function PostHookSection({
  gameName,
  primaryArchive,
  state,
  loading,
}: {
  gameName: string;
  primaryArchive: string;
  state: PostHookState | null;
  loading: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">Post-processing</h3>
      {loading || !state ? (
        <p className="text-muted-foreground text-sm">
          {loading
            ? `Reading whether ${gameName} post-processes its own units…`
            : "No game is picked yet, so there is nothing to read."}
        </p>
      ) : state.kind === "unwritten" ? (
        <p className="text-muted-foreground text-sm">
          Nothing in this project needs {POST_FILE}, so the mutator covers
          nothing of {gameName}'s.
        </p>
      ) : state.kind === "unknown" ? (
        <p className="text-muted-foreground text-sm">
          {gameName}'s archives could not be read, so whether the mutator would
          cover its own post-processing is not known: {state.detail}
        </p>
      ) : state.kind === "clear" ? (
        <p className="text-muted-foreground text-sm">
          This project's mutator writes {POST_FILE}, and {gameName} has no file
          of its own there for it to cover.
        </p>
      ) : (
        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
          <CircleX className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1.5 text-sm">
            <span>
              {state.archive === primaryArchive
                ? `${gameName} post-processes its own units in ${POST_FILE}.`
                : `${gameName} inherits a ${POST_FILE} from ${state.archive}.`}{" "}
              This project's mutator writes a file at that path, which takes its
              place.
            </span>
            <span className="text-xs">
              The engine's definition parser gives a mutator no way to run the
              file it covered, so playing this mutator skips whatever {gameName}{" "}
              does there, from a few missing values to a game that does not
              start. Deliver it through the tweak slots instead, if this game
              has them.
            </span>
          </div>
        </div>
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

/** What to say about where a change landed, or why it did not, under its
 *  description: the file(s) it reached, the BAR slot when the trace could
 *  place it, and the reason when it could not reach anything at all. */
function ChangeDestination({ change }: { change: LedgerChange }) {
  const parts: string[] = [...change.files];
  if (change.barSlot) parts.push(`!bset ${change.barSlot.label}`);
  else if (change.barMiss === "oversized")
    parts.push("too big for any BAR slot");
  else if (change.barMiss === "unplaced")
    parts.push("no BAR slot left to hold it");
  else if (change.barMiss === "unresolved")
    parts.push("BAR slot not traced for this project");
  else if (change.barMiss === "noSlotForWords")
    parts.push("no BAR slot can carry words");
  if (change.uncompiledReason) parts.push(change.uncompiledReason);
  if (parts.length === 0) return null;
  return (
    <span className="font-mono text-[10px] text-muted-foreground">
      {parts.join(" · ")}
    </span>
  );
}

/** One traced change, linking back to the unit and, where it names one, the
 *  field it came from (issue #2653): a real link that takes you to the row
 *  rather than a name you then have to search the field list for. */
function ChangeLink({
  projectId,
  unit,
  change,
}: {
  projectId: string;
  unit: string;
  change: LedgerChange;
}) {
  return (
    <li className="flex flex-col gap-0.5">
      <Link
        to={projectPath(projectId, unit, change.fieldPath ?? undefined)}
        className="text-xs text-primary hover:underline"
      >
        {change.description}
      </Link>
      <ChangeDestination change={change} />
    </li>
  );
}

/**
 * What this project's edits compiled into, unit by unit or output by output
 * (issue #2653).
 *
 * Both views draw off the one trace `useChangeLedger` reads, because both
 * are real questions and neither answers the other. Grouped by unit is what
 * the issue asks for and what somebody tuning one unit's numbers wants: "what
 * did I just do to armcom". Grouped by output is what somebody holding a
 * broken file or a lobby slot wants: "what is in units/supercom.lua",
 * without first working out which of thirty units it might be. A file or a
 * lobby slot is the thing in your hand when the game is wrong, so it gets
 * its own view rather than being left for someone to reconstruct by reading
 * every unit's row.
 */
function ChangeLedgerSection({
  projectId,
  ledger,
  loading,
  error,
}: {
  projectId: string | undefined;
  ledger: ChangeLedger | null;
  loading: boolean;
  error: string | null;
}) {
  const [view, setView] = useState<"unit" | "output">("unit");
  const units = ledger?.units.filter((u) => u.changes.length > 0) ?? [];
  const totalChanges = units.reduce((n, u) => n + u.changes.length, 0);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">Change ledger</h3>
        {totalChanges > 0 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(v) => v && setView(v as "unit" | "output")}
            aria-label="Group the change ledger by"
          >
            <ToggleGroupItem value="unit">By unit</ToggleGroupItem>
            <ToggleGroupItem value="output">By output</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      {!projectId ? (
        <p className="text-muted-foreground text-sm">
          No project is open yet, so there is nothing to trace.
        </p>
      ) : error ? (
        <p className="text-destructive text-sm">
          The change ledger could not be built: {error}
        </p>
      ) : !ledger ? (
        <p className="text-muted-foreground text-sm">
          {loading ? "Tracing…" : "Not traced yet."}
        </p>
      ) : totalChanges === 0 ? (
        <p className="text-muted-foreground text-sm">
          This project changes nothing yet, so there is nothing to trace.
        </p>
      ) : view === "unit" ? (
        <ul className="flex flex-col gap-2">
          {units.map((unitLedger) => (
            <li
              key={unitLedger.unit}
              className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5"
            >
              <Link
                to={projectPath(projectId, unitLedger.unit)}
                className="font-mono text-xs font-medium hover:underline"
              >
                {unitLedger.unit}
              </Link>
              <ul className="flex flex-col gap-1.5 pl-2">
                {unitLedger.changes.map((change) => (
                  <ChangeLink
                    key={`${change.description}:${change.fieldPath ?? ""}`}
                    projectId={projectId}
                    unit={unitLedger.unit}
                    change={change}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {ledgerByOutput(ledger).map((row) => (
            <li
              key={row.key}
              className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5"
            >
              <span className="font-mono text-xs font-medium">{row.label}</span>
              <ul className="flex flex-col gap-1.5 pl-2">
                {row.entries.map(({ unit, change }) => (
                  <li key={`${unit}:${change.description}`} className="text-xs">
                    <Link
                      to={projectPath(
                        projectId,
                        unit,
                        change.fieldPath ?? undefined,
                      )}
                      className="text-primary hover:underline"
                    >
                      {unit}
                    </Link>
                    : {change.description}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {ledger && ledger.notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {ledger.notes.map((note) => (
            <li key={note} className="text-xs text-muted-foreground">
              {note}
            </li>
          ))}
        </ul>
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
  gameArchives,
  enginePath,
  dataDir,
  diagnosticErrors,
  diagnosticsChecking,
  routeOptions,
  routesChecking,
  project,
  compatibility,
  onApplyFix,
}: {
  gameName: string;
  /** The game's own archives, its primary one first, for the post-processing
   *  check to read (issue #2744). The engine's base content is deliberately
   *  not among them: see `postHook.ts`. */
  gameArchives: Archive[];
  /** Where to read those archives from. Undefined before a scan target is
   *  picked, in which case the post-processing check has nothing to read. */
  enginePath: string | undefined;
  dataDir: string | undefined;
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
  /** Whether the game has moved under the project, and what that did to it
   *  (issue #1281). Null when no project is open. Worked out by the page,
   *  which is where the game's definitions already are. */
  compatibility: CompatState | null;
  onApplyFix: (finding: CompatFinding) => void;
}) {
  const [open, setOpen] = useState(false);
  // Read whenever a project is open, not only while the drawer is up: see
  // the module doc comment for why the button needs a live answer.
  const preflight = usePreflightReport(project, true);
  // Only while the drawer is open: see the module doc comment for why the
  // change ledger does not need the same always-on read preflight does.
  const changeLedger = useChangeLedger(project, open);
  // Also live, for the same reason preflight is: the post-processing check
  // reaches the button's face, and it needs the compiler's own answer about
  // which files this project produces rather than a second guess at the rule.
  // One more compile per edit alongside the one preflight already runs.
  const compile = useCompiledProject(project, true);
  const postHook = usePostHookCheck(
    enginePath,
    dataDir,
    gameArchives,
    compile.compiled,
  );

  // A reference that names nothing is blocker-grade even though it stops no
  // export: the project compiles, ships, and then does not do what it says.
  // That is exactly the failure this check exists to stop being invisible, so
  // it must not sit behind a tick.
  const moved =
    compatibility?.kind === "moved" ? compatibility.report : undefined;
  // A covered post file is blocker-grade for the same reason a dead reference
  // is: nothing stops the export, and the game it produces is wrong.
  const covered = postHook.state?.kind === "covered" ? 1 : 0;
  const blockers =
    (preflight.report?.blockers.length ?? 0) + (moved?.broken ?? 0) + covered;
  const review = (preflight.report?.review.length ?? 0) + (moved?.review ?? 0);
  const diagnostics = diagnosticErrors.length;
  // A command that failed to answer is not a clean project, it is a question
  // this button could not settle. Kept apart from the counted severities
  // rather than folded into "review", which would say preflight ran and
  // found one thing rather than that it never ran at all.
  const preflightFailed = !!project && !!preflight.error;

  const preflightChecking = !!project && preflight.loading && !preflight.report;
  const checking =
    diagnosticsChecking ||
    routesChecking ||
    preflightChecking ||
    postHook.loading;
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
        description={`Whether ${gameName} is in a fit state to use: the game's own definitions, whether the project still fits them, how an edit reaches it, what a mutator would cover of the game's own post-processing, what is wrong with what you have written, and which output each edit ended up in.`}
        width="34rem"
      >
        <div className="flex flex-col gap-5">
          <UnitsyncSection errors={diagnosticErrors} />
          <CompatibilitySection
            gameName={gameName}
            state={compatibility}
            onFix={onApplyFix}
          />
          <RoutesSection
            gameName={gameName}
            options={routeOptions}
            checking={routesChecking}
          />
          <PostHookSection
            gameName={gameName}
            primaryArchive={gameArchives[0]?.name ?? ""}
            state={postHook.state}
            loading={postHook.loading}
          />
          <PreflightSection
            project={project}
            report={preflight.report}
            loading={preflight.loading}
            error={preflight.error}
          />
          <ChangeLedgerSection
            projectId={project?.id}
            ledger={changeLedger.ledger}
            loading={changeLedger.loading}
            error={changeLedger.error}
          />
        </div>
      </Drawer>
    </>
  );
}
