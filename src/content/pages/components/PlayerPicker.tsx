import { cn, Input } from "@picoframe/frame";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { filterPlayers } from "@/content/stats";

/** One entry in the picker's player list. */
export interface PlayerPickerOption {
  name: string;
  games: number;
}

/**
 * A searchable player picker for the stats page (#496): a button showing the
 * current pick, opening a popover with a search box over the player list.
 * Replaces a plain `Select` dropdown, which becomes unusable once a library's
 * player list runs into the hundreds. Filtering reuses the pure
 * {@link filterPlayers} helper from `stats.ts` so it stays unit-testable
 * without a DOM. Modelled on the existing `DmPicker` combobox (popover +
 * search input + button list), the closest match already in the codebase, so
 * this reuses that pattern rather than adding the shadcn `command` component.
 */
export function PlayerPicker({
  id,
  value,
  onValueChange,
  players,
  className,
}: {
  id?: string;
  value: string;
  onValueChange: (name: string) => void;
  players: PlayerPickerOption[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const matches = useMemo(
    () => filterPlayers(players, query),
    [players, query],
  );

  function pick(name: string) {
    onValueChange(name);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            className,
          )}
        >
          <span className="truncate">{value || "Select player"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${players.length} player${players.length === 1 ? "" : "s"}…`}
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {matches.map((p) => (
            <li key={p.name}>
              <button
                type="button"
                onClick={() => pick(p.name)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0",
                    p.name === value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {p.games} game{p.games === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              No players match "{query}".
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
