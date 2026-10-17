/**
 * Swapping a module in a unit for another, in place (issue #3303).
 *
 * The instance's pieces are removed and the new module's put where the old
 * root was:
 *
 * - Joined root: the new module joins the same face of the same parent by its
 *   own mount (`placeModule`), turned the same number of quarter turns. A mount
 *   deeper in the module moves the whole module instead, as it does on insert.
 * - Free root, or a join that cannot be made: the new root takes the old root's
 *   parent and local transform.
 * - Pieces under the old instance that are not part of it stay in the unit.
 *   Each moves to the new piece with the role of the piece it hung from, or
 *   under the new root when there is none, and `moved` names those. A join
 *   through the old piece follows the rule in `swapPart.ts`.
 * - Presets: the new module's are merged as an insert does. A preset whose
 *   roles the old pieces carried and no piece carries now is removed, and
 *   `removedPresets` names it. One the new module also uses keeps the unit's
 *   parameters.
 * - The new pieces share an instance of their own that records the new module.
 *
 * Only the chosen instance changes. Its mirror twin is an instance of its own
 * and is left as it is.
 */

import * as THREE from "three";
import { presetById } from "./animPresets";
import { insertCompound, type PresetOutcome } from "./compounds";
import { pieceConnectors, resolveConnections, transformOf } from "./connectors";
import { withoutDanglingTwins } from "./mirror";
import { type LegoPiece, type LegoProject, pieceById } from "./model";
import { placeModule } from "./moduleMount";
import type { LoadedPack } from "./pack";
import { carriedId } from "./swapPart";

export interface SwapModuleResult {
  project: LegoProject;
  /** The new module's root pieces. */
  rootPieceIds: string[];
  /** Names of kept pieces that found no piece with their parent's role. */
  moved: string[];
  /** Presets removed because no piece uses them any more. */
  removedPresets: string[];
  /** What merging the new module's presets did. */
  presets: PresetOutcome;
  /** Pieces whose join this swap left unable to be made. */
  broken: string[];
}

const QUARTER = Math.PI / 2;

function presetRoles(presetId: string): string[] {
  const preset = presetById(presetId);
  if (!preset) return [];
  return [...preset.animates, ...preset.requires.map((need) => need.role)];
}

/**
 * The project with the module instance `pieceId` belongs to swapped for
 * `module`, or null when the piece is in no instance or has no parent to hang
 * the new module from.
 */
export function swapModule(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  module: LegoProject,
  newId: () => string,
): SwapModuleResult | null {
  const chosen = pieceById(project, pieceId);
  const ref = chosen?.module;
  if (!ref) return null;
  const old = project.pieces.filter((p) => p.module?.instance === ref.instance);
  const oldIds = new Set(old.map((p) => p.id));
  const top = old.find((p) => !p.parentId || !oldIds.has(p.parentId));
  const parentId = top?.parentId;
  if (!top || !parentId || !pieceById(project, parentId)) return null;

  // What is kept: pieces hanging off the instance that are not part of it.
  const kept = project.pieces.filter(
    (p) => !oldIds.has(p.id) && p.parentId && oldIds.has(p.parentId),
  );
  const oldRoles = new Set(old.flatMap((p) => (p.role ? [p.role] : [])));
  const without: LegoProject = withoutDanglingTwins({
    ...project,
    pieces: project.pieces.filter((p) => !oldIds.has(p.id)),
  });

  const join = top.connection;
  const quarters = join ? Math.round((join.twist ?? 0) / QUARTER) : 0;
  const placed = join
    ? placeModule(
        without,
        module,
        pack,
        { parentId, to: join.to },
        { cycle: 0, twist: quarters },
        newId,
      )
    : null;
  const inserted =
    placed ?? insertCompound(without, module, parentId, newId, true);
  const anchorId = inserted.rootPieceIds[0];

  const fresh = new Set(inserted.idMap.values());
  const own = new THREE.Matrix4().compose(
    new THREE.Vector3(...top.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...top.rotation)),
    new THREE.Vector3(...top.scale),
  );
  const roots = new Set(inserted.rootPieceIds);
  const moved: string[] = [];
  const pieces = inserted.project.pieces.map((p): LegoPiece => {
    if (!placed && roots.has(p.id)) {
      // Not joined, so the module lands where the old root sat. Further roots
      // keep their spacing from the first.
      if (p.id === anchorId) {
        return {
          ...p,
          position: top.position,
          rotation: top.rotation,
          scale: top.scale,
        };
      }
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(...p.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation)),
        new THREE.Vector3(...p.scale),
      );
      return { ...p, ...transformOf(own.clone().multiply(local)) };
    }
    const was = kept.find((k) => k.id === p.id);
    if (!was) return p;
    const hungFrom = pieceById(project, was.parentId as string) as LegoPiece;
    const role = hungFrom.role;
    const match = role
      ? inserted.project.pieces.find((q) => fresh.has(q.id) && q.role === role)
      : undefined;
    const target = match ?? pieceById(inserted.project, anchorId);
    if (!target) return p;
    if (!match) moved.push(was.name);
    return {
      ...p,
      parentId: target.id,
      ...(p.connection
        ? {
            connection: {
              ...p.connection,
              to: carriedId(
                p.connection.to,
                pieceConnectors(pack, hungFrom),
                pieceConnectors(pack, target),
              ),
            },
          }
        : {}),
    };
  });

  const merged = { ...inserted.project, pieces };
  const removedPresets = (merged.animations ?? [])
    .map((applied) => applied.presetId)
    .filter((id) => {
      const roles = presetRoles(id);
      return (
        roles.some((role) => oldRoles.has(role)) &&
        !merged.pieces.some((p) => p.role && roles.includes(p.role))
      );
    });
  const { animations, ...bare } = merged;
  const left = (animations ?? []).filter(
    (applied) => !removedPresets.includes(applied.presetId),
  );
  const cleaned: LegoProject = {
    ...bare,
    ...(left.length > 0 ? { animations: left } : {}),
  };

  const before = new Set(resolveConnections(project, pack).broken);
  const resolved = resolveConnections(cleaned, pack);
  return {
    project: resolved.project,
    rootPieceIds: inserted.rootPieceIds,
    moved,
    removedPresets,
    presets: {
      ...inserted.presets,
      present: inserted.presets.present.filter(
        (id) => !removedPresets.includes(id),
      ),
    },
    broken: resolved.broken.filter((id) => !before.has(id)),
  };
}
