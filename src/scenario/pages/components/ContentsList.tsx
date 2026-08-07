/**
 * The list of what a scenario has on its map, and the way into each entry.
 *
 * Picking an entry does the two things a click on the map does when it lands:
 * it selects the thing, so the bar for it opens, and it takes the camera to it,
 * so the thing is on screen. That is what makes this an answer to a placement
 * being a few pixels across (#830) rather than another place to read a name.
 *
 * What the list holds is `contents.ts`, which is tested. This is the picture of
 * it.
 */

import { Button, cn } from "@picoframe/frame";
import { Factory, type LucideIcon, User, Users } from "lucide-react";
import { type Participant, rgbToHex } from "@/play/config";
import type { ContentEntry, ContentKind } from "./contents";
import { teamColor } from "./placements";

/** The same icons the mode strip puts on the mode that places each kind, so the
 *  list reads as the modes' own output. */
const ICONS: Record<ContentKind, LucideIcon> = {
  actor: User,
  group: Users,
  prefab: Factory,
};

export function ContentsList({
  entries,
  selected,
  participants,
  onPick,
}: {
  entries: ContentEntry[];
  /** The entry the map's selection belongs to, as `contentsSelection` reads
   *  it, so clicking a unit lights up its entry here. */
  selected: string | null;
  /** The setup's participants, for the colour a team's things are drawn in. */
  participants: Participant[];
  onPick: (entry: ContentEntry) => void;
}) {
  if (entries.length === 0)
    return (
      <p className="p-2 text-xs text-muted-foreground">
        Nothing placed yet. Pick a mode above and click the map.
      </p>
    );

  return (
    <ul className="max-h-80 overflow-y-auto">
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
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full ring-1 ring-black/30"
                style={{
                  background: rgbToHex(teamColor(participants, entry.team)),
                }}
              />
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
  );
}
