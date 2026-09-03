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

import { ButtonGroup } from "@/components/ui/button-group";
import { modKeyLabel } from "@/scenario/pages/components/history";

/**
 * The way back from an edit, and forward again.
 *
 * Pressed far less often than the shortcut, which is why the shortcut is on the
 * button: this is the only place either editor says what the keyboard does. A
 * button with nowhere to go is disabled and says so, because the start of a
 * session is exactly where somebody reaches for undo first, and one that does
 * nothing silently reads as broken.
 *
 * One segmented pair rather than two buttons with a gap, and opaque rather than
 * a tint of the card over the map. A translucent control sitting on terrain
 * takes whatever is under it, so the same two buttons read differently over
 * grass and over snow, and the icon inside them goes with it.
 */
export function HistoryControls({
  canUndo,
  canRedo,
  undo,
  redo,
  vertical,
}: {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Stacked rather than side by side, for a surface that keeps them in a rail
   *  down the left edge instead of in the top corner. */
  vertical?: boolean;
}) {
  const mod = modKeyLabel();
  return (
    <ButtonGroup orientation={vertical ? "vertical" : "horizontal"}>
      <Button
        size={vertical ? "icon" : "sm"}
        variant="outline"
        className={vertical ? "bg-card" : "bg-card px-2"}
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title={canUndo ? `Undo (${mod} Z)` : "Nothing to undo yet"}
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        size={vertical ? "icon" : "sm"}
        variant="outline"
        className={vertical ? "bg-card" : "bg-card px-2"}
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title={canRedo ? `Redo (${mod} Shift Z)` : "Nothing to redo"}
      >
        <Redo2 className="size-3.5" />
      </Button>
    </ButtonGroup>
  );
}

/**
 * The two things that can be done to a selection that a drag cannot: turn it a
 * quarter turn, and delete it. Drawn as a group at the foot of the surface's
 * rail rather than as words in the bar that names the selection.
 *
 * They moved out of that bar because they are tools rather than facts. The bar
 * says what is selected, which changes as the selection does and is read. These
 * two are pressed, and a control that is pressed belongs where the other
 * pressable things are, at a place on screen that does not move when the
 * selection changes shape. The bar keeps the naming and the per-kind controls.
 *
 * Only drawn when something is selected, so the rail is the modes alone while
 * nothing is.
 *
 * A group's units are spawned facing south together, so there is nothing to
 * turn on one. That button is disabled with the reason on it rather than left
 * out, so the pair does not change size as the selection moves between kinds.
 */
export function SelectionTools({
  turnable,
  turnHint,
  count,
  deleteLabel = "Delete",
  onTurn,
  onTurnPreview,
  onDelete,
}: {
  /** Whether there is anything here that turns. A zone and a path point do
   *  not, and neither offers `onTurn` at all. */
  turnable: boolean;
  /** Why it cannot be turned, when it cannot. */
  turnHint?: string;
  /** How many things the buttons will act on, when it is more than one, so a
   *  Delete that removes six says six (issue #2279). */
  count?: number;
  /** What the delete is of, for its tooltip: a point on a path rather than the
   *  thing itself. */
  deleteLabel?: string;
  /** Left out by a selection with nothing to turn, and then only the delete is
   *  drawn. */
  onTurn?: () => void;
  onTurnPreview?: (on: boolean) => void;
  onDelete: () => void;
}) {
  const all = count === undefined ? "" : ` all ${count}`;

  return (
    <ButtonGroup orientation="vertical">
      {onTurn && (
        <Button
          size="icon"
          variant="outline"
          className="bg-card"
          onClick={onTurn}
          disabled={!turnable}
          aria-label={`Turn${all || " a quarter turn"}`}
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
          <RotateCw className="size-3.5" />
        </Button>
      )}
      <Button
        size="icon"
        variant="outline"
        className="bg-card text-destructive hover:text-destructive"
        onClick={onDelete}
        aria-label={`${deleteLabel}${all}`}
        title={
          count === undefined ? deleteLabel : `Delete all ${count} of them`
        }
      >
        <Trash2 className="size-3.5" />
      </Button>
    </ButtonGroup>
  );
}

/**
 * What is selected: what it is, and the controls for whatever kind of thing it
 * is.
 *
 * Turning and deleting are {@link SelectionTools} on a surface that has a rail
 * to put them in. A surface without one passes `onTurn` and `onDelete` here and
 * gets them in the bar, which is where both used to be for everybody.
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
  turnable?: boolean;
  /** Why it cannot be turned, when it cannot. */
  turnHint?: string;
  /** Left out by a surface whose rail carries the turn instead. */
  onTurn?: () => void;
  /**
   * Whether the turn is being considered, which is what draws where it would
   * put the building (issue #1541).
   *
   * A turn is a button press with nothing under the pointer, so the button
   * itself is the hover. Focus counts as well, because a turn taken from the
   * keyboard deserves the same warning as one taken with the mouse.
   */
  onTurnPreview?: (on: boolean) => void;
  /** Left out by a surface whose rail carries the delete instead. */
  onDelete?: () => void;
  /** Controls for what kind of thing this is: an actor's team and its
   *  overrides, a base's queue, a layout's build order. */
  children?: ReactNode;
}) {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-md border border-border/60 bg-card p-1 pl-2">
      <span className="font-mono text-[11px]">
        {def}
        <span className="ml-1.5 text-muted-foreground">{what}</span>
      </span>
      {children}
      {onTurn && (
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
      )}
      {onDelete && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          onClick={onDelete}
          title={
            count === undefined ? undefined : `Delete all ${count} of them`
          }
        >
          <Trash2 className="size-3.5" /> Delete
          {count === undefined ? "" : ` ${count}`}
        </Button>
      )}
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
