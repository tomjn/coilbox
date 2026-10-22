/**
 * A module as a share code, the form the hub and a `coilbox://` link carry
 * (#3272). The payload is the module document itself.
 *
 * Only a module of parts and empty pieces can be shared. The rule and its words
 * are `moduleGeometryRefusal` in the container code, which the hub vendors, so
 * the app and the hub refuse the same modules. A module saved to a file is not
 * covered: that is `moduleFile.ts`, and it never goes through the hub.
 */

import { t } from "@lingui/core/macro";
import {
  decodeContainerText,
  moduleGeometryRefusal,
  readContainer,
  tryEncodeContainerCode,
} from "@/container/container";
import { type LegoProject, parseLegoProjectData } from "./model";
import { resolveLoad } from "./moduleFile";

/** Payload schema version for `kind: "module"`. */
export const MODULE_KIND_VERSION = 1;

export type ModuleShareCode =
  | { ok: true; code: string }
  | { ok: false; reason: string };

/** The module's share code, or why it cannot have one. */
export function moduleShareCode(module: LegoProject): ModuleShareCode {
  const refused = moduleGeometryRefusal(module);
  if (refused) return { ok: false, reason: refused };
  const made = tryEncodeContainerCode("module", MODULE_KIND_VERSION, module);
  if (made.ok) return made;
  const size = Math.round(made.bytes / 1024);
  const limit = Math.round(made.limit / 1024);
  return {
    ok: false,
    reason: t`This module is ${size} KB, over the ${limit} KB a code can carry.`,
  };
}

export type SharedModule =
  | { ok: true; project: LegoProject; missingParts: string[] }
  | { ok: false; reason: string };

/**
 * Read a shared module code. A module holding game geometry is refused here
 * too, so a code from anywhere cannot carry a lifted piece into a unit.
 * `knownPartIds` is the loaded pack's, to list pieces whose part it lacks.
 */
export function readSharedModule(
  code: string,
  knownPartIds: ReadonlySet<string>,
): SharedModule {
  const value = decodeContainerText(code);
  let held = false;
  const read = readContainer(value, "module", (payload) => {
    held = moduleGeometryRefusal(payload) !== null;
    return held ? null : parseLegoProjectData(payload);
  });
  if (held) {
    return {
      ok: false,
      reason: t`This module holds geometry from a game or a model, which a shared module cannot carry.`,
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
  return { ok: true, project, missingParts };
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
