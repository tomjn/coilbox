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
 */

import { Button } from "@picoframe/frame";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCw,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

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
  turnable,
  turnHint,
  onTurn,
  onDelete,
  children,
}: {
  /** The unit def of what was clicked. */
  def: string;
  /** What it is, in the caller's own words: "base building 3", "actor". */
  what: string;
  turnable: boolean;
  /** Why it cannot be turned, when it cannot. */
  turnHint?: string;
  onTurn: () => void;
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
        title={turnable ? "Turn a quarter turn" : turnHint}
      >
        <RotateCw className="size-3.5" /> Turn
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" /> Delete
      </Button>
    </div>
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
