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
  onDeleteLayout,
}: {
  entries: ContentEntry[];
  /** The layouts the scenario holds and no base places, which are in the
   *  document and nowhere on the map (#1424). */
  layouts: LayoutEntry[];
  /** The entry the map's selection belongs to, as `contentsSelection` reads
   *  it, so clicking a unit lights up its entry here. */
  selected: string | null;
  /** The setup's participants, for the colour a team's things are drawn in. */
  participants: Participant[];
  onPick: (entry: ContentEntry) => void;
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
      <ul>
        {entries.map((entry) => {
          const Icon = ICONS[entry.kind];
          const current = entry.key === selected;
          return (
            <li key={entry.key}>
              <Button
                variant="ghost"
                aria-current={current || undefined}
                className={cn(
                  "h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal",
                  current && "bg-muted",
                )}
                onClick={() => onPick(entry)}
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
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {entry.detail}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>

      {layouts.length > 0 && (
        <UnplacedLayouts layouts={layouts} onDelete={onDeleteLayout} />
      )}
    </div>
  );
}

/**
 * The layouts this scenario is carrying and not placing.
 *
 * They belong here rather than in the list above because they are the one thing
 * a scenario holds that looking at the map cannot find: nothing on it is drawn
 * from them. A row therefore takes the camera nowhere and offers the one action
 * there is, which is throwing the layout away. Nothing else does that any more,
 * so a layout an author wants gone goes from here.
 */
function UnplacedLayouts({
  layouts,
  onDelete,
}: {
  layouts: LayoutEntry[];
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
            <Button
              size="sm"
              variant="ghost"
              className="size-7 shrink-0 p-0"
              aria-label={`Delete ${layout.name}`}
              title={`Delete ${layout.name}`}
              onClick={() => onDelete(layout)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <p className="px-2 py-1 text-[11px] text-muted-foreground">
        Kept in this scenario until you delete them. Edit one under Base
        blueprints below the map.
      </p>
    </section>
  );
}
