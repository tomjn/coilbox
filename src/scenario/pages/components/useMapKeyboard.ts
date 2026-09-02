/**
 * The map as a keyboard interface (issue #2269).
 *
 * Everything an author does on the map used to need a pointer. This turns the
 * surface into something a person can drive with the keys alone: step through
 * what is on the map, move it, turn it, delete it, and place something new at a
 * cursor they can move themselves.
 *
 * Three things shape it.
 *
 * Choosing what to act on is the contents list's order, not one of this hook's
 * own. That list already selects a thing and takes the camera to it, and a
 * second order for the same set would be a second thing to learn.
 *
 * Nothing here holds a window listener. The keys are a React `onKeyDown` on the
 * element the author has focused, so there is no effect to churn and no way for
 * the map to answer a key press while somebody is typing in a panel.
 *
 * Speech is the interface rather than a caption on one. A blind author gets
 * nothing at all from the 3D view, so every key that does something says what it
 * did, and every key that does nothing says why. What is said is built in
 * `mapKeyboard.ts` from the document after the edit, so it cannot drift from
 * what actually happened.
 */

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SnapBuilding } from "@/blueprint/footprint";
import { mapKeyAction } from "@/placement/mapKeys";
import type { Point } from "../../model";
import type { ContentEntry } from "./contents";
import type { ScenarioEdit } from "./edits";
import { isTypingTarget } from "./history";
import {
  cursorWords,
  type LayoutEditFor,
  MAP_KEY_HELP,
  type MapThings,
  movedWords,
  moveOnMap,
  nextEntry,
  placeInList,
  removeOnMap,
  resizedWords,
  resizeLimitWords,
  resizeModeWords,
  resizeOnMap,
  selectionWords,
  spotWords,
  thingWords,
  turnedWords,
  turnOnMap,
} from "./mapKeyboard";
import { parseZoneKey } from "./zones";

/** Where the view is looking, and how high the ground is there. */
export interface MapCursor {
  pos: Point;
  height: number;
}

export interface MapKeyboardDeps {
  things: MapThings;
  onChange: (edit: ScenarioEdit) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Select a contents entry and take the camera to it, exactly as picking it
   *  out of the contents list does. */
  onEntry: (entry: ContentEntry) => void;
  /**
   * What a click on bare ground would do, already resolved to whatever the map
   * is waiting for: a point for a trigger, the next point of a path being
   * drawn, a base's new origin, or whatever the current mode places. Null when
   * a click there would do nothing.
   */
  onPlace: ((pos: Point) => void) | null;
  /** Where the engine would stand a building, for a base's buildings. */
  snap: SnapBuilding | undefined;
  layoutEdit: LayoutEditFor;
  /** Where the view is looking. Null before the scene is built. */
  cursorAt: () => MapCursor | null;
  /** Move the point the view is looking at, in elmos. */
  panBy: (delta: Point) => void;
}

/** What the surface needs to be a keyboard surface. */
export interface MapKeyboard {
  /** Read out when the map takes the focus, and again on demand. */
  help: string;
  /** The last thing said, politely, with a token so saying the same thing
   *  twice is still said twice. */
  said: { text: string; token: number };
  /** Where the view's cursor is, in words, for the marker drawn at the middle
   *  of the view. Null until the scene is built. */
  cursor: string | null;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onFocus: () => void;
}

export function useMapKeyboard(deps: MapKeyboardDeps): MapKeyboard {
  const [said, setSaid] = useState({ text: "", token: 0 });
  const [cursor, setCursor] = useState<string | null>(null);
  // Read at key time rather than captured, the way the pointer layer reads its
  // own (`useMapEditing.ts`), so a handler built this render still acts on the
  // document and the selection as they stand.
  const latest = useRef(deps);
  latest.current = deps;

  // Whether the S key has put the zone that is selected into resize mode
  // (issue #2313). A ref beside the state, the same pattern `latest` is, so
  // the key handler below reads the current value rather than the one it
  // closed over when it was built.
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(resizing);
  resizingRef.current = resizing;

  // Resize mode belongs to one selection, not to the map in general: picking
  // something else, or letting go of the selection, drops back to move so an
  // author never finds arrows still resizing a zone they left behind.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps.selected is the trigger, not read in the body. The reset does not care what the selection changed to, only that it did.
  useEffect(() => {
    resizingRef.current = false;
    setResizing(false);
  }, [deps.selected]);

  const say = useCallback((text: string) => {
    setSaid((was) => ({ text, token: was.token + 1 }));
  }, []);

  /** Put the marker's label back in step with where the view is looking. */
  const readCursor = useCallback((): MapCursor | null => {
    const at = latest.current.cursorAt();
    setCursor(at ? spotWords(at.pos) : null);
    return at;
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // A field inside the surface keeps its own keys: the zone name box sits
      // over the map and Delete in it is a delete of a character.
      if (isTypingTarget(event.target as HTMLElement | null)) return;

      const {
        things,
        onChange,
        selected,
        onSelect,
        onEntry,
        onPlace,
        snap,
        layoutEdit,
        panBy,
      } = latest.current;
      const resizable = !!selected && !!parseZoneKey(selected);
      const action = mapKeyAction(event, {
        selected: !!selected,
        resizable,
        resizing: resizable && resizingRef.current,
      });
      if (!action) return;
      event.preventDefault();

      switch (action.kind) {
        case "cycle": {
          const entry = nextEntry(things.entries, selected, action.by);
          if (!entry) {
            say(
              "Nothing on the map yet. Pick a mode and press Enter to place.",
            );
            return;
          }
          onEntry(entry);
          // Landing on a thing takes the camera to it, and the cursor is the
          // point the camera is looking at, so the marker's label has moved
          // too. Read after, because that is when the camera has arrived.
          readCursor();
          say(
            selectionWords(things, entry.key) +
              placeInList(things.entries, entry.key),
          );
          return;
        }

        case "move": {
          if (!selected) return;
          const key = selected;
          const after = moveOnMap(
            things.scenario,
            key,
            action.delta,
            snap,
            layoutEdit,
          );
          if (after === things.scenario) {
            say("Nothing moved.");
            return;
          }
          onChange((doc) =>
            moveOnMap(doc, key, action.delta, snap, layoutEdit),
          );
          say(
            movedWords(
              { ...things, scenario: after },
              key,
              action.heading,
              action.step,
            ),
          );
          return;
        }

        case "resize": {
          if (!selected) return;
          const key = selected;
          const after = resizeOnMap(
            things.scenario,
            key,
            action.heading,
            action.step,
          );
          if (after === things.scenario) {
            say(resizeLimitWords(things, key));
            return;
          }
          onChange((doc) => resizeOnMap(doc, key, action.heading, action.step));
          say(
            resizedWords(
              { ...things, scenario: after },
              key,
              action.heading,
              action.step,
            ),
          );
          return;
        }

        case "toggleResize": {
          if (!selected) return;
          const key = selected;
          const next = !resizingRef.current;
          resizingRef.current = next;
          setResizing(next);
          say(resizeModeWords(things, key, next));
          return;
        }

        case "turn": {
          if (!selected) return;
          const key = selected;
          const after = turnOnMap(
            things.scenario,
            key,
            action.steps,
            layoutEdit,
          );
          if (after === things.scenario) {
            say("This does not turn. A group's units all face south.");
            return;
          }
          onChange((doc) => turnOnMap(doc, key, action.steps, layoutEdit));
          say(turnedWords({ ...things, scenario: after }, key));
          return;
        }

        case "delete": {
          if (!selected) return;
          const key = selected;
          // Named before it goes, because afterwards there is nothing left to
          // name it by.
          const what = thingWords(things, key);
          onChange((doc) => removeOnMap(doc, key, layoutEdit));
          onSelect(null);
          say(`Deleted ${what}. Nothing selected.`);
          return;
        }

        case "pan": {
          panBy(action.delta);
          const at = readCursor();
          say(
            at
              ? `${action.heading} ${action.step}. ${cursorWords(at.pos, at.height)}`
              : "The map is not drawn yet.",
          );
          return;
        }

        case "act": {
          const at = readCursor();
          if (!at) {
            say("The map is not drawn yet.");
            return;
          }
          if (!onPlace) {
            say(
              "This mode places nothing here. Pick a mode above the map, or press full stop to step through what is already placed.",
            );
            return;
          }
          onPlace(at.pos);
          say(`Placed at ${spotWords(at.pos)}.`);
          return;
        }

        case "clear":
          // Stopped here rather than let through: the Bases mode listens for
          // Escape on the window to put down the building it is carrying, and
          // one press should do one thing. A second press, with nothing
          // selected, is not ours and reaches it.
          event.stopPropagation();
          onSelect(null);
          say("Nothing selected.");
          return;

        case "help":
          say(MAP_KEY_HELP);
          return;
      }
    },
    [say, readCursor],
  );

  const onFocus = useCallback(() => {
    readCursor();
  }, [readCursor]);

  return { help: MAP_KEY_HELP, said, cursor, onKeyDown, onFocus };
}
