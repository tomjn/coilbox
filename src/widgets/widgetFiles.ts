/** Telling scanned widget files apart across content roots (issue #4861). */

import { underConfigDir } from "@/content/enginePaths";

/** What tells one scanned file from another: the same `path` can be in two
 *  roots. */
export function fileKey(file: { root: string; path: string }): string {
  return `${file.root}\u0000${file.path}`;
}

/** Where a file is on disk, which no other file shares. */
export function fullPath(file: { root: string; path: string }): string {
  return underConfigDir(file.root, file.path);
}
