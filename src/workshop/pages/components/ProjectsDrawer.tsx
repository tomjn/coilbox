/**
 * The tweak project list: everything you do to a project rather than inside one
 * (issue #1282).
 *
 * A drawer rather than a page of its own. The projects belong to the unit page,
 * you come here to switch or to share and then go straight back, and a route
 * would unmount the page you were editing to show you a list of it.
 *
 * It reads the project list itself instead of taking it as a prop. The frame's
 * drawer keeps the element it was handed, so anything passed in is frozen at the
 * moment the drawer opened, and a list that stops updating as you rename and
 * delete in it is worse than no list. `useSetting` is reactive across
 * components, so reading it here keeps the drawer live while the page it was
 * opened from stays live too.
 */
import { Button, Input } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Copy,
  Download,
  FolderOpen,
  Link2,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { InstalledGameInfo } from "@/container/gameIdentity";
import { contentWriteFile } from "@/content/bindings";
import { importContainerFile } from "@/deeplink/bindings";
import { buildImportCodeLink } from "@/deeplink/build";
import { copyDeepLink } from "@/deeplink/copyLink";
import {
  describeEdits,
  type ModProject,
  modProjectCode,
  modProjectFileName,
  modProjectJson,
  parseModProjectJson,
  useModProjects,
} from "../../project";

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

export function ProjectsDrawer({
  openId,
  installed,
  onOpen,
  onDeleted,
}: {
  /** The project the page has open, so the list can say which one it is. */
  openId: string;
  /** The games this machine has, for the shortname a share carries. */
  installed: readonly InstalledGameInfo[];
  onOpen: (project: ModProject) => void;
  /** So the page can drop a deleted project's undo history. */
  onDeleted: (id: string) => void;
}) {
  const {
    projects,
    createProject,
    renameProject,
    duplicateProject,
    removeProject,
  } = useModProjects();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
        text: modProjectJson(project, installed),
      });
      setStatus(`Exported "${project.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function onCopyLink(project: ModProject) {
    setError(null);
    const result = modProjectCode(project, installed);
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
      const project = createProject(imported);
      setStatus(`Imported "${project.name}".`);
      onOpen(project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Every tweak project on this machine. A project is one game's edits
          under a name, saved as you work, and exportable as a file somebody
          else can open.
        </p>
        <Button size="sm" variant="outline" onClick={onImport}>
          <Upload className="mr-1 size-3.5" />
          Import
        </Button>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {status ? (
        <p className="text-muted-foreground text-xs">{status}</p>
      ) : null}

      {projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tweak projects yet. Change a unit and one is started for you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex flex-col gap-1.5 rounded border border-border/40 px-2 py-2"
            >
              <Input
                aria-label={`Name of ${project.name}`}
                defaultValue={project.name}
                // Committed on blur rather than per keystroke, so the list is
                // not rebuilt under the cursor mid-word. `defaultValue` for the
                // same reason: the input owns the text while it is being typed.
                onBlur={(e) => renameProject(project.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span className="text-muted-foreground text-xs">
                {project.gameName} · {describeEdits(project.edits)}
                {when(project.updatedAt) ? ` · ${when(project.updatedAt)}` : ""}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant={project.id === openId ? "secondary" : "outline"}
                  disabled={project.id === openId}
                  onClick={() => onOpen(project)}
                >
                  <FolderOpen className="mr-1 size-3.5" />
                  {project.id === openId ? "Open now" : "Open"}
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
                    onDeleted(project.id);
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
