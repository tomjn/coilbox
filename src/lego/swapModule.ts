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
 * Only the chosen instance changes, unless `symmetry` is on (issue #4318):
 *
 * - Mirror twin: the instance's twin is swapped in the same edit for the mirror
 *   of the new module, joined to the face that mirrors the first. The module
 *   goes in unreflected on the side that is not already reflected, so choosing
 *   either of a pair gives the same result. A twin that has gone, or is not in a
 *   module, leaves the swap as a single one.
 * - Ring (#3317): every member of the instance's ring is swapped for a copy of
 *   the new module where that member stood, and the new roots form the ring.
 *   Members turn rather than reflect, so the module goes in as it is.
 */

import * as THREE from "three";
import { presetById } from "./animPresets";
import { insertCompound, type PresetOutcome } from "./compounds";
import { pieceConnectors, resolveConnections, transformOf } from "./connectors";
import {
  followMirror,
  mirrorRole,
  pairPieces,
  withoutDanglingTwins,
} from "./mirror";
import { type LegoPiece, type LegoProject, pieceById } from "./model";
import { placeModule } from "./moduleMount";
import type { LoadedPack } from "./pack";
import { ringMembers } from "./ringSet";
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

/** The piece of a module instance that hangs from outside it. */
function instanceTop(project: LegoProject, pieceId: string) {
  const instance = pieceById(project, pieceId)?.module?.instance;
  if (instance === undefined) return undefined;
  const inside = project.pieces.filter((p) => p.module?.instance === instance);
  const ids = new Set(inside.map((p) => p.id));
  return inside.find((p) => !p.parentId || !ids.has(p.parentId));
}

/** The module as its mirror image would carry it: sided roles and weapon arcs
 *  swapped to the other side, as `mirrorPiece` does to a copy. */
function mirroredModule(module: LegoProject): LegoProject {
  return {
    ...module,
    pieces: module.pieces.map((piece) => {
      const roled = piece.role
        ? { ...piece, role: mirrorRole(piece.role) }
        : piece;
      return roled.weapon?.heading !== undefined
        ? {
            ...roled,
            weapon: { ...roled.weapon, heading: -roled.weapon.heading || 0 },
          }
        : roled;
    }),
  };
}

function reflected(piece: LegoPiece): boolean {
  return piece.scale[0] * piece.scale[1] * piece.scale[2] < 0;
}

function combined(
  first: SwapModuleResult,
  rest: SwapModuleResult[],
  project: LegoProject,
  pack: LoadedPack,
  original: LegoProject,
): SwapModuleResult {
  const all = [first, ...rest];
  const before = new Set(resolveConnections(original, pack).broken);
  const resolved = resolveConnections(project, pack);
  return {
    ...first,
    project: resolved.project,
    moved: all.flatMap((r) => r.moved),
    removedPresets: [...new Set(all.flatMap((r) => r.removedPresets))],
    broken: resolved.broken.filter((id) => !before.has(id)),
  };
}

/**
 * The project with the module instance `pieceId` belongs to swapped for
 * `module`, or null when the piece is in no instance or has no parent to hang
 * the new module from. With `symmetry`, the instance's mirror twin or ring goes
 * with it.
 */
export function swapModule(
  project: LegoProject,
  pack: LoadedPack,
  pieceId: string,
  module: LegoProject,
  newId: () => string,
  options: { symmetry?: boolean } = {},
): SwapModuleResult | null {
  const chosen = swapOne(project, pack, pieceId, module, newId);
  if (!chosen || !options.symmetry) return chosen;
  const top = instanceTop(project, pieceId);
  if (!top) return chosen;

  const members = ringMembers(project.pieces, top.id);
  if (members) {
    let current = chosen.project;
    const others: SwapModuleResult[] = [];
    const roots = [chosen.rootPieceIds[0]];
    for (const member of members.slice(1)) {
      const swapped = swapOne(current, pack, member, module, newId);
      if (!swapped) return chosen;
      current = swapped.project;
      others.push(swapped);
      roots.push(swapped.rootPieceIds[0]);
    }
    const next = new Map(
      roots.map((id, i) => [id, roots[(i + 1) % roots.length]]),
    );
    const linked: LegoProject = {
      ...current,
      pieces: current.pieces.map((piece) => {
        const after = next.get(piece.id);
        return after
          ? { ...piece, ring: { next: after, count: roots.length } }
          : piece;
      }),
    };
    return combined(chosen, others, linked, pack, project);
  }

  const twin = top.twin ? pieceById(project, top.twin) : undefined;
  const twinTop = twin ? instanceTop(project, twin.id) : undefined;
  if (!twinTop || twinTop.module?.instance === top.module?.instance) {
    return chosen;
  }
  // The module goes in as it is on the side that is not already a reflection,
  // and the other side follows it.
  const chosenLeads = !reflected(top) || reflected(twinTop);
  const leadId = chosenLeads ? top.id : twinTop.id;
  const followerId = chosenLeads ? twinTop.id : top.id;
  const lead = swapOne(project, pack, leadId, module, newId);
  if (!lead) return chosen;
  const follower = swapOne(
    lead.project,
    pack,
    followerId,
    mirroredModule(module),
    newId,
  );
  if (!follower) return chosen;
  const leadRoot = lead.rootPieceIds[0];
  const followerRoot = follower.rootPieceIds[0];
  const paired = pairPieces(
    followMirror(follower.project, leadRoot, followerRoot, pack),
    leadRoot,
    followerRoot,
  );
  const result = combined(lead, [follower], paired, pack, project);
  return {
    ...result,
    rootPieceIds: chosenLeads ? lead.rootPieceIds : follower.rootPieceIds,
    presets: lead.presets,
  };
}

function swapOne(
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
