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
import { Button, Input, useDrawer, useSetting } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, Search, SlidersHorizontal, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  gameIdentityForName,
  type InstalledGameInfo,
} from "@/container/gameIdentity";
import {
  useScanTargetSelection,
  useUnitsyncGameHeaders,
  useUnitsyncScan,
} from "@/content/config";
import { EmptyState } from "@/content/pages/components/states";
import { importContainerFile } from "@/deeplink/bindings";
import { useImportParam } from "@/deeplink/useImportParam";
import { nextDrawerKey } from "@/general/drawerKey";
import { useRecordHubImport } from "@/hub/imports";
import { useCheckpoints } from "../checkpoints";
import { forgetEditHistory } from "../history";
import {
  describeEdits,
  gameGroupKey,
  type ModProject,
  type NewProject,
  parseModProjectJson,
  useModProjects,
} from "../project";
import { projectPath, unitEditPath } from "../routes";
import { DecodeTweakSetDrawer } from "./components/DecodeTweakSetDrawer";
import { ProjectCardMenu } from "./components/ProjectCardMenu";
import {
  type ProjectDetails,
  ProjectDetailsDrawer,
} from "./components/ProjectDetailsDrawer";
import { RandomModDrawer } from "./components/RandomModDrawer";

/** When a project was last written to, in words a person reads at a glance. */
function when(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString();
}

/** Where the chosen sort order is remembered, beside the project list itself. */
const SORT_KEY = "workshop.projectsSort";

type ProjectSort = "updated-desc" | "name-asc" | "created-desc";

const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: "updated-desc", label: "Last changed" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "created-desc", label: "Date created" },
];

function sortProjects(list: ModProject[], sort: ProjectSort): ModProject[] {
  const arr = [...list];
  switch (sort) {
    case "name-asc":
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "created-desc":
      arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    default:
      arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return arr;
}

interface ProjectGroup {
  key: string;
  /** The game's display name for the heading. A shortname alone ("BA") means
   *  little on its own, and an exact archive name ("Balanced Annihilation
   *  V15.9.8") reads as if the whole group were that one build when it holds
   *  several. So the heading is the modinfo `name` (no version) of whichever
   *  installed game answers to the group's key, read the same way the unit
   *  page's own game picker does. A game nobody has installed right now
   *  cannot be read that way, so the group falls back to the most recently
   *  changed project's exact `gameName` instead. */
  heading: string;
  projects: ModProject[];
}

/** Every project grouped by game, headed by name and ordered by it too. */
function groupProjects(
  projects: ModProject[],
  installed: readonly InstalledGameInfo[],
): ProjectGroup[] {
  const byKey = new Map<string, ModProject[]>();
  for (const project of projects) {
    const key = gameGroupKey(project);
    const list = byKey.get(key);
    if (list) list.push(project);
    else byKey.set(key, [project]);
  }
  const groups = [...byKey.entries()].map(([key, list]) => {
    const installedName = installed.find((g) => g.info?.shortname === key)?.info
      ?.name;
    const newest = [...list].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    )[0];
    return { key, heading: installedName || newest.gameName, projects: list };
  });
  groups.sort((a, b) => a.heading.localeCompare(b.heading));
  return groups;
}

export default function ProjectsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const games = useMemo(() => scan.data?.games ?? [], [scan.data]);
  const { headers: gameHeaders } = useUnitsyncGameHeaders(
    selected?.enginePath,
    selected?.rootPath,
  );
  const {
    projects,
    createProject,
    updateProjectDetails,
    duplicateProject,
    removeProject,
  } = useModProjects();
  const { forget: forgetCheckpoints } = useCheckpoints();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Whether the details drawer is up to start a project. */
  const [starting, setStarting] = useState(false);
  /** The project the details drawer is up to rename, if it is. */
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // The search box narrows the list as the person types, but is not itself
  // remembered: it is a one-off "find this project", not a standing view like
  // the sort order (issue #3071).
  const [search, setSearch] = useState("");
  // The sort order is remembered between visits, unlike the search text
  // above, because it is how someone has chosen to read their own list
  // rather than a query aimed at finding one project right now.
  const [sort, setSort] = useSetting<ProjectSort>(SORT_KEY, "updated-desc");

  // Grouped by game first, since that grouping does not depend on the search
  // text or the sort order. Sorting is safe here in a way it was not in the
  // drawer this replaces: nothing on this page writes an edit, so the list
  // cannot reorder itself under the cursor.
  const groups = useMemo(
    () => groupProjects(projects, games),
    [projects, games],
  );

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((group) => {
        const matching = q
          ? group.projects.filter(
              (p) =>
                p.name.toLowerCase().includes(q) ||
                (p.description ?? "").toLowerCase().includes(q) ||
                p.gameName.toLowerCase().includes(q),
            )
          : group.projects;
        return { ...group, projects: sortProjects(matching, sort) };
      })
      .filter((group) => group.projects.length > 0);
  }, [groups, search, sort]);

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
   * ask permission for beyond the deep-link confirmation it already passed. It
   * names the hub item it came from when the hub browse screen started it
   * (issue #1368), recorded once the project is actually saved rather than
   * before: an import that failed to save is not one the hub should count.
   */
  const { code: importCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();
  const importRef = useRef<(code: string, hubItemId?: string) => void>(
    () => {},
  );
  importRef.current = (code: string, hubItemId?: string) => {
    const imported = parseModProjectJson(code);
    if (!imported) {
      setError("That link is not a coilbox tweak project.");
      return;
    }
    setError(null);
    const project = createProject(imported);
    recordHubImport(hubItemId, [project.id], projectPath(project.id));
    navigate(projectPath(project.id));
  };
  useEffect(() => {
    if (importCode) importRef.current(importCode, hubItemId);
  }, [importCode, hubItemId]);

  /**
   * Share: a code, a link, a file or a publish to the Coilbox hub (issue
   * #2727). The drawer owns all four, through `ShareProjectForm`, and says so
   * when the project's copied units make it too big for a code. The scanned
   * games go with it only so the export can name the project's game by its
   * modinfo shortname as well as its archive name (issue #1335), the same
   * reason `ShareScenarioForm` takes them.
   */
  const drawer = useDrawer();
  const openShare = async (project: ModProject) => {
    const { ShareProjectForm } = await import("./components/ShareProjectForm");
    drawer.open({
      title: `Share ${project.name}`,
      width: "28rem",
      content: (
        <ShareProjectForm
          key={nextDrawerKey()}
          project={project}
          installed={games}
        />
      ),
    });
  };

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

  /**
   * What a decoded tweak set, or a randomised mod (issue #1318), turned into
   * is created and opened the same way an imported file is (issue #1280): a
   * project is a document rather than a setting, so there is nothing left to
   * ask once the drawer has a game and something to put in it.
   */
  function startFromInput(input: NewProject) {
    setError(null);
    navigate(projectPath(createProject(input).id));
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
              <DecodeTweakSetDrawer
                games={games}
                headers={gameHeaders}
                scanning={scan.loading}
                onStarted={startFromInput}
              />
              <RandomModDrawer
                games={games}
                headers={gameHeaders}
                scanning={scan.loading}
                projects={projects}
                enginePath={selected?.enginePath}
                dataDir={selected?.rootPath}
                onStarted={startFromInput}
              />
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
          headers={gameHeaders}
          scanning={scan.loading}
          existing={projects}
          onSubmit={saveDetails}
        />

        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {status ? (
          <p className="text-muted-foreground text-sm">{status}</p>
        ) : null}

        {projects.length === 0 ? (
          <EmptyState label="No tweak projects yet. Start one against a game, or import one somebody sent you." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative max-w-xs flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects…"
                  aria-label="Search projects"
                  className="h-9 pl-7"
                />
              </div>
              <OptionSelect
                value={sort}
                onValueChange={(v) => setSort(v as ProjectSort)}
                options={SORT_OPTIONS}
                ariaLabel="Sort projects"
                className="w-40"
              />
            </div>

            {visibleGroups.length === 0 ? (
              <EmptyState label={`No projects match "${search.trim()}".`} />
            ) : (
              visibleGroups.map((group) => (
                <section key={group.key} className="flex flex-col gap-2">
                  <h2 className="font-medium text-muted-foreground text-sm">
                    {group.heading}
                  </h2>
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3">
                    {group.projects.map((project) => (
                      // The card is the thing you open, so the whole of it is
                      // the link and it colours under the pointer rather than
                      // leaving the title to carry an underline on its own
                      // (issue #2706). The menu is a sibling of the link, not
                      // a child: a button inside a link is a link nobody can
                      // trust.
                      <li
                        key={project.id}
                        className="group relative rounded border border-border transition-colors hover:border-primary/40 hover:bg-accent/50"
                      >
                        {/* `h-full` because the grid stretches every card in
                            a row to the tallest of them, and without it a
                            card with no description ends short of its own
                            border: the strip below the text still hovered
                            but nothing happened when you clicked it (issue
                            #2718). The right-hand padding keeps the title
                            clear of the menu button without giving up the
                            pixels. */}
                        <Link
                          to={projectPath(project.id)}
                          className="flex h-full flex-col gap-1 p-3 pr-10"
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
                            onShare={() => void openShare(project)}
                            onDelete={() => {
                              removeProject(project.id);
                              forgetEditHistory(project.id);
                              forgetCheckpoints(project.id);
                            }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
