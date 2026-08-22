/**
 * Reading an imported unit's meshes and checking its textures are still there,
 * alongside the document.
 *
 * Keyed on the unit's id rather than on the document, because the document is a
 * fresh object on every edit and the geometry never changes with it: nothing in
 * the builder edits a raw mesh. A unit that was not imported has no sidecar and
 * loads nothing.
 *
 * A sidecar that will not load is reported rather than swallowed. It is the
 * only copy of the unit's geometry, so a unit silently drawn as an empty
 * hierarchy would look like the pieces had been lost.
 */

import { useEffect, useState } from "react";

import { legoTextureUrl } from "../lib/assetUrl";
import type { LegoProject } from "./model";
import {
  disposeRawGeometry,
  loadRawGeometry,
  type RawGeometry,
} from "./rawGeometry";

export interface RawGeometrySession {
  raw: RawGeometry | null;
  loading: boolean;
  /** Why the sidecar could not be read, as a sentence meant to be shown. */
  error: string | null;
  /**
   * Textures the document names that the store no longer holds, as sentences
   * meant to be shown.
   *
   * Without this the unit draws black and looks like a texture problem of its
   * own making. The store is shared, so a texture can go missing from under a
   * unit that has not been touched in weeks.
   */
  missingTextures: string[];
}

export function useRawGeometry(
  project: LegoProject | null,
): RawGeometrySession {
  const projectId = project?.imported ? project.id : null;
  const [state, setState] = useState<RawGeometrySession>({
    raw: null,
    loading: projectId !== null,
    error: null,
    missingTextures: [],
  });
  const [missingTextures, setMissingTextures] = useState<string[]>([]);
  // Taken apart rather than kept as one object, because `imported` is a fresh
  // object on every edit to the document and this depends only on the two keys
  // and what to call them.
  const textureKey = project?.imported?.texture?.key;
  const textureName = project?.imported?.texture?.name;
  const maskKey = project?.imported?.texture2?.key;
  const maskName = project?.imported?.texture2?.name;

  useEffect(() => {
    if (!projectId) {
      setState({ raw: null, loading: false, error: null, missingTextures: [] });
      return;
    }
    let live = true;
    let loaded: RawGeometry | null = null;
    setState({ raw: null, loading: true, error: null, missingTextures: [] });
    loadRawGeometry(projectId).then(
      (raw) => {
        if (!live) {
          disposeRawGeometry(raw);
          return;
        }
        loaded = raw;
        setState({ raw, loading: false, error: null, missingTextures: [] });
      },
      (error: unknown) => {
        if (!live) return;
        setState({
          raw: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          missingTextures: [],
        });
      },
    );
    return () => {
      live = false;
      if (loaded) disposeRawGeometry(loaded);
    };
  }, [projectId]);

  // Re-run whenever a key changes, which is every texture change and every
  // refresh, so a store swept out from under a unit is noticed rather than
  // drawn as a black model.
  useEffect(() => {
    let live = true;
    void checkTextures([
      { key: textureKey, name: textureName },
      { key: maskKey, name: maskName },
    ]).then((missing) => {
      if (live) setMissingTextures(missing);
    });
    return () => {
      live = false;
    };
  }, [textureKey, textureName, maskKey, maskName]);

  return { ...state, missingTextures };
}

/**
 * Which of a unit's textures the store no longer has.
 *
 * One byte each rather than a whole file: an imported texture can be a 64 MiB
 * DDS, and all this needs to know is whether the asset protocol will serve it.
 */
async function checkTextures(
  textures: { key: string | undefined; name: string | undefined }[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const texture of textures) {
    if (!texture.key) continue;
    let there = false;
    try {
      const response = await fetch(legoTextureUrl(texture.key), {
        headers: { Range: "bytes=0-0" },
      });
      there = response.ok;
    } catch {
      there = false;
    }
    if (!there) {
      missing.push(
        `${texture.name} is not in coilbox's texture store any more, so this unit draws without it. Point it at the file again to put it back.`,
      );
    }
  }
  return missing;
}
