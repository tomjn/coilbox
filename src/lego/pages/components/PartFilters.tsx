/**
 * Search box and colourway buttons for a parts grid.
 *
 * Shared by the parts browser and the builder's parts strip so both filter the
 * same way and read the same. The state lives in the caller, through
 * `usePartFilter`, because the caller is what needs the filtered list.
 */

import { Button, cn, Input } from "@picoframe/frame";

import { ButtonGroup } from "@/components/ui/button-group";

import type { LoadedPack } from "../../pack";

interface Props {
  pack: LoadedPack;
  query: string;
  onQuery: (query: string) => void;
  colourway: string | null;
  onColourway: (colourway: string | null) => void;
  /** How many the grid is showing, so the count follows the filter. */
  shown: number;
  className?: string;
}

export function PartFilters({
  pack,
  query,
  onQuery,
  colourway,
  onColourway,
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
          variant={colourway === null ? "default" : "outline"}
          onClick={() => onColourway(null)}
          aria-pressed={colourway === null}
        >
          All
        </Button>
        {pack.manifest.categories.map((category) => (
          <Button
            key={category.id}
            size="sm"
            variant={colourway === category.id ? "default" : "outline"}
            onClick={() => onColourway(category.id)}
            aria-pressed={colourway === category.id}
          >
            {category.label}
          </Button>
        ))}
      </ButtonGroup>
      <span className="ml-auto text-sm text-muted-foreground">
        {colourway
          ? `${shown} parts`
          : `${shown} shapes, ${pack.parts.length} parts in all`}
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
