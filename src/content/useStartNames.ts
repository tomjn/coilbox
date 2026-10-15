import { useSetting } from "@picoframe/frame";
import { useCallback } from "react";
import { type NameBook, START_NAMES_KEY, type StoredName } from "./startNames";

const NONE: StoredName[] = [];

/**
 * The names given to one map's start positions, and a way to replace them.
 * Stored beside the map exclusions, in the frame settings, under the map's
 * exact name.
 */
export function useStartNames(mapName: string) {
  const [book, setBook] = useSetting<NameBook>(START_NAMES_KEY, {});
  const stored = book[mapName] ?? NONE;
  const save = useCallback(
    (next: readonly StoredName[]) => {
      const { [mapName]: _gone, ...rest } = book;
      setBook(next.length > 0 ? { ...rest, [mapName]: [...next] } : rest);
    },
    [book, mapName, setBook],
  );
  return { stored, save };
}
