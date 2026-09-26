/**
 * Whether this project is in a fit state to use, as one control (issue #2748).
 *
 * Six toolbar buttons landed on this page in the same handful of days, three
 * of which answer the same question: diagnostics reports what unitsync said
 * reading the game's definitions, delivery routes says which of the ways an
 * edit reaches a game this game supports, and preflight reports what is
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
 *
 * The drawer became the project's Checks section (issue #3111), a page of its
 * own, and the button became the verdict on that section's entry in the
 * project's section bar. The verdict still reads live whichever section is
 * open, and the change ledger still waits until the Checks page is.
 */
import { Button } from "@picoframe/frame";
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Archive, ConfigOption } from "@/content/bindings";
import type { ArmorProblem } from "../../armorClasses";
import type { ChangeLedger, LedgerChange } from "../../changeLedger";
import { ledgerByOutput, useChangeLedger } from "../../changeLedger";
import { compatSubject } from "../../checkMarkers";
import type { CompatFinding, CompatState } from "../../compatibility";
import { useCompiledProject } from "../../compile";
import { deliveryRoutes } from "../../deliveryRoutes";
import type { InPlaceDone } from "../../inPlaceProject";
import type { PostHookCheck, PostHookState } from "../../postHook";
import { POST_FILE, usePostHookCheck } from "../../postHook";
import type { PreflightReport, PreflightState } from "../../preflight";
import { usePreflightReport } from "../../preflight";
import type { ModProject } from "../../project";
import { projectPath } from "../../routes";
import { InPlaceWrite } from "./InPlaceWrite";

/**
 * A section that starts collapsed to one line unless it already has
 * something worth reading, so a page of six sections does not read as one
 * long scroll once the blockers and review items are pulled out to the top
 * (issue #3106). `hasContent` and `forceOpen` are read once content actually
 * arrives (most of these checks run async) and open the section the first
 * time either goes true, without fighting a reader who closed it again
 * afterwards.
 */
function CollapsibleSection({
  heading,
  count,
  hasContent,
  forceOpen = false,
  children,
}: {
  heading: string;
  /** Shown beside the heading when there is something to count. Omitted
   *  entirely when undefined, for a section with nothing worth a number. */
  count?: number;
  hasContent: boolean;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  // Null until a reader clicks the trigger: while it is null, open tracks
  // `hasContent`/`forceOpen` directly, so a check that resolves after mount
  // (most of these are async) opens the section the moment it has something
  // to say rather than a render later, with nothing left to race against
  // (issue #3106). Once clicked, the reader's own choice wins even if the
  // content later changes.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? (hasContent || forceOpen);

  return (
    <Collapsible open={open} onOpenChange={setManualOpen}>
      <h3 className="font-medium text-sm">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left"
          >
            <span>{heading}</span>
            <span
              className="flex items-center gap-1.5 text-muted-foreground text-xs"
              aria-hidden="true"
            >
              {count !== undefined && count > 0 && (
                <span className="tabular-nums">{count}</span>
              )}
              <ChevronDown
                className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </span>
          </button>
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

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

/** What unitsync said reading the game's own definitions, as one line either
 *  way (issue #3106): a count when it complained, since the complaints
 *  themselves are listed under Needs attention, and the same clean sentence
 *  as before when it did not. */
function UnitsyncSection({ errorCount }: { errorCount: number }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-sm">Game definitions</h3>
      <p className="text-muted-foreground text-sm">
        {errorCount > 0
          ? `unitsync had ${errorCount} complaint${errorCount === 1 ? "" : "s"} reading the game, listed under Needs attention above.`
          : "unitsync read everything it was asked for without complaining."}
      </p>
    </section>
  );
}

/**
 * One thing pulled into the Needs attention section, from whichever check
 * found it (issue #3106): a blocker or a review item, linking to the unit or
 * field it is about where one is known, and carrying the offer that goes with
 * it when coilbox has one. The cost is on the button rather than behind it,
 * because the alternative is a control that silently throws away an
 * afternoon's tuning (issue #1281). An item with no button is one where
 * there is no safe automatic fix, and the text says what is.
 */
type AttentionItem = {
  key: string;
  text: string;
  link?: string;
  fix?: { label: string; cost: string; onFix: () => void };
};

function AttentionRow({
  item,
  severity,
}: {
  item: AttentionItem;
  severity: "blocker" | "review";
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5">
      <div className="flex items-start gap-2">
        {severity === "blocker" ? (
          <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        )}
        {item.link ? (
          <Link to={item.link} className="text-primary text-sm hover:underline">
            {item.text}
          </Link>
        ) : (
          <span className="text-sm">{item.text}</span>
        )}
      </div>
      {item.fix && (
        <div className="flex items-center gap-2 self-end">
          <span className="text-muted-foreground text-xs">
            Loses {item.fix.cost}
          </span>
          <Button size="sm" variant="outline" onClick={item.fix.onFix}>
            {item.fix.label}
          </Button>
        </div>
      )}
    </li>
  );
}

/** One severity's worth of items, or nothing when there are none. */
function AttentionGroup({
  heading,
  items,
  severity,
}: {
  heading: string;
  items: AttentionItem[];
  severity: "blocker" | "review";
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
        {heading}
      </h4>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <AttentionRow key={item.key} item={item} severity={severity} />
        ))}
      </ul>
    </div>
  );
}

/**
 * What needs action, pulled together from every check into one list, blockers
 * first (issue #3106): a blocker would reach the game broken, and a "worth a
 * look" item is one the compiler or the comparison already chose to proceed
 * past. This is the first thing on the page, so a blocker below a wall of
 * sections that passed is no longer possible.
 */
function AttentionSection({
  blockers,
  review,
}: {
  blockers: AttentionItem[];
  review: AttentionItem[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium text-sm">Needs attention</h3>
      {blockers.length === 0 && review.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing here needs attention.
        </p>
      ) : (
        <>
          <AttentionGroup
            heading="Blockers"
            items={blockers}
            severity="blocker"
          />
          <AttentionGroup
            heading="Worth a look"
            items={review}
            severity="review"
          />
        </>
      )}
    </section>
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
}: {
  gameName: string;
  state: CompatState | null;
}) {
  const findings = state?.kind === "moved" ? state.report.findings : [];
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
      ) : findings.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {gameName} has been updated since this project was written, and
          everything the project names is still there.
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">
          {gameName} has been updated since this project was written. These
          edits name things it no longer has: {findings.length} finding
          {findings.length === 1 ? "" : "s"}, listed under Needs attention
          above.
        </p>
      )}
    </section>
  );
}

/** Which of the two delivery routes this game supports, and why when one is
 *  not. Third in the drawer: once the game reads cleanly and the project still
 *  fits it, this is how an edit actually reaches it.
 *
 *  Once `options` has answered once, a re-read (`checking` true again) keeps
 *  the list on screen rather than swapping it for the "Reading…" line. An
 *  in-place write, undo or accept makes the page re-read the game (issue
 *  #2637), which re-reads options too, and swapping the list out would
 *  unmount `InPlaceWrite` mid re-read and take its own "Wrote …" message with
 *  it (issue #3028). The stale list briefly shown during that re-read is the
 *  same one already on screen, not a wrong answer. */
function RoutesSection({
  gameName,
  options,
  gamePath,
  checking,
  project,
  gameUnits,
  reading,
  onInPlaceWrite,
}: {
  gameName: string;
  options: ConfigOption[] | undefined;
  /** The game's on-disk path, so the edit-in-place route can tell a loose
   *  `.sdd` under a content root's `games` folder from anything else
   *  (issue #2631). Undefined before a scan target resolves it. */
  gamePath: string | undefined;
  checking: boolean;
  /** The open project, which the edit-in-place route writes (issue #2635). */
  project: ModProject | undefined;
  /** The game's own read of its units, which a copy written in place is
   *  measured against (issue #2634). */
  gameUnits: Record<string, Record<string, unknown>>;
  /** The page is still reading the game's definitions, so the
   *  edit-in-place route waits (issue #3023). */
  reading: boolean;
  /** Called after an edit-in-place action went through, so the page can
   *  follow it in the project (issue #3023) and drop its own unitsync reads
   *  of the game (issue #2637). */
  onInPlaceWrite: (done: InPlaceDone) => void;
}) {
  const routes = options
    ? deliveryRoutes(
        options,
        gameName,
        gamePath,
        Object.keys(project?.edits.explosionGenerators ?? {}).length > 0,
      )
    : undefined;
  return (
    <CollapsibleSection
      heading="Delivery routes"
      count={routes?.filter((r) => r.available).length}
      // Always has something to report: even a route that is not available
      // is itself the answer to "how does an edit reach this game", so this
      // stays open by default rather than collapsing to nothing (issue
      // #3106).
      hasContent
    >
      {checking && !options ? (
        <p className="text-muted-foreground text-sm">
          Reading which routes {gameName} supports…
        </p>
      ) : !routes ? (
        <p className="text-muted-foreground text-sm">
          {gameName}'s mod options could not be read, so which routes it
          supports is not known.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {routes.map((r) => (
            <li key={r.route} className="flex gap-2">
              {r.available ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium text-sm">{r.label}</span>
                <span className="text-muted-foreground text-xs">
                  {r.detail}
                </span>
                {r.route === "edit-in-place" && r.available && gamePath && (
                  <div className="mt-1.5">
                    <InPlaceWrite
                      gameDir={gamePath}
                      project={project}
                      gameUnits={gameUnits}
                      reading={reading}
                      onDone={onInPlaceWrite}
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
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
  state,
  loading,
}: {
  gameName: string;
  state: PostHookState | null;
  loading: boolean;
}) {
  return (
    <CollapsibleSection
      heading="Post-processing"
      // A covered post file is a blocker, listed above already: this section
      // only has something of its own to say for the other two answers
      // (issue #3106).
      hasContent={state?.kind === "clear" || state?.kind === "unknown"}
      forceOpen={loading}
    >
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
        <p className="text-muted-foreground text-sm">
          This mutator would overwrite {gameName}'s own post-processing, listed
          under Needs attention above.
        </p>
      )}
    </CollapsibleSection>
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
    <CollapsibleSection
      heading="Preflight"
      count={report?.passes.length}
      hasContent={!!report && report.passes.length > 0}
      forceOpen={loading || !!error || !report}
    >
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
    </CollapsibleSection>
  );
}

/** What to say about where a change landed, or why it did not, under its
 *  description: the file(s) it reached, the tweak slot when the trace could
 *  place it, and the reason when it could not reach anything at all. */
function ChangeDestination({ change }: { change: LedgerChange }) {
  const parts: string[] = [...change.files];
  if (change.tweakSlot) parts.push(`!bset ${change.tweakSlot.label}`);
  else if (change.tweakMiss === "oversized")
    parts.push("too big for any tweak slot");
  else if (change.tweakMiss === "unplaced")
    parts.push("no tweak slot left to hold it");
  else if (change.tweakMiss === "unresolved")
    parts.push("tweak slot not traced for this project");
  else if (change.tweakMiss === "noSlotForWords")
    parts.push("no tweak slot can carry words");
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
    <CollapsibleSection
      heading="Change ledger"
      count={totalChanges}
      hasContent={totalChanges > 0}
      forceOpen={loading || !!error || !ledger}
    >
      {totalChanges > 0 && (
        <div className="flex justify-end pb-2">
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
        </div>
      )}
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
    </CollapsibleSection>
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

/** What the checks read, which the page already holds. */
export type ChecksInput = {
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
  /** The game's own read of its units, without the project's copies, which
   *  a copy written in place is measured against (issue #2634). */
  gameUnits: Record<string, Record<string, unknown>>;
  /** Whether the game has moved under the project, and what that did to it
   *  (issue #1281). Null when no project is open. Worked out by the page,
   *  which is where the game's definitions already are. */
  compatibility: CompatState | null;
  /** A weapon's damage table naming an armour class this game does not have,
   *  across every unit the project has patched or copied and every weapon
   *  its library holds (issue #3104), so the finding is visible without
   *  opening the unit it is about. Worked out by the page, the same way
   *  `compatibility` is, since it already holds the project's edits and the
   *  game's live data. */
  armorClassProblems: ArmorProblem[];
};

/**
 * Every check's answer, and the one verdict they add up to.
 *
 * A hook of its own rather than inside the Checks page, because the verdict
 * is on the project's section bar whichever section is open (issue #3111),
 * and a count that only ran while you were looking at it could not warn you.
 * `reading` is whether the Checks page itself is open, which only the change
 * ledger waits for: see the module doc comment.
 */
export function useProjectChecks(input: ChecksInput, reading: boolean) {
  const {
    project,
    enginePath,
    dataDir,
    gameArchives,
    compatibility,
    armorClassProblems,
    diagnosticErrors,
    diagnosticsChecking,
    routesChecking,
  } = input;
  // Read whenever a project is open, not only while the page is up: see the
  // module doc comment for why the verdict needs a live answer.
  const preflight = usePreflightReport(project, true);
  const changeLedger = useChangeLedger(project, reading);
  // Also live, for the same reason preflight is: the post-processing check
  // reaches the verdict, and it needs the compiler's own answer about which
  // files this project produces rather than a second guess at the rule. One
  // more compile per edit alongside the one preflight already runs.
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
  const review =
    (preflight.report?.review.length ?? 0) +
    (moved?.review ?? 0) +
    armorClassProblems.length;
  const diagnostics = diagnosticErrors.length;
  // A command that failed to answer is not a clean project, it is a question
  // the checks could not settle. Kept apart from the counted severities
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
  const summary = checking
    ? "Checking the project"
    : preflightFailed
      ? `Preflight could not run: ${preflight.error}`
      : found
        ? `${found} found`
        : "No problems found";

  return {
    preflight,
    changeLedger,
    postHook,
    checking,
    clean,
    blockers,
    /** Everything counted, whatever its severity, for the section bar. */
    total: blockers + review + diagnostics,
    /** The verdict as a sentence, for an accessible name and a tooltip. */
    summary,
  };
}

export type ProjectChecksState = ReturnType<typeof useProjectChecks>;

/**
 * The verdict, small enough to sit on the Checks entry in the section bar
 * (issue #3111): an icon, and a count once there is something to count.
 * A clean project shows a tick and no number, for the reason the module doc
 * comment gives. The full wording is the caller's to put in an accessible
 * name, since this draws no text of its own a screen reader could use.
 */
export function ChecksBadge({ checks }: { checks: ProjectChecksState }) {
  const colour = checks.checking
    ? "text-muted-foreground"
    : checks.clean
      ? "text-emerald-600 dark:text-emerald-400"
      : checks.blockers > 0
        ? "text-destructive"
        : "text-amber-700 dark:text-amber-400";
  return (
    <span
      className={`inline-flex items-center gap-1 ${colour}`}
      aria-hidden="true"
    >
      {checks.checking ? (
        <Loader2 className="size-3.5 motion-safe:animate-spin" />
      ) : checks.clean ? (
        <Check className="size-3.5" />
      ) : (
        <TriangleAlert className="size-3.5" />
      )}
      {!checks.checking && checks.total > 0 && (
        <span className="text-xs tabular-nums">{checks.total}</span>
      )}
    </span>
  );
}

/** Where a compatibility finding's subject can be followed to, or undefined
 *  when the store it names does not hold a unit at all (issue #3106): a
 *  `menus` or `text` reference names something other than a unit key, and a
 *  link there would open the wrong page. An `overrides` finding scoped to one
 *  field (issue #3116) opens on that field rather than merely on the unit, so
 *  clicking it lands where the problem is instead of leaving it to be found
 *  again in the field list. */
function compatFindingLink(
  projectId: string | undefined,
  finding: CompatFinding,
): string | undefined {
  if (!projectId) return undefined;
  if (
    finding.store === "overrides" ||
    finding.store === "clones" ||
    finding.store === "disabled"
  ) {
    const { unit, field } = compatSubject(finding);
    return projectPath(projectId, unit, field);
  }
  return undefined;
}

/** Where an armour class finding can be followed to: its own `id` is
 *  namespaced by the unit it was found on (issue #3104), except a finding
 *  against a library weapon, which names no unit to open. */
function armorProblemLink(
  projectId: string | undefined,
  problem: ArmorProblem,
): string | undefined {
  if (!projectId) return undefined;
  const unit = problem.id.split(":")[0];
  if (!unit || unit === "library") return undefined;
  return projectPath(projectId, unit);
}

/**
 * Every blocker and review item, from every check, in one pair of lists
 * (issue #3106): the module doc comment's five sources plus the armour class
 * finding, pulled out of whichever section found them so the page can open on
 * them first.
 */
function buildAttention({
  gameName,
  project,
  preflight,
  compatibility,
  postHook,
  primaryArchive,
  armorClassProblems,
  onApplyFix,
}: {
  gameName: string;
  project: ModProject | undefined;
  preflight: PreflightState;
  compatibility: CompatState | null;
  postHook: PostHookCheck;
  primaryArchive: string;
  armorClassProblems: ArmorProblem[];
  onApplyFix: (finding: CompatFinding) => void;
}): { blockers: AttentionItem[]; review: AttentionItem[] } {
  const blockers: AttentionItem[] = [];
  const review: AttentionItem[] = [];

  for (const line of preflight.report?.blockers ?? [])
    blockers.push({ key: `preflight-blocker:${line}`, text: line });
  for (const line of preflight.report?.review ?? [])
    review.push({ key: `preflight-review:${line}`, text: line });

  const moved = compatibility?.kind === "moved" ? compatibility.report : null;
  for (const finding of moved?.findings ?? []) {
    const item: AttentionItem = {
      key: finding.id,
      text: finding.detail,
      link: compatFindingLink(project?.id, finding),
      fix: finding.fix
        ? {
            label: finding.fix.label,
            cost: finding.fix.cost,
            onFix: () => onApplyFix(finding),
          }
        : undefined,
    };
    (finding.severity === "broken" ? blockers : review).push(item);
  }

  if (postHook.state?.kind === "covered") {
    const state = postHook.state;
    blockers.push({
      key: "post-hook-covered",
      text: `${
        state.archive === primaryArchive
          ? `${gameName} post-processes its own units in ${POST_FILE}.`
          : `${gameName} inherits a ${POST_FILE} from ${state.archive}.`
      } This project's mutator writes a file at that path, which takes its place. The engine's definition parser gives a mutator no way to run the file it covered, so playing this mutator skips whatever ${gameName} does there, from a few missing values to a game that does not start. Deliver it through the tweak slots instead, if this game has them.`,
    });
  }

  for (const problem of armorClassProblems)
    review.push({
      key: problem.id,
      text: problem.message,
      link: armorProblemLink(project?.id, problem),
    });

  return { blockers, review };
}

/**
 * The project's Checks section (issue #3111): what used to be the checks
 * drawer, as a page. Blockers and review items open the page pulled together
 * from every section, and the rest collapses to one line each when it has
 * nothing to report (issue #3106).
 */
export function ChecksPanel({
  input,
  checks,
  onApplyFix,
  onInPlaceWrite,
}: {
  input: ChecksInput;
  checks: ProjectChecksState;
  onApplyFix: (finding: CompatFinding) => void;
  /** Called after an edit-in-place action went through, so the page can
   *  follow it in the project (issue #3023) and drop its own unitsync reads
   *  of the game (issue #2637). */
  onInPlaceWrite: (done: InPlaceDone) => void;
}) {
  const {
    gameName,
    gameArchives,
    diagnosticErrors,
    diagnosticsChecking,
    routeOptions,
    routesChecking,
    project,
    gameUnits,
    compatibility,
    armorClassProblems,
  } = input;
  const { preflight, changeLedger, postHook } = checks;
  const primaryArchive = gameArchives[0]?.name ?? "";
  const attention = buildAttention({
    gameName,
    project,
    preflight,
    compatibility,
    postHook,
    primaryArchive,
    armorClassProblems,
    onApplyFix,
  });
  // Diagnostics read as "to review" everywhere else the verdict is put into
  // words (`verdict()` above): kept apart here too, rather than merged into
  // `buildAttention`, since they carry no link and no fix and would only add
  // branching to the parts that do.
  const review = [
    ...attention.review,
    ...diagnosticErrors.map((line) => ({
      key: `diagnostic:${line}`,
      text: line,
    })),
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <p className="max-w-prose text-sm text-muted-foreground">
        Whether {gameName} is in a fit state to use: the game's own definitions,
        whether the project still fits them, how an edit reaches it, what a
        mutator would cover of the game's own post-processing, what is wrong
        with what you have written, and which output each edit ended up in.
      </p>
      <AttentionSection blockers={attention.blockers} review={review} />
      <UnitsyncSection errorCount={diagnosticErrors.length} />
      <CompatibilitySection gameName={gameName} state={compatibility} />
      <RoutesSection
        gameName={gameName}
        options={routeOptions}
        gamePath={gameArchives[0]?.path}
        checking={routesChecking}
        project={project}
        gameUnits={gameUnits}
        reading={diagnosticsChecking}
        onInPlaceWrite={onInPlaceWrite}
      />
      <PostHookSection
        gameName={gameName}
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
  );
}
