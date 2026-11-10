/**
 * Reading a game's units for the skeleton scan (#5186), through unitsync and
 * the script sandbox: the reader `runSkeletonScan` is handed.
 *
 * Each unit's model is read for its piece tree only. An `.s3o` is read without
 * importing it, so nothing is written for it. A `.3do` or an Assimp model has
 * no read that gives offsets, so it is imported, and the startup sweep removes
 * its geometry file, which nothing names.
 *
 * Its script is read the way opening the unit reads it (`adoptGameScript`). A
 * compiled script is asked through its `.bos` converted to Lua, as the builder
 * asks it when proposing a plan for an open unit.
 */

import { t } from "@lingui/core/macro";
import type { ArchiveFileEntry } from "@/content/bindings";
import { adoptGameScript } from "./adoptGameScript";
import { type ImportedPiece, legoReadS3o, type S3oImport } from "./bindings";
import { modelSource, stageModel, type UnitsyncTarget } from "./gameImport";
import { importModel } from "./gameModelRead";
import type { S3oReadPiece } from "./importS3o";
import { inferRoles } from "./inferRoles";
import { projectFromImport } from "./rawImport";
import type { ScanDeps, ScanUnit, UnitRead } from "./skeletonScan";

/** An `.s3o` piece as the import reports one. Only the tree and the offsets
 *  are read, so no piece names a mesh. */
function asImported(piece: S3oReadPiece): ImportedPiece {
  return {
    name: piece.name,
    offset: piece.offset,
    meshId: null,
    children: piece.children.map(asImported),
  };
}

async function pieceTree(path: string): Promise<ImportedPiece> {
  if (/\.s3o$/i.test(path)) {
    return asImported((await legoReadS3o({ path })).root);
  }
  return (await importModel(path, crypto.randomUUID())).root;
}

const NO_TEXTURE = { key: null, name: "", source: null };

/** The reader for one game's units. */
export function skeletonScanDeps(input: {
  target: UnitsyncTarget;
  game: { name: string; archive: string };
  files: ArchiveFileEntry[];
  archivePath?: string;
}): ScanDeps {
  const { target, game, files, archivePath } = input;
  return {
    infer: inferRoles,
    async read(unit: ScanUnit): Promise<UnitRead> {
      if (!unit.member) {
        const name = unit.unit;
        throw new Error(t`${name} has no model coilbox can read.`);
      }
      const picked = {
        archive: game.archive,
        ...(archivePath ? { archivePath } : {}),
        member: unit.member,
      };
      const staged = await stageModel(target, picked, files);
      const root = await pieceTree(staged.path);
      const result: S3oImport = {
        radius: null,
        height: null,
        mid: null,
        root,
        texture: NO_TEXTURE,
        texture2: NO_TEXTURE,
        meshes: 0,
        vertices: 0,
        triangles: 0,
        converted: 0,
        bytes: 0,
      };
      const { project } = projectFromImport(result, {
        id: crypto.randomUUID(),
        source: modelSource(picked),
        game: {
          name: game.name,
          archive: game.archive,
          member: unit.member,
          unit: unit.unit,
        },
        unpacked: staged.staged !== null,
        name: unit.unit,
        unitName: unit.unit,
        packId: "",
        packVersion: "",
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
      });
      const adopted = await adoptGameScript(project, target, { infer: false });
      const name = unit.unit;
      const notes =
        adopted.script === null && adopted.notes.length === 0
          ? [t`${name} has only a compiled script, with no source to read.`]
          : adopted.notes;
      return {
        project: {
          ...project,
          gameScriptIncludes: adopted.includes,
          ...(adopted.unitDef ? { gameUnitDef: adopted.unitDef } : {}),
        },
        script: adopted.script,
        notes,
      };
    },
  };
}
