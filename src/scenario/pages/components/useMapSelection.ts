/**
 * Everything selected on the map (issue #2279), newest last.
 *
 * `useMapSelection` is the state itself: the list, a ref alongside it because a
 * click that selects something and the click after it that acts on that
 * selection can both land before React renders (issue #904), and the two ways
 * of changing it that read no more than a clicked key or a marquee's catch
 * against the document's groups. `useSelectionCleanup` is the one effect that
 * also needs to know what the document currently draws, kept apart because
 * that only exists once the units layer has been built - later in the render
 * than the state itself - the same reason `useMapCamera` splits into two calls.
 *
 * Neither hook calls `onChange`. Everything that decides what a selection
 * means for the document - turning it, deleting it, filing it under a base
 * being edited - reads `selection`/`selected` back out of this hook and stays
 * in `ScenarioMapScene.tsx`, next to the `onChange` calls it makes.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Placement, placementKey } from "@/placement/placements";
import type { Scenario } from "../../model";
import { parsePathLineKey } from "./groups";
import type { MapThings } from "./mapKeyboard";
import { thingWords } from "./mapKeyboard";
import {
  addedWords,
  addKeys,
  inSelection,
  type MapSelection,
  marqueeWords,
  NO_SELECTION,
  primaryKey,
  removedWords,
  selectOne,
  stillThere,
  toggleKey,
} from "./selection";

export interface MapSelectionApi {
  selection: MapSelection;
  selectionRef: RefObject<MapSelection>;
  /** The last of `selection`, and what every bar, panel and layer that only
   *  ever handled one thing goes on reading. */
  selected: string | null;
  setSelection: (next: MapSelection) => void;
  /** What a click does to the selection: this instead of what was selected,
   *  or with Shift held, this as well, or out again if it was already in. */
  setSelected: (key: string | null, add?: boolean) => void;
  /**
   * What a click on the map selects.
   *
   * A drawn path line stands for the orders that drew it: the line is the
   * easiest thing on a big map to hit and the orders are what an author who
   * hit it wants (#842). A group's line means the group, because a group has
   * units to select and controls to open. A trigger's line means itself,
   * because it has neither, and selecting it is what puts knobs on its
   * points.
   */
  select: (key: string | null, add?: boolean) => void;
  /** What a marquee selects: everything inside the box, instead of what was
   *  selected or as well as it (issue #2279). */
  selectMany: (keys: string[], add: boolean) => void;
  /** What the announcements name things by, filled in once the document has
   *  been flattened into the three lists that name them. A ref because a
   *  click reads it when the click happens, not when the handler was built. */
  thingsRef: RefObject<MapThings>;
  /** Said through the map's own live region, which `useMapKeyboard` owns.
   *  Held in a ref because that hook is resolved later in the render than
   *  the callbacks that speak through it. */
  sayRef: RefObject<(text: string) => void>;
}

export function useMapSelection(scenario: Scenario): MapSelectionApi {
  const [selection, showSelection] = useState<MapSelection>(NO_SELECTION);
  const selectionRef = useRef<MapSelection>(NO_SELECTION);
  const setSelection = useCallback((next: MapSelection) => {
    selectionRef.current = next;
    showSelection(next);
  }, []);
  const selected = primaryKey(selection);
  const setSelected = useCallback(
    (key: string | null, add = false) => {
      setSelection(add ? toggleKey(selectionRef.current, key) : selectOne(key));
    },
    [setSelection],
  );
  const sayRef = useRef<(text: string) => void>(() => {});
  const thingsRef = useRef<MapThings>({
    scenario,
    entries: [],
    placements: [],
    paths: [],
  });

  const groups = scenario.groups;
  const select = useCallback(
    (key: string | null, add = false) => {
      const line = key ? parsePathLineKey(key) : null;
      const meant = line
        ? groups.some((one) => one.id === line)
          ? placementKey("group", line, 0)
          : key
        : key;
      setSelected(meant, add);
      // Only a Shift-click says anything. A plain click replaces the
      // selection, and the bar that opens for it is the account of that. Six
      // Shift-clicks would otherwise be six sentences nobody asked for
      // (issue #2279).
      if (!add || !meant) return;
      const named = thingWords(thingsRef.current, meant);
      const after = selectionRef.current;
      sayRef.current(
        inSelection(after, meant)
          ? addedWords(named, after)
          : removedWords(named, after),
      );
    },
    [groups, setSelected],
  );

  const selectMany = useCallback(
    (keys: string[], add: boolean) => {
      const after = add ? addKeys(selectionRef.current, keys) : keys;
      setSelection(after);
      sayRef.current(marqueeWords(keys.length, after));
    },
    [setSelection],
  );

  return {
    selection,
    selectionRef,
    selected,
    setSelection,
    setSelected,
    select,
    selectMany,
    thingsRef,
    sayRef,
  };
}

/**
 * Keys pointing at things the document no longer holds, dropped.
 *
 * An undo, a delete taken from a panel, or an edit that emptied a group can
 * all leave a selection naming units nobody is drawing any more, and the next
 * Delete would then work through keys that mean nothing. Off the drawn list
 * rather than the document, because that is the list the keys address.
 *
 * Its own hook rather than folded into `useMapSelection`, so it stays exactly
 * where the effect it replaces was declared: after the units layer that
 * `placements` and `settled` come from exists, keeping this effect's position
 * relative to the map's other effects unchanged.
 */
export function useSelectionCleanup(
  selectionRef: RefObject<MapSelection>,
  setSelection: (next: MapSelection) => void,
  placements: Placement[],
  settled: boolean,
  scenario: Scenario,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectionRef is the stable ref useMapSelection returns, taken as a parameter here and read through .current on purpose, the same reason the effect this replaces needed no such dependency when the ref was declared in the same component.
  useEffect(() => {
    const held = selectionRef.current;
    if (held.length === 0 || !settled) return;
    const kept = stillThere(held, placements, scenario);
    if (kept.length !== held.length) setSelection(kept);
  }, [placements, settled, scenario, setSelection]);
}
