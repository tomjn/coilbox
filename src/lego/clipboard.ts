/**
 * The clipboard payload for a lifted piece or set, and what paste does with it.
 *
 * The payload is the same self-contained document a saved compound uses (see
 * compounds.ts), wrapped in a small envelope so paste can tell it apart from
 * anything else that might be sitting on the system clipboard: a random JSON
 * object, a snippet of text, someone else's file. Reusing the compound shape
 * means there is one wire format for a subtree, not two.
 *
 * Copying several pieces at once needed nothing here: a set is that same
 * document with several parentless pieces in it, which the envelope and this
 * parser already carry. The alternative, a list of documents in the envelope,
 * would have made every payload unreadable to a build that predates it,
 * including the single-piece ones that work between windows today.
 *
 * Pure and DOM-free, so the rejection cases can be tested directly: parsing
 * clipboard text is exactly the code that handles input this codebase does
 * not control.
 */

import { t } from "@lingui/core/macro";
import { markLifted } from "./liftPiece";
import {
  LEGO_SCHEMA_VERSION,
  type LegoLifted,
  type LegoProject,
  parseLegoProjectData,
  parseLifted,
} from "./model";

/** Marks the payload as ours. Anything else on the clipboard is rejected. */
export const CLIPBOARD_MARKER = "coilbox-lego-piece";

interface ClipboardEnvelope {
  marker: typeof CLIPBOARD_MARKER;
  schemaVersion: typeof LEGO_SCHEMA_VERSION;
  project: LegoProject;
  /**
   * The unit the pieces were copied from. Pieces that draw a mesh name it by
   * a key in that unit's geometry file, so paste reads the meshes from there
   * (#4343). The file is on disk, so this works between windows, and keeps a
   * large mesh off the clipboard.
   */
  sourceUnitId?: string;
  /**
   * Where the source unit's meshes came from, when it was opened from a game.
   * Paste into any other unit treats those meshes as lifted from that game
   * (#3268).
   */
  openedFrom?: LegoLifted;
}

/** Wrap a lifted subtree for writing to the system clipboard. */
export function serializeClipboardPiece(
  project: LegoProject,
  sourceUnitId?: string,
  openedFrom?: LegoLifted | null,
): string {
  const envelope: ClipboardEnvelope = {
    marker: CLIPBOARD_MARKER,
    schemaVersion: LEGO_SCHEMA_VERSION,
    project,
    ...(sourceUnitId ? { sourceUnitId } : {}),
    ...(openedFrom ? { openedFrom } : {}),
  };
  return JSON.stringify(envelope);
}

export interface ClipboardPiece {
  project: LegoProject;
  /** The unit the pieces were copied from, when the payload says. */
  sourceUnitId?: string;
  /**
   * Names of pieces whose part is not in the pack that is currently loaded.
   * They still paste in: the hierarchy and names are real work even without
   * geometry to show for them, and an unresolved `partId` is already how a
   * missing part is drawn everywhere else. Reported rather than dropped, so
   * that does not happen silently.
   */
  missingParts: string[];
  /** See {@link ClipboardEnvelope.openedFrom}. */
  openedFrom?: LegoLifted;
}

export type ParsedClipboard =
  | { ok: true; piece: ClipboardPiece }
  | { ok: false; reason: string };

/**
 * Parse and validate clipboard text as a pasted piece.
 *
 * Rejects text that is not JSON, JSON that is not one of ours, and a payload
 * whose inner document does not parse as a lego project at all. `knownPartIds`
 * is the currently loaded pack's part ids, used only to report which pieces,
 * if any, name a part that pack does not have.
 */
export function parseClipboardPiece(
  text: string,
  knownPartIds: ReadonlySet<string>,
): ParsedClipboard {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: t`The clipboard does not hold JSON.` };
  }

  if (typeof data !== "object" || data === null) {
    return {
      ok: false,
      reason: t`The clipboard does not hold a lego piece.`,
    };
  }
  const envelope = data as Record<string, unknown>;
  if (envelope.marker !== CLIPBOARD_MARKER) {
    return {
      ok: false,
      reason: t`The clipboard does not hold a lego piece.`,
    };
  }

  const project = parseLegoProjectData(envelope.project);
  if (!project) {
    return {
      ok: false,
      reason: t`The clipboard's lego piece could not be read.`,
    };
  }

  const missingParts = project.pieces
    .filter((piece) => piece.partId !== null && !knownPartIds.has(piece.partId))
    .map((piece) => piece.name);

  const sourceUnitId =
    typeof envelope.sourceUnitId === "string" && envelope.sourceUnitId
      ? envelope.sourceUnitId
      : undefined;
  const from = parseLifted(envelope.openedFrom);
  return {
    ok: true,
    piece: {
      project,
      missingParts,
      ...(sourceUnitId ? { sourceUnitId } : {}),
      ...(from ? { openedFrom: from } : {}),
    },
  };
}

/**
 * The pasted document as it goes into the unit `unitId`. Meshes copied out of a
 * unit opened from a game are marked as lifted from it, unless they are pasted
 * back into the unit they came from.
 */
export function pastedForUnit(piece: ClipboardPiece, unitId: string) {
  if (!piece.openedFrom || piece.sourceUnitId === unitId) return piece.project;
  return markLifted(piece.project, piece.openedFrom);
}
