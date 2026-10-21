/**
 * Saving a piece subtree for reuse, and dropping it into another unit.
 *
 * A compound is a project document holding the pieces that were lifted, kept in
 * its own folder. Same schema, so there is no second format to parse and
 * anything that reads a unit can read a compound.
 *
 * A compound made from a set of pieces holds several parentless pieces, one per
 * piece that was selected. That is what "no invented parent" means in practice:
 * two arms are two roots in the document, not one fabricated piece holding two,
 * which would show up in the piece tree and in the exported model. `rootPieceId`
 * names the first of them, so a document written this way still parses
 * everywhere. A unit is not allowed this, and `projectProblems` still says so.
 *
 * This is what replaces shipping prefab units. You build an assembly out of
 * pieces and save it, rather than taking one out of somebody else's game.
 */

import { t } from "@lingui/core/macro";
import * as THREE from "three";
import {
  type AppliedPreset,
  countRoles,
  presetById,
  presetUsesRole,
  unmetRequirements,
} from "./animPresets";
import { freePiece } from "./connectors";
import { copyInstanceSettings, moduleOwnSettings } from "./instanceSettings";
import {
  descendantIds,
  LEGO_SCHEMA_VERSION,
  type LegoModuleRef,
  type LegoPiece,
  type LegoProject,
  orderedPieces,
  pieceById,
  uniquePieceName,
} from "./model";
import { moduleStamp, pieceFingerprint } from "./moduleUpdates";
import { worldMatrix } from "./reparent";
import { withoutBrokenRings, withRingRemapped } from "./ringSet";

/**
 * The pieces of a selection a cutting is actually taken from.
 *
 * A piece selected alongside one of its own ancestors is already carried by that
 * ancestor, so lifting it as well would put it in the cutting twice. Unlike
 * `transformRoots`, the unit's own root piece stays: copying or saving a whole
 * unit is a real thing to want, where moving or deleting it is not.
 */
export function cuttingRoots(
  project: LegoProject,
  pieceIds: string[],
): string[] {
  const present = pieceIds.filter((id) => pieceById(project, id));
  const carried = new Set<string>();
  for (const id of present) {
    for (const child of descendantIds(project, id)) {
      if (child !== id) carried.add(child);
    }
  }
  return present.filter((id) => !carried.has(id));
}

/**
 * Copy a piece and everything under it into a compound.
 *
 * The subtree root loses its transform. A compound is defined by how its pieces
 * sit against each other, not by where the assembly happened to be in the unit
 * it was lifted from.
 */
export function subtreeAsCompound(
  project: LegoProject,
  pieceId: string,
  options: { id: string; now: string; newId: () => string },
): LegoProject | null {
  // For duplicate and mirror: the copy lands in the unit it came from, so what
  // the unit has applied is its own business, and a preset the maker removed
  // must not come back with a duplicate.
  return selectionAsCompound(project, [pieceId], options, false);
}

/**
 * Copy a whole selection, and everything under it, into one compound.
 *
 * The first piece of the selection anchors the set: it loses its transform, the
 * way a single lifted piece does, and every other root is placed against it. So
 * two pieces a metre apart are still a metre apart once the compound is dropped
 * back in, wherever it lands, and copying one piece is unchanged.
 */
export function selectionAsCompound(
  project: LegoProject,
  pieceIds: string[],
  options: { id: string; now: string; newId: () => string },
  carryPresets = true,
): LegoProject | null {
  const roots = cuttingRoots(project, pieceIds);
  const anchorId = roots[0];
  const anchor = anchorId ? pieceById(project, anchorId) : undefined;
  if (!anchorId || !anchor) return null;

  const frame = worldMatrix(project, anchorId).invert();
  const remap = new Map<string, string>();
  const pieces: LegoPiece[] = [];

  for (const rootId of roots) {
    // The anchor is zeroed rather than worked out from its own frame, which is
    // the identity but only to within rounding.
    const at =
      rootId === anchorId ? AT_ORIGIN : inFrame(project, frame, rootId);
    const ids = descendantIds(project, rootId);
    for (const id of ids) remap.set(id, options.newId());
    for (const id of ids) {
      // A compound has no skeleton, so a body plan's bone stays behind (#3246).
      const { bone: _bone, ...piece } = pieceById(project, id) as LegoPiece;
      // A root has no parent in the compound, so nothing to be joined to.
      pieces.push({
        ...(id === rootId ? freePiece(piece) : piece),
        id: remap.get(id) as string,
        parentId:
          id === rootId ? null : (remap.get(piece.parentId as string) ?? null),
        ...(id === rootId ? at : {}),
      });
    }
  }

  const presets = carryPresets ? presetsFor(project, pieces) : [];
  const copied = withLinksRemapped(pieces, remap);
  // The builder block describes a module only when a build preset came with it.
  const builder =
    project.builder && presets.some((entry) => isBuildPreset(entry.presetId))
      ? { builder: { ...project.builder } }
      : {};

  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.id,
    name: anchor.name,
    unitName: anchor.name,
    packId: project.packId,
    packVersion: project.packVersion,
    createdAt: options.now,
    updatedAt: options.now,
    rootPieceId: remap.get(anchorId) as string,
    pieces: copied,
    ...(presets.length > 0 ? { animations: presets } : {}),
    ...builder,
  };
}

/** `buildarm`, `build.aim`, `build.factory` and `build.nano`. */
function isBuildPreset(presetId: string): boolean {
  return presetId.startsWith("build");
}

/**
 * The unit's applied presets that belong to a set of pieces: those where a role
 * the preset animates, or needs, is carried by one of the pieces. Needs as well
 * as animates because `build.nano` moves nothing but cannot work without its
 * emit point. Parameters are copied.
 */
function presetsFor(
  project: LegoProject,
  pieces: { role?: string }[],
): AppliedPreset[] {
  const roles = new Set(
    pieces.flatMap((piece) => (piece.role ? [piece.role] : [])),
  );
  return (project.animations ?? []).flatMap((applied) => {
    const preset = presetById(applied.presetId);
    if (!preset) return [];
    const belongs = [...roles].some((role) => presetUsesRole(preset, role));
    return belongs
      ? [{ presetId: applied.presetId, params: { ...applied.params } }]
      : [];
  });
}

/** A preset a module carried that the unit could not take yet. */
export interface HeldPreset {
  presetId: string;
  params: Record<string, number>;
  /** The roles the unit still lacked. */
  missing: string[];
}

/** What inserting a module did about the presets it carried. */
export interface PresetOutcome {
  /** Added to the unit's animations. */
  added: string[];
  /** The unit already had these, so its own parameters stand. */
  present: string[];
  /** Not added, because the unit still lacks these roles after the insert. */
  held: HeldPreset[];
  /** The unit had no builder block and took the module's. */
  builderTaken: boolean;
}

/** The presets a module carries, added to a unit that has just received it. */
function mergePresets(
  project: LegoProject,
  module: LegoProject,
  newInstance?: string,
): { project: LegoProject; outcome: PresetOutcome } {
  const outcome: PresetOutcome = {
    added: [],
    present: [],
    held: [],
    builderTaken: false,
  };
  const applied = [...(project.animations ?? [])];
  const roles = countRoles(project.pieces);
  for (const entry of module.animations ?? []) {
    const preset = presetById(entry.presetId);
    if (!preset) continue;
    const haveAt = applied.findIndex(
      (have) => have.presetId === entry.presetId,
    );
    if (haveAt >= 0) {
      outcome.present.push(entry.presetId);
      // The unit's settings stand for the unit, and the module's own go to the
      // copy it brought, so they are not thrown away (#4315).
      const own = newInstance ? moduleOwnSettings(applied[haveAt], entry) : {};
      if (newInstance && Object.keys(own).length > 0) {
        const have = applied[haveAt];
        applied[haveAt] = {
          ...have,
          instances: { ...have.instances, [newInstance]: own },
        };
      }
      continue;
    }
    const missing = unmetRequirements(preset, roles);
    if (missing.length > 0) {
      outcome.held.push({
        presetId: entry.presetId,
        params: { ...entry.params },
        missing,
      });
      continue;
    }
    applied.push({ presetId: entry.presetId, params: { ...entry.params } });
    outcome.added.push(entry.presetId);
  }
  outcome.builderTaken = !project.builder && !!module.builder;
  return {
    outcome,
    project: {
      ...project,
      ...(applied.length > 0 ? { animations: applied } : {}),
      ...(outcome.builderTaken && module.builder
        ? { builder: { ...module.builder } }
        : {}),
    },
  };
}

/**
 * Held presets the unit can take now. A symmetry twin adds the other side's
 * roles after the insert, so the presets the insert held back are judged again
 * once the twin is there (issue #4316). Ones the unit still lacks roles for, or
 * already has, are left alone.
 */
export function adoptHeldPresets(
  project: LegoProject,
  held: HeldPreset[],
): LegoProject {
  const roles = countRoles(project.pieces);
  const applied = [...(project.animations ?? [])];
  for (const entry of held) {
    const preset = presetById(entry.presetId);
    if (!preset || applied.some((have) => have.presetId === entry.presetId))
      continue;
    if (unmetRequirements(preset, roles).length > 0) continue;
    applied.push({ presetId: entry.presetId, params: { ...entry.params } });
  }
  return applied.length === (project.animations ?? []).length
    ? project
    : { ...project, animations: applied };
}

/** One line for the user about what a module insert did with its presets. */
export function describePresets(outcome: PresetOutcome): string | null {
  const parts: string[] = [];
  const label = (id: string) => presetById(id)?.label ?? id;
  if (outcome.added.length > 0) {
    const added = outcome.added.map(label).join(", ");
    parts.push(t`Added ${added}.`);
  }
  if (outcome.present.length > 0) {
    const present = outcome.present.map(label).join(", ");
    parts.push(t`Already on the unit: ${present}.`);
  }
  for (const held of outcome.held) {
    const preset = label(held.presetId);
    const missing = held.missing.join(", ");
    parts.push(t`${preset} not added, the unit has no ${missing}.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

type Placement = Pick<LegoPiece, "position" | "rotation" | "scale">;

const AT_ORIGIN: Placement = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/** Where a lifted root sits against the first one, which is the set's origin. */
function inFrame(
  project: LegoProject,
  frame: THREE.Matrix4,
  pieceId: string,
): Placement {
  const local = frame.clone().multiply(worldMatrix(project, pieceId));
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  local.decompose(position, rotation, scale);
  const euler = new THREE.Euler().setFromQuaternion(rotation);
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
  };
}

/**
 * Whether `name` can replace the given compound's name, and why not if it
 * cannot.
 *
 * A compound's name is a free-text label, not a piece name, so it is not run
 * through `normalisePieceName`. It only has to be non-empty and not collide
 * with a sibling, because the grid tells compounds apart by name alone.
 */
export function validateCompoundName(
  compounds: LegoProject[],
  id: string,
  name: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return t`Name cannot be empty`;
  const clash = compounds.some(
    (compound) =>
      compound.id !== id &&
      compound.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) return t`Another module already has this name`;
  return null;
}

/**
 * Copied pieces with their twins (#3315) and rings (#3317) renamed to the
 * copies. A ring needs all of its members copied to still be one.
 */
function withLinksRemapped(
  pieces: LegoPiece[],
  remap: Map<string, string>,
): LegoPiece[] {
  return withoutBrokenRings(
    pieces.map((piece) =>
      withRingRemapped(withTwinRemapped(piece, remap), remap),
    ),
  );
}

/**
 * A copied piece with its twin (#3315) renamed to the copy of that twin, or with
 * the pairing dropped when the twin was not copied too. Left alone it would name
 * the original's partner, so moving the copy would move a stranger.
 */
function withTwinRemapped(
  piece: LegoPiece,
  remap: Map<string, string>,
): LegoPiece {
  if (piece.twin === undefined) return piece;
  const { twin, ...rest } = piece;
  const copy = remap.get(twin);
  return copy ? { ...rest, twin: copy } : rest;
}

/**
 * Add a compound's pieces to a unit, hanging off `parentId`.
 *
 * Names are made unique as they land, because a script addresses pieces by
 * name and two `barrel`s would be one piece too few. Every root of the compound
 * hangs off the same parent, keeping the spacing between them, and they come
 * back as `rootPieceIds` so the selection can land on all of them. `idMap` says
 * which new piece each of the compound's pieces became.
 *
 * The presets the compound carries join the unit's `animations`: one the unit
 * already has is left as it is, parameters and all, and one whose roles the unit
 * still lacks after the insert is held back and reported in `presets`. The
 * compound's `builder` block is taken only by a unit with none.
 *
 * `asModule` is for a module dropped in from the library: every piece it adds
 * records the module and one new instance shared by all of them. Otherwise the
 * compound is a copy, and its pieces keep the module they came from with a new
 * instance each instance, so a duplicated build arm is a second build arm. A
 * copy landing inside the instance it was copied from, such as a second barrel
 * pasted onto the same turret, stays in that instance. See `LegoModuleRef`.
 */
export function insertCompound(
  project: LegoProject,
  compound: LegoProject,
  parentId: string,
  newId: () => string,
  asModule = false,
): {
  project: LegoProject;
  rootPieceIds: string[];
  idMap: Map<string, string>;
  presets: PresetOutcome;
} {
  const parent = pieceById(project, parentId) ? parentId : project.rootPieceId;
  const taken = project.pieces.map((piece) => piece.name);
  const remap = new Map<string, string>();
  const rootPieceIds: string[] = [];
  const instanceOf = moduleInstances(
    pieceById(project, parent)?.module?.instance,
    newId,
  );
  // Made once the piece ids are, so a module insert hands out the same piece
  // ids as any other insert.
  let moduleRef: LegoModuleRef | undefined;
  const ownModule = () => {
    moduleRef ??= {
      id: compound.id,
      instance: newId(),
      rev: moduleStamp(compound),
    };
    return moduleRef;
  };

  // Depth first from the compound's root, then anything the walk did not reach,
  // which is how a compound made from a set carries its other roots. Either way
  // a piece's parent is remapped before the piece itself.
  const ids = orderedPieces(compound).map((piece) => [piece, newId()] as const);
  const added = ids.map(([piece, id]): LegoPiece => {
    remap.set(piece.id, id);
    const name = uniquePieceName(piece.name, taken);
    taken.push(name);
    const under =
      piece.id === compound.rootPieceId
        ? parent
        : (remap.get(piece.parentId as string) ?? parent);
    if (under === parent) rootPieceIds.push(id);
    // A piece landing here through duplicate, paste or a library drop is not
    // the piece a file shipped any more, so any preserved original name goes
    // with the piece it was lifted from rather than the copy: see
    // `LegoPiece.originalName` (#2613).
    // A piece landing on the new parent was joined, if at all, to something
    // else, so it lands free. Joins inside the compound come along.
    // A copy of a body plan's bone is a free piece, or a proportion would move
    // the copy onto the original (#3246).
    const {
      originalName: _dropped,
      bone: _copied,
      module: from,
      ...rest
    } = under === parent ? freePiece(piece) : piece;
    const placed: LegoPiece = {
      ...rest,
      id,
      name,
      parentId: under,
    };
    const module = asModule
      ? {
          ...ownModule(),
          fp: pieceFingerprint(placed, under === parent),
        }
      : from
        ? { ...from, instance: instanceOf(from.instance) }
        : undefined;
    return { ...placed, ...(module ? { module } : {}) };
  });

  // Presets are judged against the unit as it is after the insert, so a module
  // that completes what a preset needs brings it in.
  const merged = mergePresets(
    {
      ...project,
      pieces: [...project.pieces, ...withLinksRemapped(added, remap)],
    },
    compound,
    (moduleRef as LegoModuleRef | undefined)?.instance,
  );
  // A copy of an instance starts with the settings of the one it was copied
  // from (#4315). A module dropped from the library has none to copy.
  const copied = asModule
    ? new Map<string, string>()
    : new Map(
        ids.flatMap(([piece], i) => {
          const was = piece.module?.instance;
          const now = added[i].module?.instance;
          return was && now && was !== now ? [[was, now] as const] : [];
        }),
      );
  const carried = [...copied].reduce(
    (current, [was, now]) => copyInstanceSettings(current, was, now),
    merged.project,
  );
  return {
    project: carried,
    rootPieceIds,
    idMap: remap,
    presets: merged.outcome,
  };
}

/**
 * The instance a copied piece takes, given the one it was copied from: a new
 * one for each instance copied, or the same one when the copy lands on a piece
 * of that instance.
 */
function moduleInstances(
  parentInstance: string | undefined,
  newId: () => string,
): (instance: string) => string {
  const fresh = new Map<string, string>();
  return (instance) => {
    if (instance === parentInstance) return instance;
    const known = fresh.get(instance);
    if (known) return known;
    const made = newId();
    fresh.set(instance, made);
    return made;
  };
}

/**
 * Insert a compound, then put back the transform lifting it dropped, and the
 * join when one is given.
 *
 * `subtreeAsCompound` resets the root's position, rotation and scale so a
 * compound can be placed anywhere, which is right for something pulled from the
 * library but wrong for an operation that means "this piece, again": duplicate
 * and mirror-as-copy both want the copy to land where the source already sits,
 * not at its parent's origin. Shared so the two do not grow their own answers to
 * the same question.
 *
 * A duplicate lands in the same place under the same parent as its source, so
 * it keeps the source's join too (issue #3309).
 */
export function insertCompoundAt(
  project: LegoProject,
  compound: LegoProject,
  parentId: string,
  transform: Placement & Pick<LegoPiece, "connection">,
  newId: () => string,
): { project: LegoProject; rootPieceId: string } {
  const inserted = insertCompound(project, compound, parentId, newId);
  // The first root, because the callers are duplicate and mirror and both hand
  // over one piece's transform to put back.
  const rootPieceId = inserted.rootPieceIds[0] as string;
  return {
    project: {
      ...inserted.project,
      pieces: inserted.project.pieces.map((piece) =>
        piece.id === rootPieceId ? { ...piece, ...transform } : piece,
      ),
    },
    rootPieceId,
  };
}

/**
 * A copy of a piece and its subtree, alongside the original and in the same
 * place, or null when the piece is not there.
 *
 * Lifting drops the subtree root's transform and join, which is right for
 * something bound for the library but not for a copy that is meant to sit
 * exactly where the original does until it is dragged elsewhere. Both are put
 * back, so a joined piece's copy is joined to the same face.
 */
export function duplicatePiece(
  project: LegoProject,
  pieceId: string,
  options: { now: string; newId: () => string },
): { project: LegoProject; rootPieceId: string } | null {
  const source = pieceById(project, pieceId);
  const cutting = subtreeAsCompound(project, pieceId, {
    id: options.newId(),
    ...options,
  });
  if (!source || !cutting) return null;
  // Alongside the original rather than inside it, which is what duplicate
  // means everywhere else.
  const parentId = source.parentId ?? project.rootPieceId;
  return insertCompoundAt(
    project,
    cutting,
    parentId,
    {
      position: source.position,
      rotation: source.rotation,
      scale: source.scale,
      ...(source.connection ? { connection: source.connection } : {}),
    },
    options.newId,
  );
}
