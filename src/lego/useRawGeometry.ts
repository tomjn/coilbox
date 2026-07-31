/**
 * Reading an imported unit's meshes once, alongside the document.
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
}

export function useRawGeometry(
  project: LegoProject | null,
): RawGeometrySession {
  const projectId = project?.imported ? project.id : null;
  const [state, setState] = useState<RawGeometrySession>({
    raw: null,
    loading: projectId !== null,
    error: null,
  });

  useEffect(() => {
    if (!projectId) {
      setState({ raw: null, loading: false, error: null });
      return;
    }
    let live = true;
    let loaded: RawGeometry | null = null;
    setState({ raw: null, loading: true, error: null });
    loadRawGeometry(projectId).then(
      (raw) => {
        if (!live) {
          disposeRawGeometry(raw);
          return;
        }
        loaded = raw;
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
      if (loaded) disposeRawGeometry(loaded);
    };
  }, [projectId]);

  return state;
}
