import { useState } from "react";

/**
 * A field's own copy of a value the document also holds.
 *
 * Fields in editors that save as they go keep one, so that typing is not a disk
 * write per keystroke: it is what the box shows, and it is written back when the
 * box is left. The copy has to follow the document when the document changes on
 * its own, which is what undo and redo do (issues #2173 and #2175). Left to
 * drift, the box shows the old text after a step back, and the next keystroke
 * commits that old text over the top and takes the undo with it.
 *
 * The reset happens during the render that is handed the new value rather than
 * in an effect, so the stale text is never painted.
 *
 * The value seen last is remembered rather than compared against the copy,
 * because those two differ for the ordinary reason as well: somebody is part way
 * through typing. Only a value that has moved on its own resets the box.
 *
 * How the copy is committed is the field's own business, and each of them
 * differs: some trim, some treat an empty box as clearing an optional value, and
 * some refuse an empty box outright. This says nothing about that.
 */
export function useFieldText(value: string): [string, (text: string) => void] {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);

  if (seen !== value) {
    setSeen(value);
    setText(value);
  }

  return [text, setText];
}
