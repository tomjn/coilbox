/**
 * Reading an imported unit's meshes and checking its textures are still there,
 * alongside the document.
 *
 * Keyed on the unit's id rather than on the document, because the document is a
 * fresh object on every edit and the geometry never changes with it: nothing in
 * the builder edits a raw mesh. A unit of parts has no sidecar and loads nothing
 * until a piece lifted from a game goes into it, and then the builder hands
 * over the geometry it wrote (`adopt`).
 *
 * A sidecar that will not load is reported rather than swallowed. It is the
 * only copy of the unit's geometry, so a unit silently drawn as an empty
 * hierarchy would look like the pieces had been lost.
 */

import { t } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";

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
  /**
   * Take geometry just written to this unit's sidecar as the unit's own,
   * rather than reading the file back (#3259).
   */
  adopt: (raw: RawGeometry) => void;
}

/**
 * Whether a unit draws any mesh out of a sidecar: an imported unit, or a unit
 * of parts holding a piece lifted from a game (#3259).
 */
function hasSidecar(project: LegoProject | null): boolean {
  if (!project) return false;
  return (
    project.imported !== undefined ||
    project.pieces.some((piece) => piece.meshId !== undefined)
  );
}

/** Every texture the unit names, once each, as one string to depend on. */
function namedTextures(project: LegoProject | null): string {
  const named = new Map<string, string>();
  for (const texture of [
    project?.imported?.texture,
    project?.imported?.texture2,
    ...(project?.pieces ?? []).flatMap((piece) => [
      piece.lifted?.texture,
      piece.lifted?.texture2,
    ]),
  ]) {
    if (texture?.key) named.set(texture.key, texture.name);
  }
  return JSON.stringify([...named]);
}

type Loaded = Omit<RawGeometrySession, "missingTextures" | "adopt">;

export function useRawGeometry(
  project: LegoProject | null,
): RawGeometrySession {
  const projectId = project && hasSidecar(project) ? project.id : null;
  const [state, setState] = useState<Loaded>({
    raw: null,
    loading: projectId !== null,
    error: null,
  });
  const [missingTextures, setMissingTextures] = useState<string[]>([]);
  // The geometry this unit holds and whose it is, so a sidecar adopted just
  // before the first lifted piece goes in is not read back a moment later.
  const held = useRef<{ id: string; raw: RawGeometry } | null>(null);
  // Taken apart rather than kept as one object, because the document is a
  // fresh object on every edit and this depends only on the keys and names.
  const textures = namedTextures(project);

  useEffect(() => {
    if (!projectId) {
      if (held.current) disposeRawGeometry(held.current.raw);
      held.current = null;
      setState({ raw: null, loading: false, error: null });
      return;
    }
    if (held.current?.id === projectId) {
      setState({ raw: held.current.raw, loading: false, error: null });
      return;
    }
    if (held.current) disposeRawGeometry(held.current.raw);
    held.current = null;
    let live = true;
    setState({ raw: null, loading: true, error: null });
    loadRawGeometry(projectId).then(
      (raw) => {
        // Geometry adopted while this was reading is newer than the file was.
        if (!live || held.current) {
          disposeRawGeometry(raw);
          return;
        }
        held.current = { id: projectId, raw };
        setState({ raw, loading: false, error: null });
      },
      (error: unknown) => {
        if (!live) return;
        setState({
          raw: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      live = false;
    };
  }, [projectId]);

  // Freed with the view.
  useEffect(
    () => () => {
      if (held.current) disposeRawGeometry(held.current.raw);
      held.current = null;
    },
    [],
  );

  const ownId = project?.id;
  const adopt = useCallback(
    (raw: RawGeometry) => {
      if (!ownId) return;
      if (held.current && held.current.raw !== raw)
        disposeRawGeometry(held.current.raw);
      held.current = { id: ownId, raw };
      setState({ raw, loading: false, error: null });
    },
    [ownId],
  );

  // Re-run whenever a key changes, which is every texture change and every
  // refresh, so a store swept out from under a unit is noticed rather than
  // drawn as a black model.
  useEffect(() => {
    let live = true;
    const named = JSON.parse(textures) as [string, string][];
    void checkTextures(named.map(([key, name]) => ({ key, name }))).then(
      (missing) => {
        if (live) setMissingTextures(missing);
      },
    );
    return () => {
      live = false;
    };
  }, [textures]);

  return { ...state, missingTextures, adopt };
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
      const textureName = texture.name ?? texture.key;
      missing.push(
        t`${textureName} is not in coilbox's texture store any more, so this unit draws without it. Point it at the file again to put it back.`,
      );
    }
  }
  return missing;
}
