import { useEffect, useMemo } from "react";
import { optionValue, scriptTagKey } from "@/multiplayer/battle/battleOptions";
import {
  OVERRIDE_OPTION,
  type ResolvedArrangement,
  resolveArrangement,
  SET_OPTION,
  startBoxOptions,
} from "./barBoxes";

/**
 * The start boxes BAR's game will use in this room, or null when the room
 * carries neither option, a value could not be read, or no entry applies. The
 * room then shows its rectangles, as it does for any other game (issue #343).
 * A value that cannot be read is logged once, not on every render.
 */
export function useBarStartBoxes(
  scriptTags: Record<string, string>,
  teams: number,
): ResolvedArrangement | null {
  const override = optionValue(scriptTags, "mod", OVERRIDE_OPTION) ?? "";
  const set = optionValue(scriptTags, "mod", SET_OPTION) ?? "";
  const read = useMemo(
    () =>
      startBoxOptions({
        [scriptTagKey("mod", OVERRIDE_OPTION)]: override,
        [scriptTagKey("mod", SET_OPTION)]: set,
      }),
    [override, set],
  );
  useEffect(() => {
    for (const problem of read.problems) {
      console.warn(`start boxes: ${problem}, so the room shows its rectangles`);
    }
  }, [read]);
  return useMemo(
    () => resolveArrangement(read.override, read.set, teams),
    [read, teams],
  );
}
