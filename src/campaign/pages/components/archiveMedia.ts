import type { ArchiveFileEntry } from "../../../content/bindings";
import { AUDIO_EXTS, IMAGE_EXTS } from "../../../lib/assetUrl";

/**
 * Pure logic for the "import from game files" media pickers (see
 * {@link ../ArchiveMediaPickerPopover}): narrowing a game archive's member list
 * to the media types a picker cares about, free-text search over that narrowed
 * list, and same-session duplicate-import tracking. Kept dependency-free (no
 * React, no Tauri commands) so it's plain-function testable.
 */

/** The media kind a picker cares about: images (icon/panorama/side graphic
 * slots) or audio (the voiceover slot). Video is out of scope. unitsync's
 * archive preview command doesn't decode audio/video streams for a browser
 * `<video>` tag, so there's no in-picker way to preview or size-cap a clip
 * before import, so it stays file-picker only. */
export type ArchiveMediaType = "image" | "audio";

/** The extension of a slash-separated archive member path, lowercased and
 * without the dot, or "" when the path has none. */
export function archiveFileExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Narrow an archive's member list to the extensions relevant to `type`, so a
 * picker only ever shows files it can actually preview and import (an author
 * browsing an image slot isn't shown the game's Lua scripts or sound bank).
 */
export function filterArchiveFilesByType(
  files: ArchiveFileEntry[],
  type: ArchiveMediaType,
): ArchiveFileEntry[] {
  const exts = type === "audio" ? AUDIO_EXTS : IMAGE_EXTS;
  return files.filter((f) => exts.includes(archiveFileExt(f.path)));
}

/** Case-insensitive substring search over a (already type-filtered) member
 * list, matching anywhere in the path. An empty query returns `files` as-is. */
export function searchArchiveFiles(
  files: ArchiveFileEntry[],
  query: string,
): ArchiveFileEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => f.path.toLowerCase().includes(q));
}

/** Stable key identifying one archive member, for the same-session
 * already-imported tracking below. */
export function archiveMediaKey(archive: string, file: string): string {
  return `${archive}::${file}`;
}

/**
 * Whether importing `file` from `archive` needs a duplicate-import confirmation.
 * It was already imported earlier this session (present in `imported`) and the
 * caller hasn't just confirmed that exact key (`confirmed`). Re-importing the
 * same archive member can never silently overwrite the previous import (the
 * store mints a fresh filename per import), but doing it by accident is still
 * confusing, so the picker surfaces it once and proceeds on a second click.
 */
export function needsDuplicateConfirm(
  imported: ReadonlySet<string>,
  archive: string,
  file: string,
  confirmed: string | null,
): boolean {
  const key = archiveMediaKey(archive, file);
  return imported.has(key) && confirmed !== key;
}
