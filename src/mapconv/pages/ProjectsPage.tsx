import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderInput,
  FolderOpen,
  Hammer,
  ImageOff,
  LayoutGrid,
  Loader2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { mcOpenPath } from "../bindings";
import { getImageInfo } from "../imageCache";
import { type MapProject, useMapProjects } from "../projects";

/** The last path segment (handles both / and \ separators). */
function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * Mapping projects hub: a gallery of map folders the user has decompiled or
 * compiled. Previews are regenerated on demand from an image in/next to each
 * folder (via `mcImageInfo`) — nothing is cached here, the folder is the source
 * of truth. Cards link back to the Compile page (seeding remembered options)
 * and out to the file manager.
 */
export default function ProjectsPage() {
  const { projects, upsertProject, removeProject } = useMapProjects();
  const navigate = useNavigate();

  async function importFolder() {
    const picked = await open({
      title: "Import a .sdd map folder",
      directory: true,
      multiple: false,
    });
    if (typeof picked !== "string") return;
    upsertProject({
      folderPath: picked,
      name: basename(picked),
      kind: "decompiled",
      previewPath: joinPath(picked, "texture.png"),
    });
  }

  function openInCompile(p: MapProject) {
    // Compile projects seed the full form from remembered options; decompiled
    // folders reuse the Decompile→Recompile path (seed texture from the folder).
    if (p.kind === "compile" && p.compileOpts) {
      navigate("/mapconv", {
        state: { seedOpts: p.compileOpts, seedOutDir: p.folderPath },
      });
    } else {
      navigate("/mapconv", { state: { recompileDir: p.folderPath } });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <LayoutGrid size={18} /> Projects
          </h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Maps you've decompiled or compiled. Open one to recompile with its
            remembered options, or reveal its folder. Decompiling extracts to a{" "}
            <code>.sdd</code> directory the engine can load directly.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={importFolder}>
          <FolderInput /> Import .sdd folder…
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        {projects.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <LayoutGrid size={28} className="opacity-30" />
            <p>No projects yet.</p>
            <p className="max-w-xs text-xs">
              Decompile or compile a map and it'll appear here, or import an
              existing <code>.sdd</code> folder.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li
                key={p.id}
                className="flex flex-col overflow-hidden rounded-md border border-border bg-card/50 transition-colors hover:bg-accent/30"
              >
                <ProjectThumb path={p.previewPath} name={p.name} />
                <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                  <div className="flex items-center gap-2">
                    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {p.name}
                    </h2>
                    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {p.kind === "compile" ? "compile" : "decompiled"}
                    </span>
                  </div>
                  <p
                    className="truncate font-mono text-xs text-muted-foreground"
                    title={p.folderPath}
                  >
                    {p.folderPath}
                  </p>
                  {/* Actions row — append future actions (edit mapinfo, test run) here. */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openInCompile(p)}
                    >
                      <Hammer /> Compile
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        mcOpenPath({ path: p.folderPath }).catch(() => {})
                      }
                    >
                      <FolderOpen /> Folder
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeProject(p.id)}
                      aria-label={`Remove ${p.name} from projects`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Join a directory and filename using the directory's native separator. */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${name}`;
}

/** A project's preview thumbnail, regenerated on demand from its folder image. */
function ProjectThumb({ path, name }: { path?: string; name: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setThumb(null);
    setFailed(false);
    if (!path) {
      setFailed(true);
      return;
    }
    getImageInfo(path, 320)
      .then((info) => {
        if (active) setThumb(info.thumb);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (thumb) {
    return (
      <img
        src={thumb}
        alt={`${name} preview`}
        className="h-32 w-full border-b border-border object-cover"
      />
    );
  }
  return (
    <div className="flex h-32 w-full items-center justify-center border-b border-border bg-muted/30 text-muted-foreground">
      {failed ? (
        <ImageOff size={24} className="opacity-40" />
      ) : (
        <Loader2 size={20} className="animate-spin opacity-40" />
      )}
    </div>
  );
}
