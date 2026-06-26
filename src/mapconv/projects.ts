import { useSetting } from "@picoframe/frame";
import type { CompileOpts } from "./bindings";

/**
 * Mapping projects: a persistent list of map folders the user has worked on.
 * The folder on disk (a `.sdd` directory archive, or a compile output folder)
 * is the source of truth — we store only lightweight metadata and the compile
 * options to reuse, and regenerate previews on demand from an image in/next to
 * the folder (no thumbnails are cached here). Decompiling or compiling upserts
 * an entry automatically; the Projects screen is the hub to revisit them.
 */

export type ProjectKind = "decompiled" | "compile";

export interface MapProject {
  /** Stable identity — the folder path (unique per project). */
  id: string;
  name: string;
  /** The map folder on disk (source of truth). */
  folderPath: string;
  kind: ProjectKind;
  /** Compile options to seed the Compile page with (remembered per folder). */
  compileOpts?: CompileOpts;
  /** Absolute path to an image to thumbnail (folder's texture, or source texture). */
  previewPath?: string;
  createdAt: string;
  lastUsedAt: string;
}

/** Fields a caller supplies; identity + timestamps are managed by the hook. */
export type ProjectInput = Pick<MapProject, "folderPath" | "name" | "kind"> &
  Partial<Pick<MapProject, "compileOpts" | "previewPath">>;

export function useMapProjects() {
  const [projects, setProjects] = useSetting<MapProject[]>(
    "mapconv.projects",
    [],
  );

  /** Add or update a project (keyed by folderPath), moving it to the front. */
  function upsertProject(input: ProjectInput) {
    const now = new Date().toISOString();
    const existing = projects.find((p) => p.folderPath === input.folderPath);
    const merged: MapProject = existing
      ? {
          ...existing,
          name: input.name,
          kind: input.kind,
          // Don't clobber a remembered value when the caller omits it.
          compileOpts: input.compileOpts ?? existing.compileOpts,
          previewPath: input.previewPath ?? existing.previewPath,
          lastUsedAt: now,
        }
      : {
          id: input.folderPath,
          name: input.name,
          folderPath: input.folderPath,
          kind: input.kind,
          compileOpts: input.compileOpts,
          previewPath: input.previewPath,
          createdAt: now,
          lastUsedAt: now,
        };
    setProjects([
      merged,
      ...projects.filter((p) => p.folderPath !== input.folderPath),
    ]);
  }

  function removeProject(id: string) {
    setProjects(projects.filter((p) => p.id !== id));
  }

  return { projects, upsertProject, removeProject };
}
