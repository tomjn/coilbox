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
 * A card says the three things that tell two projects apart: which game, how
 * much it changes and when it last changed. Not a picture. The unit builder's
 * list is pictures because a model is a shape, and a tweak project is a hundred
 * numbers spread over a game's units with no one unit standing for the rest.
 * Drawing a build picture for a project would also mean mounting every game's
 * archives to read one, which is the 23 second read the unit page spends once.
 *
 * Starting a project here records no checksum, because nothing has read the
 * game yet and the list must not wait 23 seconds to offer a button. The editor
 * fills it in the first time it opens the project against a game it can read.
 */
import { Button, Input } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  Download,
  Link2,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { PageHeader } from "@/components/PageHeader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  defaultProjectName,
  describeEdits,
  type ModProject,
  modProjectCode,
  modProjectFileName,
  modProjectJson,
  parseModProjectJson,
  useModProjects,
} from "../project";
import { projectPath, unitEditPath } from "../routes";

/**
 * Deleting a project throws away every edit in it and undo does not reach past
 * it, so it asks first. The same popover confirmation `CloneActions.tsx` uses,
 * for the same reason.
 */
function DeleteProjectButton({
  project,
  onDelete,
}: {
  project: ModProject;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Delete ${project.name}`}>
          <Trash2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium text-sm">Delete {project.name}?</h3>
          <p className="text-muted-foreground text-xs">
            {describeEdits(project.edits)}. Nothing puts it back, so export it
            first if you might want it.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
    renameProject,
    duplicateProject,
    removeProject,
  } = useModProjects();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** The project whose name is being typed over, and the text so far. */
  const [renaming, setRenaming] = useState<{
    id: string;
    draft: string;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const [newGame, setNewGame] = useState("");

  // Newest first, which is the order the editor's own "which project does this
  // game's link open" answer uses. Sorting is safe here in a way it was not in
  // the drawer this replaces: nothing on this page writes an edit, so the list
  // cannot reorder itself under the cursor.
  const listed = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects],
  );

  /** Start a project against a game, open it, and let the editor go from there. */
  function start(gameName: string) {
    const project = createProject({
      name: defaultProjectName(gameName, projects),
      gameName,
      game: gameIdentityForName(gameName, games) ?? undefined,
    });
    setStarting(false);
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

  /** Enter and blur both land here. An empty name is no name, so it is left
   *  alone rather than saved. */
  function commitRename() {
    setRenaming((current) => {
      if (current) renameProject(current.id, current.draft);
      return null;
    });
  }

  const newProjectButton = (
    <Popover open={starting} onOpenChange={setStarting}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 size-3.5" />
          New project
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <Field
          label="Game"
          hint="A project changes one game. Start another for a second game."
        >
          <OptionSelect
            size="sm"
            ariaLabel="Game for the new project"
            placeholder={scan.loading ? "Scanning…" : "Pick a game"}
            value={newGame}
            onValueChange={setNewGame}
            options={games.map((g) => ({ value: g.name, label: g.name }))}
          />
        </Field>
        {!scan.loading && games.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No games are installed. Add one from the Library.
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button size="sm" disabled={!newGame} onClick={() => start(newGame)}>
            Start editing
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
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
            <Button size="sm" variant="outline" onClick={onImport}>
              <Upload className="mr-1 size-3.5" />
              Import
            </Button>
            {newProjectButton}
          </>
        }
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
            <li
              key={project.id}
              className="flex flex-col gap-1 rounded border border-border p-3"
            >
              {renaming?.id === project.id ? (
                <Input
                  autoFocus
                  aria-label={`Name of ${project.name}`}
                  value={renaming.draft}
                  onChange={(e) =>
                    setRenaming({ id: project.id, draft: e.target.value })
                  }
                  onFocus={(e) => e.target.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") setRenaming(null);
                  }}
                  className="h-7"
                />
              ) : (
                <Link
                  to={projectPath(project.id)}
                  className="truncate font-medium text-sm hover:underline"
                >
                  {project.name}
                </Link>
              )}
              <span className="truncate text-muted-foreground text-xs">
                {project.gameName}
              </span>
              <span className="text-muted-foreground text-xs">
                {describeEdits(project.edits)}
                {when(project.updatedAt)
                  ? ` · changed ${when(project.updatedAt)}`
                  : ""}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Rename ${project.name}`}
                  onClick={() =>
                    setRenaming({ id: project.id, draft: project.name })
                  }
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const copy = duplicateProject(project.id);
                    if (copy) setStatus(`Copied to "${copy.name}".`);
                  }}
                  aria-label={`Duplicate ${project.name}`}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onExport(project)}
                  aria-label={`Export ${project.name}`}
                >
                  <Download className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onCopyLink(project)}
                  aria-label={`Copy a link to ${project.name}`}
                >
                  <Link2 className="size-3.5" />
                </Button>
                <DeleteProjectButton
                  project={project}
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
  );
}
