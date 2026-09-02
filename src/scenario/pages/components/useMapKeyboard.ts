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

import type { FootprintMark, SnapBuilding } from "@/blueprint/footprint";
import { mapKeyAction } from "@/placement/mapKeys";
import type { PlaceKind } from "@/placement/preview";
import type { Point, Scenario } from "../../model";
import { setOrigin } from "./bases";
import { canTurn } from "./editing";
import type { ScenarioEdit } from "./edits";
import { addWaypoint } from "./groups";
import { isTypingTarget } from "./history";
import {
  addedPointWords,
  cursorWords,
  type LayoutEditFor,
  MAP_KEY_HELP,
  type MapStep,
  type MapThings,
  mapProblemsWords,
  mapSteps,
  movedWords,
  moveOnMap,
  nextStep,
  originMovedWords,
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
import {
  deletedManyWords,
  type MapSelection,
  movedManyWords,
  moveSelection,
  primaryKey,
  removeSelection,
  turnedManyWords,
  turnSelection,
} from "./selection";
import { parseZoneKey } from "./zones";

/** Where the view is looking, and how high the ground is there. */
export interface MapCursor {
  pos: Point;
  height: number;
}

export interface MapKeyboardDeps {
  things: MapThings;
  onChange: (edit: ScenarioEdit) => void;
  /** Everything selected, newest last (issue #2279). The keys act on all of it,
   *  and the one at the end is the one they name. */
  selection: MapSelection;
  onSelect: (key: string | null) => void;
  /**
   * Select a stop on the cycle's ring and take the camera to it, exactly as
   * picking it out of the contents list does. A contents entry satisfies this
   * (issue #2314): only its key, position and span are read.
   */
  onEntry: (step: MapStep) => void;
  /**
   * What a click on bare ground would do, already resolved to whatever the map
   * is waiting for: a point for a trigger, the next point of a path being
   * drawn, a base's new origin, or whatever the current mode places. Null when
   * a click there would do nothing.
   */
  onPlace: ((pos: Point) => void) | null;
  /**
   * What that click would do, from the same three conditions `onPlace` is
   * built from (issue #2359), so Enter can say which of them ran rather than
   * calling every click a placement.
   */
  placing: PlaceKind;
  /** Where the engine would stand a building, for a base's buildings. */
  snap: SnapBuilding | undefined;
  layoutEdit: LayoutEditFor;
  /** Where the view is looking. Null before the scene is built. */
  cursorAt: () => MapCursor | null;
  /** Move the point the view is looking at, in elmos. */
  panBy: (delta: Point) => void;
  /**
   * The ground every base building in a document stands on, and which of them
   * are fighting over it: `baseFootprints` worked out for whatever scenario is
   * handed to it (issue #2315).
   *
   * A callback rather than a value already on `things`, because a move or a
   * turn has to hear the verdict the document will carry after the edit lands,
   * not the one it carried before, and only the caller knows how to weigh a
   * document against the game's units and the map's ground.
   */
  footprintsAt: (scenario: Scenario) => readonly FootprintMark[];
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
  /** Say something through the same live region the keys speak through, for
   *  whatever else the surface has to announce: a Shift-click, a marquee
   *  (issue #2279). */
  say: (text: string) => void;
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
  const primary = primaryKey(deps.selection);
  // biome-ignore lint/correctness/useExhaustiveDependencies: primary is the trigger, not read in the body. The reset does not care what the selection changed to, only that it did.
  useEffect(() => {
    resizingRef.current = false;
    setResizing(false);
  }, [primary]);

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
        selection,
        onSelect,
        onEntry,
        onPlace,
        placing,
        snap,
        layoutEdit,
        panBy,
        footprintsAt,
      } = latest.current;
      // The key table only ever needed to know whether something is selected and
      // whether it has a size, both of which are questions about the one the keys
      // name, which is the last one chosen.
      const selected = primaryKey(selection);
      /** Whether the keys are acting on more than one thing, which is what
       *  decides between naming what happened and counting it (issue #2279). */
      const many = selection.length > 1;
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
          // Stepping on replaces the selection rather than growing it, exactly
          // as a plain click does. A selection is built up in the Contents
          // popover, where a row is a button and Shift and Enter on one is a
          // Shift-click like any other (issue #2279).
          const steps = mapSteps(things.entries, things.paths);
          const step = nextStep(steps, things.entries, selected, action.by);
          if (!step) {
            say(
              "Nothing on the map yet. Pick a mode and press Enter to place.",
            );
            return;
          }
          onEntry(step);
          // Landing on a thing takes the camera to it, and the cursor is the
          // point the camera is looking at, so the marker's label has moved
          // too. Read after, because that is when the camera has arrived.
          readCursor();
          say(
            selectionWords(things, step.key) +
              placeInList(things.entries, step.key),
          );
          return;
        }

        case "move": {
          if (!selected) return;
          const key = selected;
          const held = selection;
          // One `onChange` whatever the selection holds, so a nudge of six
          // things is one step of the history (issue #2279).
          const after = many
            ? moveSelection(
                things.scenario,
                held,
                action.delta,
                snap,
                layoutEdit,
              )
            : moveOnMap(things.scenario, key, action.delta, snap, layoutEdit);
          if (after === things.scenario) {
            say("Nothing moved.");
            return;
          }
          onChange((doc) =>
            many
              ? moveSelection(doc, held, action.delta, snap, layoutEdit)
              : moveOnMap(doc, key, action.delta, snap, layoutEdit),
          );
          // Read off the document the move just landed on, the same rule
          // every position here already follows: the marks from before the
          // press are the ground the move is leaving (issue #2315).
          const marks = footprintsAt(after);
          say(
            many
              ? movedManyWords(held, action.heading, action.step, marks)
              : movedWords(
                  { ...things, scenario: after },
                  key,
                  action.heading,
                  action.step,
                  marks,
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
          const held = selection;
          if (many) {
            // Each about its own centre, never about the selection's: see
            // `selection.ts` for why swinging a selection as one body is a
            // different operation rather than this one done properly.
            const turns = held.filter((one) => canTurn(one)).length;
            if (turns === 0) {
              say(turnedManyWords(0, held.length, held, []));
              return;
            }
            const after = turnSelection(
              things.scenario,
              held,
              action.steps,
              layoutEdit,
            );
            onChange((doc) =>
              turnSelection(doc, held, action.steps, layoutEdit),
            );
            say(
              turnedManyWords(
                turns,
                held.length - turns,
                held,
                footprintsAt(after),
              ),
            );
            return;
          }
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
          say(
            turnedWords(
              { ...things, scenario: after },
              key,
              footprintsAt(after),
            ),
          );
          return;
        }

        case "delete": {
          if (!selected) return;
          const key = selected;
          const held = selection;
          if (many) {
            // Counted before it goes, because afterwards there is nothing left
            // to count.
            const what = deletedManyWords(held);
            onChange((doc) => removeSelection(doc, held, layoutEdit));
            onSelect(null);
            say(what);
            return;
          }
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
          // What ran is named from `placing` rather than assumed to be a
          // placement (issue #2359): a path being drawn, a base's origin
          // being moved and a trigger's question being answered are none of
          // them "placed", and saying so to an author working by ear points
          // them at something that is not there. The path and origin words
          // are read out of the document the same edit produces, so they
          // cannot disagree with what landed on it.
          switch (placing.kind) {
            case "path":
              say(
                addedPointWords(
                  things.paths,
                  addWaypoint(
                    things.scenario,
                    placing.groupId,
                    placing.order,
                    at.pos,
                  ),
                  placing.groupId,
                  placing.order,
                ),
              );
              return;
            case "moving":
              say(
                originMovedWords(
                  setOrigin(things.scenario, placing.baseId, at.pos),
                  placing.baseId,
                ),
              );
              return;
            case "picking":
              say(`Answered the question at ${spotWords(at.pos)}.`);
              return;
            case "arm":
              say(`Placed at ${spotWords(at.pos)}.`);
              return;
          }
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

        case "problems":
          // The whole map's marks, on demand, rather than only the one thing
          // that happens to be selected (issue #2315).
          say(mapProblemsWords(footprintsAt(things.scenario)));
          return;
      }
    },
    [say, readCursor],
  );

  const onFocus = useCallback(() => {
    readCursor();
  }, [readCursor]);

  return { help: MAP_KEY_HELP, said, cursor, onKeyDown, onFocus, say };
}
