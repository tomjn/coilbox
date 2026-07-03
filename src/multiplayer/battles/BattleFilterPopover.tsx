import { Button, Input } from "@picoframe/frame";
import { SlidersHorizontal } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BattleFilters, BattleSortKey } from "./battleFilters";

const SORTS: { key: BattleSortKey; label: string }[] = [
  { key: "players", label: "Players" },
  { key: "map", label: "Map" },
  { key: "game", label: "Game" },
];

const DEFAULTS = {
  hideEmpty: false,
  hideLockedPassworded: false,
  hideFull: false,
  sortKey: "players",
  sortDir: "desc",
} satisfies Omit<BattleFilters, "search">;

/**
 * Consolidates search + sort + hide filters behind a single "Filters" popover so the
 * toolbar stays a single line (players rarely filter, and a battle list can get long).
 * The trigger badges the number of active filters (search + hides); inside are the
 * search box, two segmented groups (sort is single-select and toggles direction on
 * re-click; hide is multi-select), and a reset.
 */
export function BattleFilterPopover({
  filters,
  setFilters,
}: {
  filters: BattleFilters;
  setFilters: Dispatch<SetStateAction<BattleFilters>>;
}) {
  const hasSearch = filters.search.trim().length > 0;
  const badgeCount =
    Number(hasSearch) +
    Number(filters.hideEmpty) +
    Number(filters.hideLockedPassworded) +
    Number(filters.hideFull);
  const nonDefault =
    badgeCount > 0 ||
    filters.sortKey !== DEFAULTS.sortKey ||
    filters.sortDir !== DEFAULTS.sortDir;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={badgeCount > 0 ? "default" : "secondary"}
          className="h-9 shrink-0 gap-2 px-3"
          aria-label="Filters and sorting"
        >
          <SlidersHorizontal className="size-4" />
          Filters
          {badgeCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
              {badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Search</p>
          <Input
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
            placeholder="Title, map, host, or game"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">
            Sort by
          </legend>
          <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border">
            {SORTS.map((s) => {
              const active = s.key === filters.sortKey;
              return (
                <Segment
                  key={s.key}
                  active={active}
                  onClick={() =>
                    setFilters((f) =>
                      f.sortKey === s.key
                        ? {
                            ...f,
                            sortDir: f.sortDir === "desc" ? "asc" : "desc",
                          }
                        : { ...f, sortKey: s.key, sortDir: "desc" },
                    )
                  }
                >
                  {s.label}
                  {active && (filters.sortDir === "desc" ? " ↓" : " ↑")}
                </Segment>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">
            Hide
          </legend>
          <div className="flex divide-x divide-border overflow-hidden rounded-md border border-border">
            <Segment
              active={filters.hideEmpty}
              onClick={() =>
                setFilters((f) => ({ ...f, hideEmpty: !f.hideEmpty }))
              }
            >
              Empty
            </Segment>
            <Segment
              active={filters.hideLockedPassworded}
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  hideLockedPassworded: !f.hideLockedPassworded,
                }))
              }
            >
              Locked
            </Segment>
            <Segment
              active={filters.hideFull}
              onClick={() =>
                setFilters((f) => ({ ...f, hideFull: !f.hideFull }))
              }
            >
              Full
            </Segment>
          </div>
        </fieldset>

        {nonDefault && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() =>
              setFilters((f) => ({ ...f, ...DEFAULTS, search: "" }))
            }
          >
            Reset filters
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One cell of a segmented button group. */
function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 px-2 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );
}
