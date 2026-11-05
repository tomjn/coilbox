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
 *
 * The textures those meshes record (#5073) travel in `textures`, each file's
 * bytes base64url encoded under its store key, as many as fit under the same
 * ceiling. Half the textures measured do not fit: the store on the machine
 * this was written on holds 52, from 219 bytes to 64 MiB, and 26 of them are
 * under 512 KB once encoded. A code leaves out any that do not fit and says so,
 * rather than refusing the meshes, and the far end draws those untextured.
 */

import { t } from "@lingui/core/macro";
import { strToU8 } from "fflate";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  decodeContainerText,
  MAX_INFLATED_BYTES,
  makeContainer,
  moduleGeometryRefusal,
  readContainer,
  tryEncodeContainerCode,
} from "@/container/container";
import {
  type LegoPiece,
  type LegoProject,
  type LegoTexture,
  parseLegoProjectData,
} from "./model";
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
  | {
      ok: true;
      code: string;
      /** The names of the textures too large to go in the code beside the
       *  rest, or missing from the store, which the far end draws without. */
      leftOut: string[];
    }
  | { ok: false; reason: string };

/** A texture's bytes, as the store holds them, by its store key. */
export type TextureBytes = ReadonlyMap<string, Uint8Array>;

/**
 * Every texture the module's own meshes record, once each, colour textures
 * first: a mesh drawn without its second texture still shows its colours.
 */
export function moduleTextures(module: LegoProject): LegoTexture[] {
  const found = new Map<string, LegoTexture>();
  const own = module.pieces.filter((piece) => piece.meshId && piece.ownMesh);
  for (const which of ["texture", "texture2"] as const) {
    for (const piece of own) {
      const texture = piece.ownMesh?.[which];
      if (texture && !found.has(texture.key)) found.set(texture.key, texture);
    }
  }
  return [...found.values()];
}

/** What a container holding `payload` inflates to, in UTF-8 bytes. */
function inflatedBytes(payload: unknown): number {
  return strToU8(
    JSON.stringify(makeContainer("module", MODULE_KIND_VERSION, payload)),
  ).length;
}

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
 * own geometry file, or null when it has none. `textures` holds the bytes of
 * the textures its own meshes record that could be read. Each goes in while
 * the code still fits, in `moduleTextures` order, and the rest are left out.
 */
export function moduleShareCode(
  module: LegoProject,
  raw: RawGeometry | null,
  textures: TextureBytes = new Map(),
): ModuleShareCode {
  const base = moduleSharePayload(module, raw);
  const refused = moduleGeometryRefusal(base);
  if (refused) return { ok: false, reason: refused };
  const carried: Record<string, string> = {};
  const leftOut: string[] = [];
  let payload: typeof base & { textures?: Record<string, string> } = base;
  if (base.geometry !== undefined) {
    for (const texture of moduleTextures(module)) {
      const bytes = textures.get(texture.key);
      if (!bytes) {
        leftOut.push(texture.name);
        continue;
      }
      const next = {
        ...base,
        textures: { ...carried, [texture.key]: bytesToBase64Url(bytes) },
      };
      if (inflatedBytes(next) > MAX_INFLATED_BYTES) {
        leftOut.push(texture.name);
        continue;
      }
      carried[texture.key] = next.textures[texture.key];
      payload = next;
    }
  }
  const made = tryEncodeContainerCode("module", MODULE_KIND_VERSION, payload);
  if (made.ok) return { ...made, leftOut };
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
      /** The textures the code carried, to put in the store before the
       *  module, by the key the pieces name them by. */
      textures: { key: string; bytes: Uint8Array }[];
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
 * The textures a shared payload carries for `project`'s own meshes, and the
 * project with every texture record it does not carry taken off. A record
 * naming a texture this machine never receives would draw as nothing, where
 * one with no texture draws untextured. Whether the bytes are that texture is
 * for the store to check, which refuses any whose key is not their own hash.
 */
function sharedTextures(
  project: LegoProject,
  value: unknown,
): { project: LegoProject; textures: { key: string; bytes: Uint8Array }[] } {
  const sent =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const textures: { key: string; bytes: Uint8Array }[] = [];
  for (const { key } of moduleTextures(project)) {
    const text = Object.hasOwn(sent, key) ? sent[key] : undefined;
    if (typeof text !== "string") continue;
    try {
      textures.push({ key, bytes: base64UrlToBytes(text) });
    } catch {
      // Unreadable, so not carried.
    }
  }
  const carried = new Set(textures.map((texture) => texture.key));
  const keep = (texture: LegoTexture | undefined) =>
    texture && carried.has(texture.key) ? texture : undefined;
  const pieces = project.pieces.map((piece): LegoPiece => {
    if (!piece.ownMesh) return piece;
    const texture = keep(piece.ownMesh.texture);
    const texture2 = keep(piece.ownMesh.texture2);
    return {
      ...piece,
      ownMesh: {
        file: piece.ownMesh.file,
        ...(texture ? { texture } : {}),
        ...(texture2 ? { texture2 } : {}),
      },
    };
  });
  return { project: { ...project, pieces }, textures };
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
  const found: {
    geometry: RawGeometry | null | false;
    textures: { key: string; bytes: Uint8Array }[];
  } = { geometry: null, textures: [] };
  const read = readContainer(value, "module", (payload) => {
    held = moduleGeometryRefusal(payload) !== null;
    if (held) return null;
    const parsed = parseLegoProjectData(payload);
    if (!parsed) return null;
    const { geometry, textures } = payload as {
      geometry?: unknown;
      textures?: unknown;
    };
    found.geometry = sharedGeometry(parsed, geometry);
    const shared = sharedTextures(parsed, textures);
    found.textures = shared.textures;
    return shared.project;
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
  return {
    ok: true,
    project,
    missingParts,
    geometry,
    textures: found.textures,
  };
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
