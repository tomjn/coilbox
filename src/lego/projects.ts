/**
 * Session store for saved units and compounds, built on the shared
 * `documentStore` (issue #2440).
 *
 * Units and compounds are the same document in different folders, so one read
 * covers both and the builder never has to ask twice.
 */

import { legoThumbUrl } from "../lib/assetUrl";
import { createDocumentStore } from "../lib/documentStore";
import { legoDelete, legoList, legoSave, legoThumbSave } from "./bindings";
import { type LegoProject, orderedPieces, parseLegoProjectJson } from "./model";

interface LegoStore {
  projects: LegoProject[];
  compounds: LegoProject[];
}

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

const store = createDocumentStore<LegoStore>(fetchStore, {
  projects: [],
  compounds: [],
});

/** Re-read from disk and push the result to every mounted hook. */
export const refreshProjects = store.refresh;

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

/** Every saved unit, newest first. */
export function useLegoProjects() {
  const { data, loading, error } = store.useStore();
  return { projects: data.projects, loading, error };
}

/** Every saved sub-assembly, newest first. */
export function useLegoCompounds() {
  const { data, loading, error } = store.useStore();
  return { compounds: data.compounds, loading, error };
}
