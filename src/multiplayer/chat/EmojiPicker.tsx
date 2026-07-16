import { Button, cn, Input } from "@picoframe/frame";
import { Smile } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EMOJI_GROUPS, type EmojiEntry, emojiGroup, loadEmoji } from "./emoji";
import { emojiMatches } from "./emojiMenu";

/** How many search hits the grid shows. Deep enough that a real search reaches
 * what it's after, shallow enough not to mount the whole dataset for `:a`. */
const MAX_RESULTS = 48;

const SKELETON_CELLS = Array.from({ length: 40 }, (_, i) => `cell-${i}`);

/** Rendered while the dataset loads: the picker is a grid either way, so the
 * popover doesn't resize under the pointer once the emoji arrive. */
function PickerSkeleton() {
  return (
    <div className="grid grid-cols-8 gap-0.5" aria-hidden="true">
      {SKELETON_CELLS.map((cell) => (
        <Skeleton key={cell} className="size-8 rounded-md" />
      ))}
    </div>
  );
}

export interface EmojiPickerProps {
  /** Insert the picked character at the composer's caret. */
  onPick: (unicode: string) => void;
  disabled?: boolean;
}

/**
 * The composer's emoji button (issue #283): a popover with a search box and one
 * grid per group.
 *
 * Only the open group is mounted. Rendering all ~1800 at once is a visible stall
 * in the webviews we ship on, and the tabs are the same answer every other chat
 * client landed on anyway.
 */
export function EmojiPicker({ onPick, disabled = false }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<EmojiEntry[] | null>(null);
  const [group, setGroup] = useState(EMOJI_GROUPS[0].group);
  const [search, setSearch] = useState("");

  // The dataset loads with the first open rather than with the composer: most
  // messages never involve the picker. `loadEmoji` caches, so a reopen (or the
  // `:` menu having loaded it already) is free.
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadEmoji().then((loaded) => {
      if (live) setEntries(loaded);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const query = search.trim();
  let shown: EmojiEntry[] = [];
  if (entries) {
    shown = query
      ? emojiMatches(query, entries, MAX_RESULTS)
      : emojiGroup(entries, group);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // A stale search would otherwise be what greets the next open.
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          disabled={disabled}
          variant="ghost"
          size="icon"
          aria-label="Emoji"
          title="Emoji"
          className="size-7 shrink-0 rounded-md text-muted-foreground"
        >
          <Smile className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="mb-2 h-8"
        />
        {!query && (
          <ToggleGroup
            type="single"
            value={group}
            // Radix hands back a bare string, and clears it when the open tab is
            // pressed again; a picker with no group open has nothing to show, so
            // only a value that names a real group counts.
            onValueChange={(next) => {
              const picked = EMOJI_GROUPS.find((g) => g.group === next);
              if (picked) setGroup(picked.group);
            }}
            spacing={1}
            className="mb-2 w-full"
          >
            {EMOJI_GROUPS.map((g) => (
              <ToggleGroupItem
                key={g.group}
                value={g.group}
                aria-label={g.label}
                title={g.label}
                // The tabs divide the row rather than taking a fixed width:
                // nine 32px tabs plus their gaps are wider than the popover, and
                // any width that fits today is one group away from not fitting.
                className="h-8 min-w-0 flex-1 px-0 text-base"
              >
                {g.icon}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <div className="h-56 overflow-y-auto">
          {entries === null ? (
            <PickerSkeleton />
          ) : shown.length === 0 ? (
            <p className="px-1 py-4 text-center text-sm text-muted-foreground">
              No emoji match "{query}".
            </p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {shown.map((entry) => (
                <button
                  key={entry.unicode}
                  type="button"
                  onClick={() => {
                    onPick(entry.unicode);
                    setOpen(false);
                  }}
                  aria-label={entry.label}
                  title={`:${entry.shortcodes[0]}:`}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md text-lg leading-none",
                    "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {entry.unicode}
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
