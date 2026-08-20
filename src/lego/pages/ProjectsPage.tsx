import { Button, Input } from "@picoframe/frame";
import { Blocks, FileUp, ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageHeader } from "@/components/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { legoThumbUrl } from "../../lib/assetUrl";
import type { LegoAtlas } from "../atlas";
import { type LegoProject, newProject } from "../model";
import { loadPack } from "../pack";
import { validateProjectName } from "../projectNames";
import { deleteProject, saveProject, useLegoProjects } from "../projects";
import { ImportDrawer } from "./components/ImportDrawer";

/** The name field being edited, and why it cannot be saved yet, if at all. */
interface Renaming {
  id: string;
  draft: string;
  error: string | null;
}

/**
 * The units you have built.
 *
 * Creating one needs the parts pack, because a project records which pack it
 * was built against. Without a pack there is nothing to build from, so the page
 * says so rather than making an empty unit that cannot be opened.
 *
 * A unit is bound to one atlas, since that is all an s3o can name, so the atlas
 * is chosen here when there is more than one installed. It can still be changed
 * while editing: the parts are the same in every atlas, so switching costs
 * nothing.
 *
 * A unit can also come from a model file rather than being started empty. See
 * `ImportDrawer`, which covers both a project recovered from an export and a
 * model imported whole as raw geometry.
 */
export default function ProjectsPage() {
  const { projects, loading, error } = useLegoProjects();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [atlases, setAtlases] = useState<LegoAtlas[]>([]);
  const [atlas, setAtlas] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /** The units whose thumbnail would not load, so the card says so instead. */
  const [noPicture, setNoPicture] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  // Only to know whether there is a choice to offer. Creating a unit loads the
  // pack again, which is the same cached promise.
  useEffect(() => {
    let live = true;
    loadPack().then(
      (pack) => live && setAtlases(pack.library.atlases),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const pack = await loadPack();
      const project = newProject({
        id: crypto.randomUUID(),
        rootPieceId: crypto.randomUUID(),
        name: `Unit ${projects.length + 1}`,
        packId: pack.manifest.id,
        packVersion: pack.manifest.version,
        // Left off for the base pack's atlas, so a unit built with one atlas
        // installed is stored exactly as it always was.
        ...(atlas ? { atlas } : {}),
        now: new Date().toISOString(),
      });
      await saveProject(project);
      navigate(`/lego/${project.id}`);
    } catch (e) {
      setProblem(
        `Could not start a unit: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * A unit that came out of a model file, saved and opened like a new one.
   *
   * Either a project rebuilt from an export or a model imported whole. Both
   * arrive as an ordinary document, and an imported one already has its
   * geometry and its textures on disk.
   */
  async function opened(project: LegoProject) {
    setOpening(false);
    setProblem(null);
    try {
      await saveProject(project);
      navigate(`/lego/${project.id}`);
    } catch (e) {
      setProblem(
        `Could not save the unit: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await deleteProject(id);
  }

  function startRename(id: string, name: string) {
    setRenaming({ id, draft: name, error: null });
  }

  function cancelRename() {
    setRenaming(null);
  }

  /**
   * Enter and blur both land here. An empty or clashing name keeps the field
   * open with a reason rather than reverting, so a mistyped name does not
   * quietly vanish: the fix is to correct it or press Escape to give up.
   */
  function commitRename() {
    setRenaming((current) => {
      if (!current) return current;
      const error = validateProjectName(projects, current.id, current.draft);
      if (error) return { ...current, error };
      const trimmed = current.draft.trim();
      const project = projects.find((p) => p.id === current.id);
      if (project && trimmed !== project.name) {
        void saveProject({ ...project, name: trimmed });
      }
      return null;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="border-b border-border px-6 py-4"
        title={
          <>
            <Blocks size={18} /> Units
          </>
        }
        description="Units assembled from lego parts. Every part shares one texture, so a unit built here needs no UV work."
        actions={
          <>
            {/* Only when there is something to choose between. With one atlas
                installed a control with one option is noise. */}
            {atlases.length > 1 ? (
              <Select
                value={atlas ?? atlases[0].tex1}
                onValueChange={(value) =>
                  setAtlas(value === atlases[0].tex1 ? null : value)
                }
              >
                <SelectTrigger size="sm" className="w-52" aria-label="Atlas">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {atlases.map((option) => (
                    <SelectItem key={option.tex1} value={option.tex1}>
                      {option.packId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button variant="outline" onClick={() => setOpening(true)}>
              <FileUp size={16} /> Open a model
            </Button>
            <Button onClick={create} disabled={busy}>
              <Plus size={16} /> New unit
            </Button>
          </>
        }
      />

      <ImportDrawer
        open={opening}
        onOpenChange={setOpening}
        onOpened={(project) => void opened(project)}
      />

      {problem ? (
        <p className="border-b border-border px-6 py-3 text-sm text-muted-foreground">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p className="border-b border-border px-6 py-3 text-sm text-muted-foreground">
          Could not read your saved units: {error}
        </p>
      ) : null}

      {loading ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">
          Reading your saved units.
        </p>
      ) : projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Blocks className="text-muted-foreground" size={28} />
          <h2 className="text-base font-medium">No units yet</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Start one, then drop parts into it. Browse what is available under
            Lego Parts.
          </p>
          <Button onClick={create} disabled={busy}>
            <Plus size={16} /> New unit
          </Button>
        </div>
      ) : (
        <ul className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-4 overflow-y-auto p-6">
          {projects.map((project) => {
            const isRenaming = renaming?.id === project.id;
            return (
              <li
                key={project.id}
                className="group relative rounded border border-border transition-colors hover:border-foreground/30"
              >
                <Link to={`/lego/${project.id}`} className="block">
                  {noPicture.has(project.id) ? (
                    // Said rather than left blank: a unit gets its picture the
                    // first time it is drawn, so one with nothing to show has
                    // either never been opened or has nothing in it yet.
                    <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-t bg-muted px-3 text-center">
                      <ImageOff className="text-muted-foreground" size={20} />
                      <span className="text-xs text-muted-foreground">
                        No picture yet. Open it to make one.
                      </span>
                    </div>
                  ) : (
                    <img
                      src={legoThumbUrl(project.id)}
                      alt=""
                      className="aspect-square w-full rounded-t bg-muted object-cover"
                      onError={() =>
                        setNoPicture((known) => new Set(known).add(project.id))
                      }
                    />
                  )}
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium">
                      {isRenaming ? "" : project.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {isRenaming
                        ? ""
                        : `${project.pieces.length} ${
                            project.pieces.length === 1 ? "piece" : "pieces"
                          } · ${project.unitName}`}
                    </p>
                  </div>
                </Link>
                {isRenaming ? (
                  // A sibling of the Link, not a descendant, so a click here
                  // never bubbles into its navigation.
                  <div className="absolute inset-x-0 bottom-0 rounded-b bg-background px-3 py-2">
                    <Input
                      autoFocus
                      value={renaming.draft}
                      onChange={(event) =>
                        setRenaming({
                          id: project.id,
                          draft: event.target.value,
                          error: null,
                        })
                      }
                      onFocus={(event) => event.target.select()}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                      aria-label={`Rename ${project.name}`}
                      aria-invalid={renaming.error ? true : undefined}
                      className="h-6 text-sm"
                    />
                    {renaming.error ? (
                      <p className="mt-0.5 truncate text-xs text-destructive">
                        {renaming.error}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute left-1 top-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Rename ${project.name}`}
                  onClick={() => startRename(project.id, project.name)}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute right-1 top-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete ${project.name}`}
                  onClick={() => remove(project.id, project.name)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
