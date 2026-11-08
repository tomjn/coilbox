/**
 * Game archives coilbox does not offer, whatever the mirror lists (issue #4780).
 *
 * XTA 9.729 MT is a build for the multi-threaded engine only. Its description
 * holds a newline, which makes the current engine's unitsync caches fail with
 * syntax errors, so a player who installs it breaks their install. Rapid has no
 * entry for it. Only the springfiles index lists it.
 *
 * An archive is blocked when its file name or its MD5 matches, so a mirror
 * renaming the file, or listing the same bytes under another name, does not
 * bring it back.
 */
export interface BlockedGame {
  /** The archive's file name, compared without regard to case. */
  filename: string;
  md5: string;
  reason: string;
}

export const BLOCKED_GAMES: readonly BlockedGame[] = [
  {
    filename: "xta-9.729_mt.sdz",
    md5: "3f52be87244d93719cf730a029060a8a",
    reason:
      "Only runs on the multi-threaded engine build, and its description breaks the current engine's unitsync caches.",
  },
];

/** The fields of a mirror index entry that identify an archive. */
export interface GameArchiveId {
  filename: string;
  md5?: string | null;
}

const lc = (s: string) => s.toLowerCase();

/** Whether an archive on a mirror index is one coilbox does not offer. */
export function isBlockedGame(archive: GameArchiveId): boolean {
  const filename = lc(archive.filename);
  const md5 = archive.md5 ? lc(archive.md5) : "";
  return BLOCKED_GAMES.some(
    (b) => lc(b.filename) === filename || (md5 !== "" && lc(b.md5) === md5),
  );
}

/** `entries` without the blocked archives, and the same array when none go. */
export function withoutBlockedGames<T extends GameArchiveId>(
  entries: T[],
): T[] {
  const kept = entries.filter((e) => !isBlockedGame(e));
  return kept.length === entries.length ? entries : kept;
}
