/**
 * Session store for saved units and compounds.
 *
 * Same shape as `src/campaign/campaigns.ts`: a module-level cache so navigating
 * back to the overview does not re-read every document, and a listener set so a
 * save in the builder updates the overview without a round trip through the
 * router.
 *
 * Units and compounds are the same document in different folders, so one read
 * covers both and the builder never has to ask twice.
 */

import { useEffect, useState } from "react";

import { legoThumbUrl } from "../lib/assetUrl";
import { legoDelete, legoList, legoSave, legoThumbSave } from "./bindings";
import { type LegoProject, orderedPieces, parseLegoProjectJson } from "./model";

interface LegoStore {
  projects: LegoProject[];
  compounds: LegoProject[];
}

let cache: LegoStore | null = null;
const listeners = new Set<(store: LegoStore) => void>();

/** Read and parse every stored document, skipping any that will not load. */
async function fetchStore(): Promise<LegoStore> {
  const { projects, compounds } = await legoList({});
  const parse = (items: { id: string; json: string }[]) => {
    const loaded: LegoProject[] = [];
    for (const item of items) {
      const document = parseLegoProjectJson(item.json);
      if (document) {
        loaded.push(document);
      } else {
        // One unreadable document must not hide every other unit.
        console.warn("skipping a document that could not be read", item.id);
      }
    }
    return loaded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  };
  return { projects: parse(projects), compounds: parse(compounds) };
}

/** Re-read from disk and push the result to every mounted hook. */
export async function refreshProjects(): Promise<LegoStore> {
  const loaded = await fetchStore();
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
  const stamped = {
    ...project,
    pieces: orderedPieces(project),
    updatedAt: new Date().toISOString(),
  };
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

/** Save a reusable sub-assembly. Stored beside units, in its own folder. */
export async function saveCompound(
  compound: LegoProject,
): Promise<LegoProject> {
  const stamped = {
    ...compound,
    pieces: orderedPieces(compound),
    updatedAt: new Date().toISOString(),
  };
  await legoSave({
    kind: "compound",
    id: stamped.id,
    json: JSON.stringify(stamped),
  });
  await refreshProjects();
  return stamped;
}

export async function deleteCompound(id: string): Promise<void> {
  await legoDelete({ kind: "compound", id });
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

/**
 * Whether a unit already has a thumbnail on disk.
 *
 * One byte rather than the file: all this decides is whether a picture has to be
 * taken. Anything that goes wrong reading it counts as having one, so a unit is
 * never photographed over and over because the answer cannot be got at.
 */
export async function hasThumbnail(id: string): Promise<boolean> {
  try {
    const response = await fetch(legoThumbUrl(id), {
      headers: { Range: "bytes=0-0" },
    });
    return response.ok;
  } catch {
    return true;
  }
}

const EMPTY: LegoStore = { projects: [], compounds: [] };

/** Everything on disk, newest first. Stays in step with saves made elsewhere. */
function useLegoStore() {
  const [store, setStore] = useState<LegoStore>(cache ?? EMPTY);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = (loaded: LegoStore) => setStore(loaded);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (cache) {
      setStore(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchStore()
      .then((loaded) => {
        cache = loaded;
        if (!cancelled) {
          setStore(loaded);
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

  return { store, loading, error };
}

/** Every saved unit, newest first. */
export function useLegoProjects() {
  const { store, loading, error } = useLegoStore();
  return { projects: store.projects, loading, error };
}

/** Every saved sub-assembly, newest first. */
export function useLegoCompounds() {
  const { store, loading, error } = useLegoStore();
  return { compounds: store.compounds, loading, error };
}
