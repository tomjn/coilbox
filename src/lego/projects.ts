/**
 * Session store for saved units.
 *
 * Same shape as `src/campaign/campaigns.ts`: a module-level cache so navigating
 * back to the overview does not re-read every document, and a listener set so a
 * save in the builder updates the overview without a round trip through the
 * router.
 */

import { useEffect, useState } from "react";

import { legoDelete, legoList, legoSave, legoThumbSave } from "./bindings";
import { type LegoProject, parseLegoProjectJson } from "./model";

let cache: LegoProject[] | null = null;
const listeners = new Set<(projects: LegoProject[]) => void>();

/** Read and parse every stored project, skipping any that will not load. */
async function fetchProjects(): Promise<LegoProject[]> {
  const { projects } = await legoList({});
  const loaded: LegoProject[] = [];
  for (const item of projects) {
    const project = parseLegoProjectJson(item.json);
    if (project) {
      loaded.push(project);
    } else {
      // One unreadable document must not hide every other unit.
      console.warn("skipping a unit that could not be read", item.id);
    }
  }
  return loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Re-read from disk and push the result to every mounted `useLegoProjects`. */
export async function refreshProjects(): Promise<LegoProject[]> {
  const loaded = await fetchProjects();
  cache = loaded;
  for (const listener of listeners) listener(loaded);
  return loaded;
}

/**
 * Save a project and refresh the shared list.
 *
 * `updatedAt` is stamped here rather than by callers, so a save cannot forget
 * it and the overview's ordering stays meaningful.
 */
export async function saveProject(project: LegoProject): Promise<LegoProject> {
  const stamped = { ...project, updatedAt: new Date().toISOString() };
  await legoSave({
    kind: "project",
    id: stamped.id,
    json: JSON.stringify(stamped),
  });
  await refreshProjects();
  return stamped;
}

export async function deleteProject(id: string): Promise<void> {
  await legoDelete({ kind: "project", id });
  await refreshProjects();
}

/**
 * Store a thumbnail for a project.
 *
 * The canvas is drawn into a fixed-size offscreen canvas first, so the file is
 * bounded whatever size the viewport happens to be, and Rust never has to
 * decode or resize anything.
 */
export async function saveThumbnail(
  id: string,
  source: HTMLCanvasElement,
): Promise<void> {
  const size = 320;
  const thumb = document.createElement("canvas");
  thumb.width = size;
  thumb.height = size;
  const context = thumb.getContext("2d");
  if (!context) return;

  // Cover the square from the middle of the viewport rather than squashing it.
  const side = Math.min(source.width, source.height);
  context.drawImage(
    source,
    (source.width - side) / 2,
    (source.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    thumb.toBlob(resolve, "image/png"),
  );
  if (!blob) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await legoThumbSave({ id, png: Array.from(bytes) });
}

/** Every saved unit, newest first. Stays in step with saves made elsewhere. */
export function useLegoProjects() {
  const [projects, setProjects] = useState<LegoProject[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = (loaded: LegoProject[]) => setProjects(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (cache) {
      setProjects(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchProjects()
      .then((loaded) => {
        cache = loaded;
        if (!cancelled) {
          setProjects(loaded);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, loading, error };
}
