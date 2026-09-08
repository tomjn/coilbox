/**
 * Package the open project as a `.sdz` somebody else can play (issue #1283),
 * or pack it across Beyond All Reason's numbered tweak slots for somebody
 * else's lobby (issue #1277).
 *
 * The two are kept as one toolbar control rather than two. Both are "hand
 * this project to somebody who is not at this machine" and both need the
 * same preflight gate first, and the toolbar had already grown a checks
 * control, Lua, Test and Package by the time this was written (issue #2748).
 * A fifth button for a second export route would have made that worse for a
 * feature most projects will never reach for (most players are not hosting
 * their own BAR lobby), so the BAR route is a second mode inside this
 * drawer instead, chosen with the toggle at its top. The default mode and
 * every element the existing tests look for are unchanged: opening the
 * drawer still shows the mutator export first.
 *
 * The Test button (`PlayLocallyButton.tsx`) writes into
 * `WORKSHOP_MUTATOR_FOLDER`, a name coilbox owns on purpose: testing twice
 * reuses the one folder, and deleting it undoes everything that route ever
 * wrote. Handing a mutator to somebody else is the opposite case. It needs a
 * name the author chose, which the project's own name already is, and a
 * version that changes, because two people playing different builds under
 * the same archive name is a sync error rather than an error message. So
 * this drawer shows the version as a fact about the export rather than a box
 * to type in, and bumps it every time a package actually gets written.
 *
 * Preflight runs before anything is written, the same guard
 * `PlayLocallyButton` uses before a local launch: a blocker here would reach
 * whoever downloads the file broken, which is exactly the case issue #2748's
 * checks control exists to stop before it leaves the app. The Rust command
 * checks again regardless, since a file going out to other people is not a
 * check worth trusting to the frontend alone. The BAR mode runs the same
 * gate before packing, for the same reason: a lobby chat line is going out
 * to other people too.
 */
import { Button, Drawer } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Check, Copy, Package } from "lucide-react";
import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ConfigOption } from "@/content/bindings";
import {
  type BarSlotPack,
  barSlotFit,
  workshopPackBarSlots,
} from "../../barPack";
import { useCompiledProject } from "../../compile";
import { packagedMutatorFileName, workshopPackageMutator } from "../../package";
import { workshopPreflight } from "../../preflight";
import type { ModProject } from "../../project";

type Phase =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "packaging" }
  | { state: "done"; path: string; version: number }
  | { state: "failed"; message: string };

type ExportMode = "mutator" | "bar";

type BarPhase =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "packing" }
  | { state: "done"; pack: BarSlotPack }
  | { state: "failed"; message: string };

/** One press to put a line on the clipboard. Local to this file rather than
 *  shared, matching the copy button `LuaTableValue.tsx` already rolls for
 *  itself: small enough that a shared component would cost more to find and
 *  read than to repeat. */
function CopyLineButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-6 shrink-0 gap-1 px-2"
      aria-label={label}
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * Whether packing needed more of one kind of slot than the game declares
 * (issue #1277's "say so before the export rather than after"), plus every
 * chunk that could not be placed at all regardless of the game's own count.
 */
function BarFitWarning({
  pack,
  routeOptions,
}: {
  pack: BarSlotPack;
  routeOptions: ConfigOption[] | undefined;
}) {
  const fit = barSlotFit(pack, routeOptions ?? []);
  const messages: string[] = [];
  if (!fit.fits) {
    if (fit.needed.defs > fit.available.defs) {
      messages.push(
        `This pack needs ${fit.needed.defs} tweakdefs slot${fit.needed.defs === 1 ? "" : "s"}, but this game only declares ${fit.available.defs}.`,
      );
    }
    if (fit.needed.units > fit.available.units) {
      messages.push(
        `This pack needs ${fit.needed.units} tweakunits slot${fit.needed.units === 1 ? "" : "s"}, but this game only declares ${fit.available.units}.`,
      );
    }
  }
  for (const title of pack.oversized) {
    messages.push(
      `${title} would exceed BAR's per-slot limit even alone in an empty slot, so it was left out.`,
    );
  }
  for (const title of pack.unplaced) {
    messages.push(
      `${title} would have fit a slot on its own, but every slot BAR exposes was already used, so it was left out.`,
    );
  }
  if (messages.length === 0) return null;
  return (
    <ul className="flex list-disc flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 pl-6 text-xs text-amber-700 dark:text-amber-400">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

/**
 * The BAR export mode: pack the project across numbered tweak slots and show
 * one `!bset` line per slot, each with its own copy button. Nothing is
 * written by coilbox itself: pasting a line into the target lobby's chat is
 * the player's own action, since a player who is not hosting has no other
 * way to set the mod option (see this file's own doc comment).
 */
function BarSlotExportSection({
  project,
  routeOptions,
}: {
  project: ModProject;
  routeOptions: ConfigOption[] | undefined;
}) {
  const [phase, setPhase] = useState<BarPhase>({ state: "idle" });
  const busy = phase.state === "checking" || phase.state === "packing";

  async function run() {
    setPhase({ state: "checking" });
    try {
      const preflight = await workshopPreflight({ project });
      if (preflight.blockers.length > 0) {
        const [first, ...rest] = preflight.blockers;
        setPhase({
          state: "failed",
          message: `${preflight.blockers.length} blocker${preflight.blockers.length === 1 ? "" : "s"} would reach the lobby broken: ${first}${rest.length > 0 ? ` (and ${rest.length} more)` : ""}`,
        });
        return;
      }
      setPhase({ state: "packing" });
      const pack = await workshopPackBarSlots({ project });
      setPhase({ state: "done", pack });
    } catch (error) {
      setPhase({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const lines =
    phase.state === "done"
      ? [...phase.pack.tweakdefs, ...phase.pack.tweakunits]
      : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Packs this project into `!bset` lines for BAR's numbered tweak slots.
        Paste each line into the target lobby's chat, in order, for a server
        that answers to `!bset` (a SPADS-based autohost).
      </p>
      <Button onClick={() => void run()} disabled={busy}>
        <Package className="size-4" />
        {phase.state === "checking"
          ? "Checking"
          : phase.state === "packing"
            ? "Packing"
            : "Pack for BAR"}
      </Button>

      {phase.state === "failed" ? (
        <p className="text-xs text-destructive">{phase.message}</p>
      ) : null}

      {phase.state === "done" ? (
        <div className="flex flex-col gap-3">
          <BarFitWarning pack={phase.pack} routeOptions={routeOptions} />
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This project has nothing that packs into a tweak slot.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line, index) => (
                // Lines are stable for one pack result and never reordered.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <li key={index} className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-muted/40 px-2 py-1 text-xs">
                    {line}
                  </code>
                  <CopyLineButton
                    value={line}
                    label={`Copy ${line.split(" ")[1]}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PackageMutatorButton({
  project,
  onPackaged,
  routeOptions,
}: {
  project: ModProject;
  /** Called with the version a package was just written under, so the page
   *  can record it and offer the next number after this one. */
  onPackaged: (version: number) => void;
  /** The selected game's mod options, so the BAR mode can compare what it
   *  packed against how many tweak slots the game actually declares. `undefined`
   *  while unread, in which case the BAR mode is offered but cannot yet warn
   *  about a shortfall. */
  routeOptions?: ConfigOption[];
}) {
  const [open, setOpen] = useState(false);
  const compiled = useCompiledProject(project, open);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const busy = phase.state === "checking" || phase.state === "packaging";
  const [mode, setMode] = useState<ExportMode>("mutator");

  const nextVersion = (project.distributionVersion ?? 0) + 1;
  const nothingToPackage =
    !compiled.loading && (compiled.compiled?.files.length ?? 0) === 0;

  async function run() {
    if (!compiled.compiled || nothingToPackage) return;
    setPhase({ state: "checking" });
    try {
      // Nothing leaves the app unchecked (issue #1276), and a file handed to
      // somebody else is exactly the case a blocker should stop rather than
      // only flag (issue #2748).
      const preflight = await workshopPreflight({ project });
      if (preflight.blockers.length > 0) {
        const [first, ...rest] = preflight.blockers;
        setPhase({
          state: "failed",
          message: `${preflight.blockers.length} blocker${preflight.blockers.length === 1 ? "" : "s"} would reach whoever plays this broken: ${first}${rest.length > 0 ? ` (and ${rest.length} more)` : ""}`,
        });
        return;
      }

      const dest = await save({
        title: "Package tweak project",
        defaultPath: packagedMutatorFileName(project, nextVersion),
        filters: [{ name: "Mutator archive", extensions: ["sdz"] }],
      });
      if (!dest) {
        setPhase({ state: "idle" });
        return;
      }

      setPhase({ state: "packaging" });
      const written = await workshopPackageMutator({
        project,
        version: nextVersion,
        dest,
      });
      onPackaged(written.version);
      setPhase({ state: "done", path: written.path, version: written.version });
    } catch (error) {
      setPhase({
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setPhase({ state: "idle" });
          setMode("mutator");
          setOpen(true);
        }}
        title="Package this project as a file somebody else can play, or pack it for a BAR lobby"
      >
        <Package className="mr-1 size-3.5" />
        Package
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Package"
        description={
          mode === "mutator"
            ? `Write ${project.name} out as a .sdz for ${project.gameName}, ready to hand to somebody else or upload.`
            : `Pack ${project.name} across Beyond All Reason's numbered tweak slots, for a lobby you are not hosting yourself.`
        }
        width="26rem"
      >
        <div className="flex flex-col gap-5">
          {/* Which export to prepare. Kept ahead of everything else so
            switching modes never disturbs a run already under way in the
            other one: `phase` and the BAR section's own state are separate,
            so flipping this back and forth does not lose either result. */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => v && setMode(v as ExportMode)}
            aria-label="Which export to prepare"
          >
            <ToggleGroupItem value="mutator">Mutator archive</ToggleGroupItem>
            <ToggleGroupItem value="bar">BAR tweak slots</ToggleGroupItem>
          </ToggleGroup>

          {mode === "bar" ? (
            nothingToPackage ? (
              <p className="text-xs text-muted-foreground">
                This project has no edits yet, so there is nothing to pack.
              </p>
            ) : (
              <BarSlotExportSection
                project={project}
                routeOptions={routeOptions}
              />
            )
          ) : (
            <>
              <div className="flex flex-col gap-1 rounded border border-border/60 px-3 py-2 text-sm">
                <span className="font-medium">Version {nextVersion}</span>
                <span className="text-xs text-muted-foreground">
                  {project.distributionVersion
                    ? `Bumped from ${project.distributionVersion} automatically. Two players on different builds of the same name is a sync error, so the number always moves on rather than being typed in.`
                    : "This project has not been packaged before. Coilbox bumps this number itself on every export after this one, so a re-download never lands on the same version as a different build."}
                </span>
              </div>

              <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
                <Button
                  onClick={() => void run()}
                  disabled={busy || nothingToPackage}
                >
                  <Package className="size-4" />
                  {phase.state === "checking"
                    ? "Checking"
                    : phase.state === "packaging"
                      ? "Writing the archive"
                      : nothingToPackage
                        ? "Nothing to package yet"
                        : "Save as .sdz…"}
                </Button>
              </div>

              {nothingToPackage ? (
                <p className="text-xs text-muted-foreground">
                  This project has no edits yet, so there is nothing to package.
                </p>
              ) : null}

              {phase.state === "failed" ? (
                <p className="text-xs text-destructive">{phase.message}</p>
              ) : null}

              {phase.state === "done" ? (
                <div className="flex flex-col gap-2 text-xs text-muted-foreground">
                  <p>Wrote version {phase.version} to:</p>
                  <p className="break-all">
                    <code>{phase.path}</code>
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Drawer>
    </>
  );
}
