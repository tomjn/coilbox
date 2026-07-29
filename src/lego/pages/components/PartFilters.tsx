/**
 * Search box and category buttons for a parts grid.
 *
 * Shared by the parts browser and the builder's parts strip so both filter the
 * same way and read the same. The state lives in the caller, through
 * `usePartFilter`, because the caller is what needs the filtered list.
 *
 * A shape offered in grey, tan and green is three parts, not one shape with a
 * colour option: each has its own texture, so each is independent inventory.
 * Category narrows which of them match, and "All" is a genuine all.
 */

import { Button, cn, Input } from "@picoframe/frame";

import { ButtonGroup } from "@/components/ui/button-group";

import type { LoadedPack } from "../../pack";

interface Props {
  pack: LoadedPack;
  query: string;
  onQuery: (query: string) => void;
  /** null means every category. */
  category: string | null;
  onCategory: (category: string | null) => void;
  /** How many the grid is showing, so the count follows the filter. */
  shown: number;
  className?: string;
}

export function PartFilters({
  pack,
  query,
  onQuery,
  category,
  onCategory,
  shown,
  className,
}: Props) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search parts"
        className="w-56"
        aria-label="Search parts"
      />
      <ButtonGroup>
        <Button
          size="sm"
          variant={category === null ? "default" : "outline"}
          onClick={() => onCategory(null)}
          aria-pressed={category === null}
        >
          All
        </Button>
        {pack.manifest.categories.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant={category === c.id ? "default" : "outline"}
            onClick={() => onCategory(c.id)}
            aria-pressed={category === c.id}
          >
            {c.label}
          </Button>
        ))}
      </ButtonGroup>
      <span className="ml-auto text-sm text-muted-foreground">
        {shown} parts
      </span>
    </div>
  );
}

/** Shown in place of the grid when nothing matches. */
export function NoMatches() {
  return (
    <p className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
      Nothing matches. Try a shape like "beam", a size like "tiny", or clear the
      search.
    </p>
  );
}
