/**
 * A module as a share code, the form the hub and a `coilbox://` link carry
 * (#3272). The payload is the module document itself.
 *
 * A module of parts and empty pieces can be shared, and so can one holding
 * meshes imported from the game maker's own model file (#4360). Those meshes
 * travel in the payload's `geometry`, the module's geometry file cut down to
 * the meshes its pieces name, base64url encoded and not compressed: the code
 * deflates the whole container, so the one 512 KB ceiling on what a code may
 * inflate to bounds the meshes too, with no second inflate to guard. Geometry
 * lifted from a game is never shared. The rule and its words are
 * `moduleGeometryRefusal` in the container code, which the hub vendors, so the
 * app and the hub refuse the same modules. A module saved to a file is not
 * covered: that is `moduleFile.ts`, and it never goes through the hub.
 */

import { t } from "@lingui/core/macro";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeContainerText,
  moduleGeometryRefusal,
  readContainer,
  tryEncodeContainerCode,
} from "@/container/container";
import { type LegoProject, parseLegoProjectData } from "./model";
import { resolveLoad } from "./moduleFile";
import {
  encodeRawGeometry,
  mergeRawGeometry,
  parseRawGeometry,
  type RawGeometry,
  rawMeshFits,
} from "./rawGeometry";

/** Payload schema version for `kind: "module"`. */
export const MODULE_KIND_VERSION = 1;

export type ModuleShareCode =
  | { ok: true; code: string }
  | { ok: false; reason: string };

/** Every mesh key the module's pieces name, each mapped to itself. */
function meshKeys(module: LegoProject): Map<string, string> {
  const keys = new Map<string, string>();
  for (const piece of module.pieces) {
    if (piece.meshId) keys.set(piece.meshId, piece.meshId);
  }
  return keys;
}

/**
 * The payload a code carries: the module, with the meshes its pieces name when
 * every one of them is the game maker's own and `raw` holds them all. Anything
 * else goes without, and `moduleGeometryRefusal` says why.
 */
export function moduleSharePayload(
  module: LegoProject,
  raw: RawGeometry | null,
): LegoProject & { geometry?: string } {
  const keys = meshKeys(module);
  if (keys.size === 0 || !raw) return module;
  if (module.pieces.some((piece) => piece.meshId && !piece.ownMesh))
    return module;
  const named = mergeRawGeometry(null, raw, keys);
  if (named.byId.size < keys.size) return module;
  return { ...module, geometry: bytesToBase64Url(encodeRawGeometry(named)) };
}

/**
 * The module's share code, or why it cannot have one. `raw` is the module's
 * own geometry file, or null when it has none.
 */
export function moduleShareCode(
  module: LegoProject,
  raw: RawGeometry | null,
): ModuleShareCode {
  const payload = moduleSharePayload(module, raw);
  const refused = moduleGeometryRefusal(payload);
  if (refused) return { ok: false, reason: refused };
  const made = tryEncodeContainerCode("module", MODULE_KIND_VERSION, payload);
  if (made.ok) return made;
  const size = Math.round(made.bytes / 1024);
  const limit = Math.round(made.limit / 1024);
  return {
    ok: false,
    reason: t`This module is ${size} KB, over the ${limit} KB a code can carry.`,
  };
}

export type SharedModule =
  | {
      ok: true;
      project: LegoProject;
      missingParts: string[];
      /** The meshes the pieces name, to write as the module's geometry file
       *  before the module itself. Null for a module with no meshes. */
      geometry: RawGeometry | null;
    }
  | { ok: false; reason: string };

/**
 * The meshes a shared payload carries for `project`, cut down to the ones its
 * pieces name. Null when it names none, and `false` when the payload does not
 * hold every one of them intact. The payload came from outside the app, so
 * every mesh is checked to stay inside the arrays before anything draws it.
 */
function sharedGeometry(
  project: LegoProject,
  value: unknown,
): RawGeometry | null | false {
  const keys = meshKeys(project);
  if (keys.size === 0) return null;
  if (typeof value !== "string") return false;
  let raw: RawGeometry;
  try {
    raw = parseRawGeometry(base64UrlToBytes(value));
  } catch {
    return false;
  }
  for (const key of keys.keys()) {
    const mesh = raw.byId.get(key);
    if (!mesh || !rawMeshFits(raw, mesh)) return false;
  }
  return mergeRawGeometry(null, raw, keys);
}

/**
 * Read a shared module code. A module holding game geometry, or meshes with no
 * record of being the maker's own, is refused here too, so a code from
 * anywhere cannot carry a lifted piece into a unit. `knownPartIds` is the
 * loaded pack's, to list pieces whose part it lacks.
 */
export function readSharedModule(
  code: string,
  knownPartIds: ReadonlySet<string>,
): SharedModule {
  const value = decodeContainerText(code);
  let held = false;
  const found: { geometry: RawGeometry | null | false } = { geometry: null };
  const read = readContainer(value, "module", (payload) => {
    held = moduleGeometryRefusal(payload) !== null;
    if (held) return null;
    const project = parseLegoProjectData(payload);
    if (!project) return null;
    found.geometry = sharedGeometry(
      project,
      (payload as { geometry?: unknown }).geometry,
    );
    return project;
  });
  if (held) {
    return {
      ok: false,
      reason: t`This module holds geometry from a game, or meshes with no record that they are the maker's own, which a shared module cannot carry.`,
    };
  }
  const { geometry } = found;
  if (geometry === false) {
    return {
      ok: false,
      reason: t`The meshes in this module could not be read.`,
    };
  }
  if (!read.ok) {
    return {
      ok: false,
      reason:
        read.error === "unsupported-version"
          ? t`This module was made by a newer version of coilbox.`
          : t`That is not a coilbox module.`,
    };
  }
  const project = read.payload;
  const missingParts = project.pieces
    .filter((piece) => piece.partId !== null && !knownPartIds.has(piece.partId))
    .map((piece) => piece.name);
  return { ok: true, project, missingParts, geometry };
}

/**
 * The module to save for a shared code, beside the modules already there. A
 * shared module never replaces one: an id or name already in the list gets a
 * new one, as loading a file and choosing "Keep both" does.
 */
export function sharedModuleToSave(
  code: string,
  existing: LegoProject[],
  knownPartIds: ReadonlySet<string>,
  fresh: { id: string; now: string },
): SharedModule {
  const read = readSharedModule(code, knownPartIds);
  if (!read.ok) return read;
  return {
    ...read,
    project: resolveLoad(read.project, existing, "keep-both", fresh),
  };
}
