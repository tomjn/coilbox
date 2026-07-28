import { Button } from "@picoframe/frame";
import { Blocks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { legoThumbUrl } from "../../lib/assetUrl";
import { newProject } from "../model";
import { loadPack } from "../pack";
import { deleteProject, saveProject, useLegoProjects } from "../projects";

/**
 * The units you have built.
 *
 * Creating one needs the parts pack, because a project records which pack it
 * was built against. Without a pack there is nothing to build from, so the page
 * says so rather than making an empty unit that cannot be opened.
 */
export default function ProjectsPage() {
  const { projects, loading, error } = useLegoProjects();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

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

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await deleteProject(id);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <Blocks size={18} /> Units
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Units assembled from lego parts. Every part shares one texture, so a
            unit built here needs no UV work.
          </p>
        </div>
        <Button onClick={create} disabled={busy}>
          <Plus size={16} /> New unit
        </Button>
      </header>

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
          {projects.map((project) => (
            <li
              key={project.id}
              className="group relative rounded border border-border transition-colors hover:border-foreground/30"
            >
              <Link to={`/lego/${project.id}`} className="block">
                <img
                  src={legoThumbUrl(project.id)}
                  alt=""
                  className="aspect-square w-full rounded-t bg-muted object-cover"
                  // A unit saved before its first render has no thumbnail yet.
                  onError={(event) => {
                    event.currentTarget.style.visibility = "hidden";
                  }}
                />
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium">{project.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {project.pieces.length}{" "}
                    {project.pieces.length === 1 ? "piece" : "pieces"} ·{" "}
                    {project.unitName}
                  </p>
                </div>
              </Link>
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
          ))}
        </ul>
      )}
    </div>
  );
}
