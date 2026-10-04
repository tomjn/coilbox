import { useWriteRootPath } from "../downloads/config";

/**
 * The content root to list replays from: the selected engine's root, or with no
 * engine installed the download folder (issue #3403). Replays are found under a
 * root's own `demos` and `replays` folders, which needs no engine, so a machine
 * with none still lists the replays it has and can offer the engine one needs.
 */
export function useReplaysRoot(selectedRootPath?: string): string | undefined {
  const writeRoot = useWriteRootPath();
  return selectedRootPath ?? writeRoot;
}
