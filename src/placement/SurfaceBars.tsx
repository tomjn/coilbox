/**
 * The bars that sit over the surface, in the ones both editors show (issue
 * #1416).
 *
 * A bar is what the surface has to say about what just happened on it: what is
 * selected and the two things a drag cannot do to it, and how far up a build
 * order being watched has got. Neither is about a mission, so neither belongs to
 * the scenario editor.
 *
 * The bars that are about a mission stay there: the one that says a path is
 * being drawn, the one that says a base is waiting to be moved, and the one for
 * a selected zone.
 *
 * Undo and redo are here for the same reason, though they sit in the corner
 * rather than in a bar: both editors have a history now (issue #1442), and one
 * pair of buttons means one answer to what they say when there is nowhere to go.
 */

import { Button } from "@picoframe/frame";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Redo2,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

import { modKeyLabel } from "@/scenario/pages/components/history";

/**
 * The way back from an edit, and forward again.
 *
 * Pressed far less often than the shortcut, which is why the shortcut is on the
 * button: this is the only place either editor says what the keyboard does. A
 * button with nowhere to go is disabled and says so, because the start of a
 * session is exactly where somebody reaches for undo first, and one that does
 * nothing silently reads as broken.
 */
export function HistoryControls({
  canUndo,
  canRedo,
  undo,
  redo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}) {
  const mod = modKeyLabel();
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="bg-card/80 px-2 backdrop-blur"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title={canUndo ? `Undo (${mod} Z)` : "Nothing to undo yet"}
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="bg-card/80 px-2 backdrop-blur"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title={canRedo ? `Redo (${mod} Shift Z)` : "Nothing to redo"}
      >
        <Redo2 className="size-3.5" />
      </Button>
    </>
  );
}

/**
 * What is selected, and the two things that can be done to it that a drag
 * cannot: turn it a quarter turn, and delete it.
 *
 * A group's units are spawned facing south together, so there is nothing to turn
 * on one, and the button says so rather than disappearing.
 */
export function SelectionBar({
  def,
  what,
  count,
  turnable,
  turnHint,
  onTurn,
  onTurnPreview,
  onDelete,
  children,
}: {
  /** The unit def of what was clicked. */
  def: string;
  /** What it is, in the caller's own words: "base building 3", "actor". */
  what: string;
  /**
   * How many things the two buttons will act on, when the surface holds more
   * than the one this bar names (issue #2279). Left out by a surface with one
   * selection, and then the buttons read as they always did.
   *
   * On the buttons rather than only in the bar's name, because a Delete that
   * says "Delete" and removes six things is a button that lied about itself.
   */
  count?: number;
  turnable: boolean;
  /** Why it cannot be turned, when it cannot. */
  turnHint?: string;
  onTurn: () => void;
  /**
   * Whether the turn is being considered, which is what draws where it would
   * put the building (issue #1541).
   *
   * A turn is a button press with nothing under the pointer, so the button
   * itself is the hover. Focus counts as well, because a turn taken from the
   * keyboard deserves the same warning as one taken with the mouse.
   */
  onTurnPreview?: (on: boolean) => void;
  onDelete: () => void;
  /** Controls for what kind of thing this is: an actor's team and its
   *  overrides, a base's queue, a layout's build order. */
  children?: ReactNode;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <span className="font-mono text-[11px]">
        {def}
        <span className="ml-1.5 text-muted-foreground">{what}</span>
      </span>
      {children}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={onTurn}
        disabled={!turnable}
        title={
          !turnable
            ? turnHint
            : count === undefined
              ? "Turn a quarter turn"
              : "Turn everything selected that turns a quarter turn. A group and a zone do not."
        }
        onPointerEnter={() => onTurnPreview?.(true)}
        onPointerLeave={() => onTurnPreview?.(false)}
        onFocus={() => onTurnPreview?.(true)}
        onBlur={() => onTurnPreview?.(false)}
      >
        <RotateCw className="size-3.5" /> Turn
        {count === undefined ? "" : " all"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
        onClick={onDelete}
        title={count === undefined ? undefined : `Delete all ${count} of them`}
      >
        <Trash2 className="size-3.5" /> Delete
        {count === undefined ? "" : ` ${count}`}
      </Button>
    </div>
  );
}

/**
 * What the outlined square beside a selected building means (issue #1541).
 *
 * The squares are the answer and this is what ties them to the button the
 * pointer is on. Both cases are said, because most buildings are square and a
 * turn leaves those exactly where they are: a control that draws something for
 * some buildings and nothing for others otherwise reads as broken.
 */
export function TurnNote({
  moves,
}: {
  /** Whether the turn would move the building at all. Null when nobody is
   *  considering a turn, and then nothing is said. */
  moves: boolean | null;
}) {
  if (moves === null) return null;
  return (
    <p className="w-fit rounded bg-card/70 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
      {moves
        ? "Turning it stands it on the outlined squares. Its sides swap, so it moves half a build square."
        : "Turning it leaves it on the same squares. Its footprint is square, so there is nowhere for it to move."}
    </p>
  );
}

/**
 * A build order being watched: how far up the layout is, and the way to move
 * along it (issue #1418).
 *
 * The surface is where this belongs rather than the popover that started it,
 * because what is being watched is the layout on the surface, and the popover
 * covers the corner of it. Stepping is always there beside the playing, because
 * the step somebody wants to look at is the one they want to stop on.
 */
export function PlaybackBar({
  step,
  total,
  def,
  playing,
  onStep,
  onPlaying,
  onDone,
}: {
  /** How many buildings are standing, so 0 is bare ground. */
  step: number;
  total: number;
  /** What the last step put down, for saying what just happened. */
  def: string;
  playing: boolean;
  onStep: (step: number) => void;
  onPlaying: (on: boolean) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-lime-400/60 bg-card/85 p-1 pl-2 backdrop-blur">
      <span className="text-[11px]">
        {step === 0 ? (
          <span className="text-muted-foreground">bare ground</span>
        ) : (
          <span className="font-mono">{def}</span>
        )}
        <span className="ml-1.5 text-muted-foreground">
          {step} of {total}
        </span>
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="size-7 p-0"
        aria-label="Back a step"
        disabled={step === 0}
        onClick={() => onStep(step - 1)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="size-7 p-0"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => onPlaying(!playing)}
      >
        {playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="size-7 p-0"
        aria-label="On a step, building the next one"
        disabled={step >= total}
        onClick={() => onStep(step + 1)}
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onDone}
      >
        Done
      </Button>
    </div>
  );
}
