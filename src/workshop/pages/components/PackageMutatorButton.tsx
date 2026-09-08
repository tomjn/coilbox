/**
 * Package the open project as a `.sdz` somebody else can play (issue #1283).
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
 * check worth trusting to the frontend alone.
 */
import { Button, Drawer } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Package } from "lucide-react";
import { useState } from "react";
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

export function PackageMutatorButton({
  project,
  onPackaged,
}: {
  project: ModProject;
  /** Called with the version a package was just written under, so the page
   *  can record it and offer the next number after this one. */
  onPackaged: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const compiled = useCompiledProject(project, open);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const busy = phase.state === "checking" || phase.state === "packaging";

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
          setOpen(true);
        }}
        title="Package this project as a file somebody else can play"
      >
        <Package className="mr-1 size-3.5" />
        Package
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Package"
        description={`Write ${project.name} out as a .sdz for ${project.gameName}, ready to hand to somebody else or upload.`}
        width="26rem"
      >
        <div className="flex flex-col gap-5">
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
        </div>
      </Drawer>
    </>
  );
}
