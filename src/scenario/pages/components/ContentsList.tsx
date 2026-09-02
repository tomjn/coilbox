/**
 * The list of what a scenario has on its map, and the way into each entry.
 *
 * Picking an entry does the two things a click on the map does when it lands:
 * it selects the thing, so the bar for it opens, and it takes the camera to it,
 * so the thing is on screen. That is what makes this an answer to a placement
 * being a few pixels across (#830), and to a zone that no click can reach
 * because another zone's sheet answers first (#911), rather than another place
 * to read a name.
 *
 * Underneath is the other half of what a scenario holds: the layouts it is
 * carrying and not placing (#1424). Nothing on the map is drawn from those, so
 * this is the only place they can be seen or thrown away.
 *
 * What the list holds is `contents.ts`, which is tested. This is the picture of
 * it.
 */

import { Button, cn } from "@picoframe/frame";
import {
  Blocks,
  Factory,
  type LucideIcon,
  MapPin,
  Square,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { teamColor } from "@/placement/placements";
import { type Participant, rgbToHex } from "@/play/config";
import type { ContentEntry, ContentKind, LayoutEntry } from "./contents";

/** The same icons the mode strip puts on the mode that places each kind, so the
 *  list reads as the modes' own output. */
const ICONS: Record<ContentKind, LucideIcon> = {
  actor: User,
  group: Users,
  base: Factory,
  zone: Square,
};

export function ContentsList({
  entries,
  layouts,
  selected,
  participants,
  onPick,
  onToggle,
  onPlaceLayout,
  onDeleteLayout,
}: {
  entries: ContentEntry[];
  /** The layouts the scenario holds and no base places, which are in the
   *  document and nowhere on the map (#1424). */
  layouts: LayoutEntry[];
  /** Every entry the map's selection reaches, as `contentsSelection` reads each
   *  key, so clicking a unit lights up its entry here and a marquee round three
   *  bases lights three rows (issue #2279). */
  selected: ReadonlySet<string>;
  /** The setup's participants, for the colour a team's things are drawn in. */
  participants: Participant[];
  onPick: (entry: ContentEntry) => void;
  /**
   * Add this row to the selection, or take it back out (issue #2279).
   *
   * Shift on the row, which is the same gesture as a Shift-click on the map and
   * reaches the keyboard for nothing: a row is a button, and Shift with Enter or
   * Space on a focused button is a click carrying Shift like any other. That is
   * the way somebody who cannot use the marquee builds a selection.
   */
  onToggle: (entry: ContentEntry) => void;
  /** Arm the Layouts mode with this layout, so the next click on the map puts
   *  a base of it down (#1450). */
  onPlaceLayout: (layout: LayoutEntry) => void;
  onDeleteLayout: (layout: LayoutEntry) => void;
}) {
  if (entries.length === 0 && layouts.length === 0)
    return (
      <p className="p-2 text-xs text-muted-foreground">
        Nothing placed yet. Pick a mode above and click the map.
      </p>
    );

  return (
    <div className="max-h-80 overflow-y-auto">
      {entries.length > 0 && (
        <p className="px-2 py-1 text-[11px] text-muted-foreground">
          Shift-click a row to select it as well, rather than instead.
        </p>
      )}
      <ul>
        {entries.map((entry) => {
          const Icon = ICONS[entry.kind];
          const current = selected.has(entry.key);
          return (
            <li key={entry.key}>
              <Button
                variant="ghost"
                aria-current={current || undefined}
                className={cn(
                  "h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal",
                  current && "bg-muted",
                )}
                // Shift adds this row to the selection instead of replacing it,
                // and does not take the camera anywhere: an author picking six
                // things out of the list is not asking to be flown to each of
                // them (issue #2279).
                onClick={(event) =>
                  event.shiftKey ? onToggle(entry) : onPick(entry)
                }
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                {entry.team !== null && (
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full ring-1 ring-black/30"
                    style={{
                      background: rgbToHex(teamColor(participants, entry.team)),
                    }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-xs">
                  {entry.label}
                </span>
                {/* Said rather than only shown, because the tick is the one
                    thing on the row that says it is part of a selection an
                    author cannot see the whole of. */}
                {current && <span className="sr-only">selected</span>}
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {entry.detail}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>

      {layouts.length > 0 && (
        <UnplacedLayouts
          layouts={layouts}
          onPlace={onPlaceLayout}
          onDelete={onDeleteLayout}
        />
      )}
    </div>
  );
}

/**
 * The layouts this scenario is carrying and not placing.
 *
 * They belong here rather than in the list above because they are the one thing
 * a scenario holds that looking at the map cannot find: nothing on it is drawn
 * from them. A row therefore takes the camera nowhere, and offers the two
 * things there are to do with geometry nothing places: put it back, or throw it
 * away. Nothing else does either any more.
 *
 * Putting it back arms the Layouts mode rather than dropping a base at some
 * fixed point, because where a base stands is the whole reason the author
 * deleted it (#1450). The next click on the map is the placement.
 */
function UnplacedLayouts({
  layouts,
  onPlace,
  onDelete,
}: {
  layouts: LayoutEntry[];
  onPlace: (layout: LayoutEntry) => void;
  onDelete: (layout: LayoutEntry) => void;
}) {
  return (
    <section className="mt-1 border-t border-border/60 pt-1">
      <h3 className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
        Not placed
      </h3>
      <ul>
        {layouts.map((layout) => (
          <li
            key={layout.id}
            className="flex items-center gap-2 px-2 py-1.5 text-xs"
          >
            <Blocks className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{layout.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {layout.detail}
            </span>
            {/* gap-3 rather than the row's default gap-2: Delete has no
                confirmation, so it gets more room than the row's default
                spacing rather than the same amount (#2284). */}
            <div className="flex shrink-0 items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label={`Place ${layout.name}`}
                title={`Place ${layout.name} on the map`}
                // A layout with nothing in it would place a base that draws
                // nothing and can never be selected again.
                disabled={layout.empty}
                onClick={() => onPlace(layout)}
              >
                <MapPin className="size-3.5" />
              </Button>
              {/* Ghost-destructive, matching the row menu's delete item
                  (ScenarioRowMenu), so Delete reads as different from
                  Place. */}
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
                aria-label={`Delete ${layout.name}`}
                title={`Delete ${layout.name}`}
                onClick={() => onDelete(layout)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">
        Kept in this scenario until you delete them. Place one back on the map
        with the pin, or edit it under Base blueprints below the map.
      </p>
    </section>
  );
}
