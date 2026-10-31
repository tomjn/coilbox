import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { SlidersHorizontal } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BattleFilters, BattleSortKey } from "./battleFilters";

/** Shared styling so the sort + hide groups keep the original segmented look. */
const GROUP_CLASS =
  "w-full divide-x divide-border overflow-hidden border border-border";
const ITEM_CLASS =
  "h-auto flex-1 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground";

const SORT_KEYS: BattleSortKey[] = ["players", "map", "game"];

const DEFAULTS = {
  hideEmpty: false,
  hideLockedPassworded: false,
  hideFull: false,
  hideOpenAnnihilation: false,
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
  const { t } = useLingui();
  const sortLabels: Partial<Record<BattleSortKey, string>> = {
    players: t`Players`,
    map: t`Map`,
    game: t`Game`,
  };
  const hasSearch = filters.search.trim().length > 0;
  const badgeCount =
    Number(hasSearch) +
    Number(filters.hideEmpty) +
    Number(filters.hideLockedPassworded) +
    Number(filters.hideFull) +
    Number(filters.hideOpenAnnihilation);
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
          aria-label={t`Filters and sorting`}
        >
          <SlidersHorizontal className="size-4" />
          <Trans>Filters</Trans>
          {badgeCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
              {badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            <Trans>Search</Trans>
          </p>
          <Input
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
            placeholder={t`Title, map, host, or game`}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">
            <Trans>Sort by</Trans>
          </legend>
          <ToggleGroup
            type="single"
            value={filters.sortKey}
            onValueChange={(v) =>
              setFilters((f) =>
                !v || v === f.sortKey
                  ? { ...f, sortDir: f.sortDir === "desc" ? "asc" : "desc" }
                  : { ...f, sortKey: v as BattleSortKey, sortDir: "desc" },
              )
            }
            className={GROUP_CLASS}
          >
            {SORT_KEYS.map((key) => {
              const active = key === filters.sortKey;
              return (
                <ToggleGroupItem key={key} value={key} className={ITEM_CLASS}>
                  {sortLabels[key]}
                  {active && (filters.sortDir === "desc" ? " ↓" : " ↑")}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">
            <Trans>Hide</Trans>
          </legend>
          <ToggleGroup
            type="multiple"
            value={[
              ...(filters.hideEmpty ? ["empty"] : []),
              ...(filters.hideLockedPassworded ? ["locked"] : []),
              ...(filters.hideFull ? ["full"] : []),
              ...(filters.hideOpenAnnihilation ? ["oa"] : []),
            ]}
            onValueChange={(vals) =>
              setFilters((f) => ({
                ...f,
                hideEmpty: vals.includes("empty"),
                hideLockedPassworded: vals.includes("locked"),
                hideFull: vals.includes("full"),
                hideOpenAnnihilation: vals.includes("oa"),
              }))
            }
            className={GROUP_CLASS}
          >
            <ToggleGroupItem value="empty" className={ITEM_CLASS}>
              <Trans>Empty</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="locked" className={ITEM_CLASS}>
              <Trans>Locked</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="full" className={ITEM_CLASS}>
              <Trans>Full</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="oa" className={ITEM_CLASS}>
              <Trans>Open Annihilation</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        </fieldset>

        {nonDefault && (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() =>
              setFilters((f) => ({ ...f, ...DEFAULTS, search: "" }))
            }
          >
            <Trans>Reset filters</Trans>
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
