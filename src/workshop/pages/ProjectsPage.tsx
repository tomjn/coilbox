/**
 * The tweak projects on this machine, and everything you do to a project rather
 * than inside one (issues #1282 and #2696).
 *
 * This was a drawer hanging off the unit page, because the unit page was the
 * whole workshop and a route would have unmounted the edits you were making.
 * Now it is where the workshop opens, the way `/lego` opens on the models you
 * have built: a project is scoped to one game (issue #2664), so choosing the
 * game is part of starting a project rather than a menu inside the editor.
 *
 * A card says what tells two projects apart: what the author called it and said
 * it was for, which game, how much it changes and when it last changed. Not a
 * picture. The unit builder's list is pictures because a model is a shape, and a
 * tweak project is a hundred numbers spread over a game's units with no one unit
 * standing for the rest. Drawing a build picture for a project would also mean
 * mounting every game's archives to read one, which is the 23 second read the
 * unit page spends once.
 *
 * The card itself opens the project, and everything else you can do to one is in
 * its menu with a word beside it (`ProjectCardMenu`, issue #2706). Starting one,
 * and renaming one afterwards, are the same drawer (`ProjectDetailsDrawer`,
 * issue #2707).
 *
 * Starting a project here records no checksum, because nothing has read the
 * game yet and the list must not wait 23 seconds to offer a button. The editor
 * fills it in the first time it opens the project against a game it can read.
 */
import { Button } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Plus, SlidersHorizontal, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import { gameIdentityForName } from "@/container/gameIdentity";
import { contentWriteFile } from "@/content/bindings";
import { useScanTargetSelection, useUnitsyncScan } from "@/content/config";
import { EmptyState } from "@/content/pages/components/states";
import { importContainerFile } from "@/deeplink/bindings";
import { buildImportCodeLink } from "@/deeplink/build";
import { copyDeepLink } from "@/deeplink/copyLink";
import { useImportParam } from "@/deeplink/useImportParam";
import { forgetEditHistory } from "../history";
import {
  describeEdits,
  type ModProject,
  modProjectCode,
  modProjectFileName,
  modProjectJson,
  parseModProjectJson,
  useModProjects,
} from "../project";
import { projectPath, unitEditPath } from "../routes";
import { ProjectCardMenu } from "./components/ProjectCardMenu";
import {
  type ProjectDetails,
  ProjectDetailsDrawer,
} from "./components/ProjectDetailsDrawer";

/** When a project was last written to, in words a person reads at a glance. */
function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString();
}

export default function ProjectsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const games = useMemo(() => scan.data?.games ?? [], [scan.data]);
  const {
    projects,
    createProject,
    updateProjectDetails,
    duplicateProject,
    removeProject,
  } = useModProjects();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Whether the details drawer is up to start a project. */
  const [starting, setStarting] = useState(false);
  /** The project the details drawer is up to rename, if it is. */
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Newest first, which is the order the editor's own "which project does this
  // game's link open" answer uses. Sorting is safe here in a way it was not in
  // the drawer this replaces: nothing on this page writes an edit, so the list
  // cannot reorder itself under the cursor.
  const listed = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects],
  );

  /** The project the details drawer has open, when it is renaming one. */
  const renaming = renamingId
    ? (projects.find((p) => p.id === renamingId) ?? null)
    : null;

  function closeDetails() {
    setStarting(false);
    setRenamingId(null);
  }

  /**
   * The details drawer's one submit, for both jobs it does.
   *
   * Starting a project opens it, because the drawer asked everything the editor
   * would have and there is nothing left to do on this page. Renaming stays
   * here, since the reason to rename is usually that you are looking at two
   * projects you cannot tell apart.
   */
  function saveDetails(details: ProjectDetails) {
    if (renaming) {
      updateProjectDetails(renaming.id, details);
      closeDetails();
      return;
    }
    const project = createProject({
      name: details.name,
      description: details.description,
      gameName: details.gameName,
      game: gameIdentityForName(details.gameName, games) ?? undefined,
    });
    closeDetails();
    navigate(projectPath(project.id));
  }

  /**
   * A link built before #2696, and the "Edit in Unit tweaks" button on a unit's
   * encyclopedia page as it was then: `/workshop?game=&unit=`. Somebody
   * following one has picked a unit rather than a project, so it is resolved to
   * the game's own project, or to the editor with none yet, rather than being
   * dropped here having lost the unit they were reading about.
   *
   * Held in a ref for the same reason the unit page holds its openers in one:
   * the effect must not re-run every time the project list changes underneath.
   */
  const legacyGame = params.get("game");
  const legacyUnit = params.get("unit") ?? "";
  const resolveRef = useRef<(game: string, unit: string) => void>(() => {});
  resolveRef.current = (game, unit) => {
    navigate(unitEditPath(projects, game, unit), { replace: true });
  };
  useEffect(() => {
    if (legacyGame) resolveRef.current(legacyGame, legacyUnit);
  }, [legacyGame, legacyUnit]);

  /**
   * A shared project link lands here with its code in the query string. It is
   * saved and opened, because a project is a document rather than a setting:
   * nothing about the game changes until it is compiled, so there is nothing to
   * ask permission for beyond the deep-link confirmation it already passed.
   */
  const { code: importCode } = useImportParam();
  const importRef = useRef<(code: string) => void>(() => {});
  importRef.current = (code: string) => {
    const imported = parseModProjectJson(code);
    if (!imported) {
      setError("That link is not a coilbox tweak project.");
      return;
    }
    setError(null);
    navigate(projectPath(createProject(imported).id));
  };
  useEffect(() => {
    if (importCode) importRef.current(importCode);
  }, [importCode]);

  async function onExport(project: ModProject) {
    setError(null);
    try {
      const dest = await save({
        title: "Export tweak project",
        defaultPath: modProjectFileName(project),
        filters: [{ name: "Coilbox tweak project", extensions: ["json"] }],
      });
      if (!dest) return;
      await contentWriteFile({
        dest,
        text: modProjectJson(project, games),
      });
      setStatus(`Exported "${project.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onCopyLink(project: ModProject) {
    setError(null);
    const result = modProjectCode(project, games);
    if (!result.ok) {
      // Said here rather than on the far end, where it arrives as a corrupt
      // code. Exporting the file still works at any size.
      setError(
        `"${project.name}" is ${Math.round(result.length / 1024)} KB as a link, over the ${Math.round(result.limit / 1024)} KB a link can carry. Export it as a file instead.`,
      );
      return;
    }
    void copyDeepLink(buildImportCodeLink(result.code));
    setStatus(`Copied a link to "${project.name}".`);
  }

  async function onImport() {
    setError(null);
    try {
      const src = await open({
        title: "Import tweak project",
        multiple: false,
        filters: [{ name: "Coilbox tweak project", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const { text } = await importContainerFile({ src });
      const imported = parseModProjectJson(text);
      if (!imported) {
        setError("That is not a coilbox tweak project.");
        return;
      }
      navigate(projectPath(createProject(imported).id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    // A pause before the tip, so crossing a card on the way to another one does
    // not flash a box over the name you were reading.
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-4 p-4">
        <PageHeader
          title={
            <>
              <SlidersHorizontal size={18} /> Unit tweaks
            </>
          }
          description="A project is one game's edits under a name, saved as you work and exportable as a file somebody else can open. Open one to change what its game's units cost, carry and can do."
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={onImport}>
                <Upload className="mr-1 size-3.5" />
                Import
              </Button>
              <Button size="sm" onClick={() => setStarting(true)}>
                <Plus className="mr-1 size-3.5" />
                New project
              </Button>
            </>
          }
        />

        <ProjectDetailsDrawer
          open={starting || !!renaming}
          onOpenChange={(next) => {
            if (!next) closeDetails();
          }}
          project={renaming ?? undefined}
          games={games}
          scanning={scan.loading}
          existing={projects}
          onSubmit={saveDetails}
        />

        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {status ? (
          <p className="text-muted-foreground text-sm">{status}</p>
        ) : null}

        {listed.length === 0 ? (
          <EmptyState label="No tweak projects yet. Start one against a game, or import one somebody sent you." />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
            {listed.map((project) => (
              // The card is the thing you open, so the whole of it is the link
              // and it colours under the pointer rather than leaving the title to
              // carry an underline on its own (issue #2706). The menu is a
              // sibling of the link, not a child: a button inside a link is a
              // link nobody can trust.
              <li
                key={project.id}
                className="group relative rounded border border-border transition-colors hover:border-primary/40 hover:bg-accent/50"
              >
                <Link
                  to={projectPath(project.id)}
                  className="flex flex-col gap-1 p-3 pr-10"
                >
                  <span className="truncate font-medium text-sm group-hover:underline">
                    {project.name}
                  </span>
                  {project.description ? (
                    <span className="line-clamp-2 text-muted-foreground text-xs">
                      {project.description}
                    </span>
                  ) : null}
                  <span className="truncate text-muted-foreground text-xs">
                    {project.gameName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {describeEdits(project.edits)}
                    {when(project.updatedAt)
                      ? ` · changed ${when(project.updatedAt)}`
                      : ""}
                  </span>
                </Link>
                <div className="absolute top-1 right-1">
                  <ProjectCardMenu
                    project={project}
                    onRename={() => setRenamingId(project.id)}
                    onDuplicate={() => {
                      const copy = duplicateProject(project.id);
                      if (copy) setStatus(`Copied to "${copy.name}".`);
                    }}
                    onExport={() => void onExport(project)}
                    onCopyLink={() => onCopyLink(project)}
                    onDelete={() => {
                      removeProject(project.id);
                      forgetEditHistory(project.id);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TooltipProvider>
  );
}
