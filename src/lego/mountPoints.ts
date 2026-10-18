/**
 * Mount points: connectors of a chassis marked as places a module goes, with
 * the module categories that fit each (issue #3279).
 *
 * A mount point is stored on its piece (`LegoPiece.mountPoints`), naming one of
 * the piece's connectors. A module put on that connector must have a category
 * in the mount's list, and takes the active loadout's flag when the unit has
 * loadouts, so what sits on each mount is read per loadout.
 */

import { pieceConnectors } from "./connectors";
import {
  type LegoMountPoint,
  type LegoPiece,
  type LegoProject,
  pieceById,
} from "./model";
import type { LoadedPack } from "./pack";

function sameCategory(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The mount point on a connector of a piece, if one is marked there. */
export function mountPointAt(
  piece: LegoPiece | undefined,
  connector: string,
): LegoMountPoint | undefined {
  return piece?.mountPoints?.find((m) => m.connector === connector);
}

/** Whether a connector of the piece is a mount point. */
export function isMount(
  project: LegoProject,
  parentId: string,
  connector: string,
): boolean {
  return mountPointAt(pieceById(project, parentId), connector) !== undefined;
}

function withMounts(
  project: LegoProject,
  pieceId: string,
  change: (mounts: LegoMountPoint[]) => LegoMountPoint[],
): LegoProject {
  return {
    ...project,
    pieces: project.pieces.map((p) => {
      if (p.id !== pieceId) return p;
      const { mountPoints: _was, ...rest } = p;
      const next = change(p.mountPoints ?? []);
      return next.length > 0 ? { ...rest, mountPoints: next } : rest;
    }),
  };
}

/**
 * The project with a mount point marked on a connector of the piece. A
 * connector already marked, or a piece that has no such connector, leaves it
 * unchanged. The name defaults to "Mount 1", "Mount 2" and so on.
 */
export function markMountPoint(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  connector: string,
): LegoProject {
  const piece = pieceById(project, pieceId);
  if (!piece || mountPointAt(piece, connector)) return project;
  if (!pieceConnectors(pack, piece).some((c) => c.id === connector))
    return project;
  const taken = new Set((piece.mountPoints ?? []).map((m) => m.name));
  let n = (piece.mountPoints?.length ?? 0) + 1;
  while (taken.has(`Mount ${n}`)) n++;
  return withMounts(project, pieceId, (mounts) => [
    ...mounts,
    { connector, name: `Mount ${n}`, accepts: [] },
  ]);
}

/** The project with a mount point's name or categories changed. */
export function updateMountPoint(
  project: LegoProject,
  pieceId: string,
  connector: string,
  change: Partial<Pick<LegoMountPoint, "name" | "accepts">>,
): LegoProject {
  return withMounts(project, pieceId, (mounts) =>
    mounts.map((m) => (m.connector === connector ? { ...m, ...change } : m)),
  );
}

/** The project with the mark taken off. What sits on the connector stays. */
export function unmarkMountPoint(
  project: LegoProject,
  pieceId: string,
  connector: string,
): LegoProject {
  return withMounts(project, pieceId, (mounts) =>
    mounts.filter((m) => m.connector !== connector),
  );
}

/** Categories as typed in one field: comma separated, empty ones dropped. */
export function parseCategories(text: string): string[] {
  return text
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/**
 * Why `module` may not go on `connector` of the piece, or null when it may. A
 * connector that is not a mount point takes anything.
 */
export function mountRefusal(
  project: LegoProject,
  parentId: string,
  connector: string,
  module: LegoProject,
): string | null {
  const mount = mountPointAt(pieceById(project, parentId), connector);
  if (!mount) return null;
  if (mount.accepts.length === 0) return `${mount.name} takes no category yet.`;
  const category = module.category?.trim();
  if (category && mount.accepts.some((c) => sameCategory(c, category)))
    return null;
  return `${mount.name} takes ${mount.accepts.join(", ")} only.`;
}

/** Why a plain part may not go on the connector, or null when it may. */
export function mountPartRefusal(
  project: LegoProject,
  parentId: string,
  connector: string,
): string | null {
  const mount = mountPointAt(pieceById(project, parentId), connector);
  return mount ? `${mount.name} takes modules only.` : null;
}

/**
 * What sits on each mount point of a piece in the project as it is now: the
 * name of the piece joined there, or null for an empty mount. Under loadouts
 * this is the active loadout's. Switch first to read another.
 */
export function mountContents(
  project: LegoProject,
  piece: LegoPiece,
): { mount: LegoMountPoint; onIt: string | null }[] {
  return (piece.mountPoints ?? []).map((mount) => ({
    mount,
    onIt:
      project.pieces.find(
        (p) => p.parentId === piece.id && p.connection?.to === mount.connector,
      )?.name ?? null,
  }));
}
