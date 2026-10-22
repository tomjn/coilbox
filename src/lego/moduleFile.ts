/**
 * A module saved to a file, and what loading one does (issue #3307).
 *
 * The file is the clipboard's envelope (see clipboard.ts) with a `fileVersion`
 * added, so one format covers both and a file's text can be pasted into a unit.
 * The module's `packId` and `packVersion` travel inside the document.
 *
 * Pure and DOM-free: the dialogs and the disk are in moduleFileIo.ts.
 */

import { t } from "@lingui/core/macro";
import {
  CLIPBOARD_MARKER,
  type ClipboardPiece,
  parseClipboardPiece,
  serializeClipboardPiece,
} from "./clipboard";
import { type LegoProject, parseLifted } from "./model";
import { isBuiltInModule } from "./starterModules";

/** Raised when the file's layout changes in a way an older build cannot read. */
export const MODULE_FILE_VERSION = 1;

/** The module as file text. */
export function serializeModuleFile(module: LegoProject): string {
  const envelope = JSON.parse(serializeClipboardPiece(module));
  return JSON.stringify(
    { ...envelope, fileVersion: MODULE_FILE_VERSION },
    null,
    2,
  );
}

export type ParsedModuleFile =
  | { ok: true; piece: ClipboardPiece }
  | { ok: false; reason: string };

/**
 * Check file text with the paste parser. A module naming parts the loaded pack
 * lacks still loads, with those pieces listed in `missingParts`.
 */
export function parseModuleFile(
  text: string,
  knownPartIds: ReadonlySet<string>,
): ParsedModuleFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: t`The file does not hold JSON.` };
  }
  const envelope = (typeof data === "object" ? data : null) as Record<
    string,
    unknown
  > | null;
  if (!envelope || envelope.marker !== CLIPBOARD_MARKER) {
    return { ok: false, reason: t`The file does not hold a module.` };
  }
  // A clipboard payload has no file version and is accepted as version 1.
  if (
    typeof envelope.fileVersion === "number" &&
    envelope.fileVersion > MODULE_FILE_VERSION
  ) {
    return {
      ok: false,
      reason: t`The file was made by a newer version of coilbox.`,
    };
  }
  const parsed = parseClipboardPiece(text, knownPartIds);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: t`The module in the file could not be read.`,
    };
  }
  const unplaced = piecesWithoutGame(envelope.project);
  if (unplaced.length > 0) {
    const names = unplaced.join(", ");
    return {
      ok: false,
      reason: t`${names} came from a game, but the file does not say which. A piece from a game only goes in units for that game.`,
    };
  }
  return parsed;
}

/**
 * Names of the pieces in a file's project that claim to be lifted from a game
 * but do not record one. Reading such a piece would drop its `lifted` record
 * and turn it into a piece that goes into any unit.
 */
function piecesWithoutGame(project: unknown): string[] {
  const pieces = (project as { pieces?: unknown } | null)?.pieces;
  if (!Array.isArray(pieces)) return [];
  return pieces.flatMap((piece: unknown, index) => {
    const p = (piece ?? {}) as { name?: unknown; lifted?: unknown };
    if (p.lifted === undefined || p.lifted === null) return [];
    if (parseLifted(p.lifted)) return [];
    const position = index + 1;
    return [
      typeof p.name === "string" && p.name ? p.name : t`piece ${position}`,
    ];
  });
}

export type LoadChoice = "replace" | "keep-both";

/** The first of `name`, `name 2`, `name 3`... that no other module has. */
function uniqueName(name: string, taken: LegoProject[]): string {
  const names = new Set(taken.map((m) => m.name.trim().toLowerCase()));
  let candidate = name;
  for (let n = 2; names.has(candidate.trim().toLowerCase()); n++) {
    candidate = `${name} ${n}`;
  }
  return candidate;
}

/**
 * The module to save for a loaded one.
 *
 * An id already installed is replaced only when the user chose to, and never
 * for a built in module, which a load can only copy. Every other case gets a
 * new id. The name is made unique among the other modules, because the list
 * tells modules apart by name.
 */
export function resolveLoad(
  loaded: LegoProject,
  existing: LegoProject[],
  choice: LoadChoice,
  fresh: { id: string; now: string },
): LegoProject {
  const clash = existing.some((m) => m.id === loaded.id);
  const replacing = choice === "replace" && clash && !isBuiltInModule(loaded);
  const reuseId = replacing || (!clash && !isBuiltInModule(loaded));
  const others = existing.filter((m) => !replacing || m.id !== loaded.id);
  const name = uniqueName(loaded.name, others);
  if (reuseId && name === loaded.name) return loaded;
  return reuseId
    ? { ...loaded, name }
    : {
        ...loaded,
        id: fresh.id,
        name,
        createdAt: fresh.now,
        updatedAt: fresh.now,
      };
}

/** Whether loading `loaded` needs the user to choose replace or keep both. */
export function needsChoice(
  loaded: LegoProject,
  existing: LegoProject[],
): boolean {
  return !isBuiltInModule(loaded) && existing.some((m) => m.id === loaded.id);
}
