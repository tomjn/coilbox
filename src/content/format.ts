import type { Archive } from "./bindings";

/** Human-readable byte size (e.g. 29518991 -> "28.2 MB"). */
export function formatBytes(n?: number): string | null {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Whether an archive is a loose `.sdd` directory (uncompressed dev content). */
export function isSdd(archive?: Archive): boolean {
  return isSddName(archive?.name);
}

/**
 * The same test on the archive's name alone, for a caller holding the string
 * rather than the record.
 *
 * The four formats are four things rather than four names for one, which is what
 * makes this a safe test to hang a rule on: a rapid pool install is a `.sdp`
 * package somebody plays, and only a `.sdd` is a folder somebody is editing. The
 * Rust side applies the same suffix test in
 * `crates/coilbox-unitsync-worker/src/archive.rs`.
 */
export function isSddName(name?: string): boolean {
  return !!name && name.toLowerCase().endsWith(".sdd");
}

const DELETABLE_EXTS = ["sd7", "sdz", "sdd", "sdp"];
const CONTENT_DIRS = ["games", "maps", "packages"];

/**
 * Whether a delete button should be offered for an on-disk archive path. Mirrors
 * the guard in the Rust `archives` module so the UI hides the button instead of
 * showing one that always fails: only archives in a content root's `games`,
 * `maps` or `packages` folder can go, which is what protects the engine's base
 * archives in `<engine>/base/`.
 */
export function isDeletableArchive(path: string | null | undefined): boolean {
  if (!path) return false;
  const parts = path.split(/[\\/]/).filter(Boolean);
  const file = parts.pop()?.toLowerCase();
  const parent = parts.pop()?.toLowerCase();
  if (!file || !parent) return false;
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return false;
  return (
    DELETABLE_EXTS.includes(file.slice(dot + 1)) &&
    CONTENT_DIRS.includes(parent)
  );
}
