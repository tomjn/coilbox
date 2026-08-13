/**
 * The controls that belong to a layout rather than to a base (issue #1416).
 *
 * A base on a map has a team, an origin, a trigger addressable id and a factory
 * queue. None of those travel with the layout, so none of them are here. What is
 * here is everything an author says about the shape itself: what it is called,
 * whether the order it is in was meant, and which of its buildings are standing
 * on ground another one wants.
 *
 * Both editors use these. That is what stops a blueprint edited on a map and one
 * edited on bare ground being two different things with two different sets of
 * rules.
 */

import { Button, cn, Input } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  ListOrdered,
  Play,
} from "lucide-react";
import { useState } from "react";

import { buildOrderText } from "@/blueprint/order";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

/**
 * What the layout is called, which is what a picker will list it by.
 *
 * Local while it is typed and committed when the box is left, because every edit
 * either editor makes is written to disk. Seeded on mount, so mounting it inside
 * a popover shows the current name each time the popover is opened.
 */
export function LayoutNameField({
  id,
  name,
  onRename,
}: {
  /** Distinct per mounting, so the label points at this box and not another. */
  id: string;
  name: string;
  onRename: (name: string) => void;
}) {
  const [text, setText] = useState(name);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium">
        Layout name
      </Label>
      <Input
        id={id}
        value={text}
        placeholder="What this layout is called"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text.trim() ? onRename(text) : setText(name))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-8 text-xs"
      />
    </div>
  );
}

/** Buildings named by their place in the layout, the way an author counts
 *  them. */
function listed(at: number[]): string {
  return at.map((n) => n + 1).join(", ");
}

/**
 * Which of a layout's buildings cannot be built where they stand, which of them
 * the ground will not take, and which of its defs are not buildings at all.
 *
 * All of it is true of the layout wherever it is drawn, so all of it is said the
 * same way in both editors. Nothing is said when there is nothing wrong, which
 * includes the standalone editor: there is no map there, so nothing knows
 * anything about the ground and `unstable` is empty.
 */
export function LayoutNotes({
  overlaps,
  unstable,
  designedFor,
  onMap,
  strays,
}: {
  /** Buildings standing on ground another building wants, by their place in the
   *  layout. Drawn in red on the surface as well. */
  overlaps: number[];
  /** Buildings the map's terrain will not take, by their place in the layout.
   *  Drawn in amber on the surface as well. Empty where there is no map to
   *  check against, which is not the same as everything being fine. */
  unstable?: number[];
  /** The map this layout was drawn on, when it says. */
  designedFor?: string;
  /** The map it is standing on now, when it is standing on one. */
  onMap?: string;
  /** Defs in the layout the game does not call buildings. */
  strays: string[];
}) {
  const elsewhere =
    designedFor !== undefined &&
    designedFor !== "" &&
    onMap !== undefined &&
    onMap !== "" &&
    designedFor !== onMap;

  return (
    <>
      {overlaps.length > 0 && (
        <p className="rounded bg-red-950/60 px-2 py-1.5 text-[11px] text-red-200">
          Building{overlaps.length === 1 ? " " : "s "}
          {listed(overlaps)} stand
          {overlaps.length === 1 ? "s" : ""} on ground another building wants,
          marked in red. The engine builds one of them and refuses the rest.
        </p>
      )}

      {unstable !== undefined && unstable.length > 0 && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
          Building{unstable.length === 1 ? " " : "s "}
          {listed(unstable)} stand
          {unstable.length === 1 ? "s" : ""} on ground too steep for
          {unstable.length === 1 ? " it" : " them"}, marked in amber. The engine
          refuses to build on a slope past what the unit allows.
        </p>
      )}

      {elsewhere && (
        <p className="rounded bg-slate-800/70 px-2 py-1.5 text-[11px] text-slate-300">
          Drawn for {designedFor}. A layout shaped around one map's terrain does
          not always fit another's.
        </p>
      )}

      {strays.length > 0 && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
          {strays.join(", ")} {strays.length === 1 ? "is" : "are"} not a
          building in this game, so {strays.length === 1 ? "it" : "they"} will
          spawn off the build grid. Mobile units belong in a group or as an
          actor.
        </p>
      )}
    </>
  );
}

/**
 * What this layout is built in, and whether that is a claim or an accident.
 *
 * The list is the layout's own array, so moving a building up the list is the
 * whole of changing a build order. There is nothing else holding a sequence that
 * this could be out of step with.
 *
 * Off, the list is not shown at all. A layout whose order nobody meant has an
 * order all the same, and drawing it as steps would invite an author to read one
 * into what is only the order they happened to click in.
 */
export function BuildOrderPopover({
  buildings,
  index,
  ordered,
  onOrdered,
  onMoveBuilding,
  onPlay,
}: {
  buildings: { def: string }[];
  /** Which building is selected, shown in green so a step can be found on the
   *  surface. -1 when nothing is. */
  index: number;
  ordered: boolean;
  onOrdered: (on: boolean) => void;
  onMoveBuilding: (index: number, delta: number) => void;
  onPlay: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        buildOrderText({ ordered, buildings }),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard may be unavailable. Nothing is lost: the order is on
      // screen and the document holds it.
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
          <ListOrdered className="size-3.5" />
          {ordered ? `Build order · ${buildings.length} steps` : "Build order"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="layout-ordered" className="text-xs font-medium">
            Build these in this order
          </Label>
          <Switch
            id="layout-ordered"
            checked={ordered}
            onCheckedChange={onOrdered}
          />
        </div>

        {ordered ? (
          <>
            <ol className="max-h-56 space-y-1.5 overflow-y-auto">
              {buildings.map((building, at) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: a layout holds the same building twice as often as not, and where it stands in the order is the only thing naming it
                  key={`${at}-${building.def}`}
                  className="flex items-center gap-2"
                >
                  <span className="w-4 shrink-0 text-right text-[11px] text-muted-foreground">
                    {at + 1}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-xs",
                      at === index && "text-lime-300",
                    )}
                  >
                    {building.def}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-7 p-0"
                    aria-label={`Build ${building.def} sooner`}
                    disabled={at === 0}
                    onClick={() => onMoveBuilding(at, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="size-7 p-0"
                    aria-label={`Build ${building.def} later`}
                    disabled={at === buildings.length - 1}
                    onClick={() => onMoveBuilding(at, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ol>

            <p className="text-[11px] text-muted-foreground">
              The selected building is the one in green. The order is the layout
              itself, so a base placed from it anywhere is built the same way.
            </p>

            <div className="flex items-center gap-1.5 border-t border-border/60 pt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 gap-1.5 px-2 text-xs"
                onClick={onPlay}
                disabled={buildings.length < 2}
              >
                <Play className="size-3.5" /> Watch it go up
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 flex-1 gap-1.5 px-2 text-xs"
                onClick={copy}
              >
                <ClipboardCopy className="size-3.5" />
                {copied ? "Copied" : "Copy as a build order"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            These buildings are in the order they were clicked, which is not an
            opening. Turn this on to say what gets built first, and the layout
            becomes a build order that can be followed, watched and shared.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
