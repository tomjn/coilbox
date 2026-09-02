import { Input } from "@picoframe/frame";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

/**
 * Where a mission should go, typed in rather than stepped to (issue #2394).
 *
 * The two arrow buttons beside this box move a mission one place per press, so
 * mission 2 reaching position 9 is seven presses, and the row's drag handle is
 * no help at all to anyone without a pointer. This is the third way to reorder
 * and the only one that costs the same whether the mission is moving one place
 * or nine: type the position, press Enter.
 *
 * Enter commits and nothing else does. Leaving the box puts back the position
 * the mission is already at, because a half-typed 1 on the way to 10 must not
 * move anything when Tab takes the focus away. It also means focus is only
 * ever taken back after a move the author actually asked for.
 *
 * A number input rather than a text box, so a screen reader reads it as a spin
 * button with the list's own bounds on it, and so the up and down keys step
 * through positions without touching the value by hand.
 *
 * The move itself goes through the page's `moveTo`, the same call the arrows
 * and a dropped row make, so the three ways of reordering share one write.
 */
export function MissionPositionField({
  index,
  count,
  title,
  onMove,
  onSay,
}: {
  /** Where the mission is now, counting from zero. */
  index: number;
  /** How many missions the campaign has. */
  count: number;
  title: string;
  /** Move this mission to a position, counting from zero. */
  onMove: (to: number) => void;
  /** Say something in the mission list's live region. */
  onSay: (message: string) => void;
}) {
  const at = index + 1;
  const [typed, setTyped] = useState(String(at));

  // Put the box back to the position the mission is at whenever it changes,
  // however it changed: this box, an arrow, a dropped row, or another mission
  // being taken out from above this one. Adjusted during the render that
  // brings the new index in rather than in an effect, so the box never paints
  // a position the mission has already left.
  const [shown, setShown] = useState(at);
  if (shown !== at) {
    setShown(at);
    setTyped(String(at));
  }

  // The box a move was asked for from, given the focus back once the list has
  // been redrawn around the mission's new place. The issue asks for the
  // mission that moved to keep the focus, and reordering makes React move this
  // input's node to another place in the list, which is the kind of thing a
  // browser is free to treat as the node leaving the document and take the
  // focus off it for.
  //
  // Whether it does is the engine's business. On macOS, where this was
  // measured, the webview keeps the focus on the box with these two lines
  // taken out. Keeping them is what stops the promise resting on that.
  //
  // Taken from the key press rather than from a ref prop, because picoframe's
  // `Input` types its props as the plain input attributes and `ref` is not one
  // of them.
  // The position it was asked from goes with it, so the focus is only given
  // back once the list has actually redrawn around the mission's new place and
  // never on some other render.
  const box = useRef<{ el: HTMLInputElement; from: number } | null>(null);
  useEffect(() => {
    const moved = box.current;
    if (!moved || moved.from === index) return;
    box.current = null;
    moved.el.focus();
    // A number box has no selection to set, so this is only worth anything to
    // a browser that gives one. Where it does, the next position types
    // straight over the one just landed on.
    moved.el.select();
  }, [index]);

  // One refusal for everything that is not a position: a blank box, a word, a
  // fraction, a nought, and anything past the end of the list. They all mean
  // the same thing to the author, and they all leave the mission where it was.
  const refuse = () => {
    setTyped(String(at));
    onSay(`Give ${title} a position between 1 and ${count}.`);
  };

  const commit = (event: KeyboardEvent<HTMLInputElement>) => {
    const wanted = Number(typed.trim());
    if (typed.trim() === "" || !Number.isInteger(wanted)) return refuse();
    if (wanted < 1 || wanted > count) return refuse();
    if (wanted === at) {
      setTyped(String(at));
      onSay(`${title} is already at position ${at}.`);
      return;
    }
    box.current = { el: event.currentTarget, from: index };
    onMove(wanted - 1);
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
      <span aria-hidden="true">#</span>
      <Input
        type="number"
        min={1}
        max={count}
        // Named after what it does, the way the two arrows beside it are, so
        // the three read as one set of controls for the same mission.
        aria-label={`Move ${title} to position`}
        title="Type a position and press Enter"
        // A campaign of one has only the position the mission is already in,
        // which is why both its arrows are dead too.
        disabled={count < 2}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        // Anything other than Enter abandons what was typed. See above.
        onBlur={() => setTyped(String(at))}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(e);
        }}
        className="h-7 w-14 px-1.5 text-center text-xs"
      />
    </div>
  );
}
