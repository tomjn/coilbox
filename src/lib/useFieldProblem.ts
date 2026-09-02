import { useId, useState } from "react";

/**
 * Why a field's box just put back what was in it, held next to `useFieldText`
 * for the fields that need to say why a value was refused (issue #2275).
 *
 * A rejection is not a typo the box can quietly absorb: the author typed
 * something, the box now shows something else, and nothing on screen says
 * why unless this does. The reason is kept until the field is edited again,
 * because `onChange` is the moment the refused value stops being what the box
 * is about. A timer would risk clearing it before it is read, and never
 * clearing it would make it furniture the author has to dismiss by hand.
 *
 * `describedBy` is returned unconditionally so a field always has
 * `aria-describedby` pointed at its message paragraph, whether or not there
 * is one to read. The paragraph itself has to stay mounted for that to work:
 * a live region only reliably announces text that changes in an element
 * already in the DOM, the same lesson `SaveStatus` documents.
 */
export function useFieldProblem(): {
  problem: string | null;
  /** Show a reason and mark the field invalid. */
  refuse: (reason: string) => void;
  /** Clear the reason, because the field is no longer showing what it was about. */
  clear: () => void;
  /** The id of this field's message paragraph, for `aria-describedby`. */
  describedBy: string;
} {
  const id = useId();
  const [problem, setProblem] = useState<string | null>(null);

  return {
    problem,
    refuse: setProblem,
    clear: () => setProblem(null),
    describedBy: id,
  };
}
