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
 *
 * The pack picker only appears once there is more than one pack installed.
 * With the bundled pack on its own there is nothing to choose between, and a
 * control with one option is noise.
 */

import { Button, cn, Input } from "@picoframe/frame";

import { ButtonGroup } from "@/components/ui/button-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { LoadedPack } from "../../pack";

/** Radix needs a non-empty value, so "every pack" gets one of its own. */
const EVERY_PACK = "all";

interface Props {
  pack: LoadedPack;
  query: string;
  onQuery: (query: string) => void;
  /** null means every category. */
  category: string | null;
  onCategory: (category: string | null) => void;
  /** null means every pack. */
  packId: string | null;
  onPackId: (packId: string | null) => void;
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
  packId,
  onPackId,
  shown,
  className,
}: Props) {
  const packs = pack.library.packs;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search parts"
        className="w-56"
        aria-label="Search parts"
      />
      {packs.length > 1 ? (
        <Select
          value={packId ?? EVERY_PACK}
          onValueChange={(value) =>
            onPackId(value === EVERY_PACK ? null : value)
          }
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Parts pack">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EVERY_PACK}>All packs</SelectItem>
            {packs.map((manifest) => (
              <SelectItem key={manifest.id} value={manifest.id}>
                {manifest.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
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

/**
 * Packs that could not be loaded, and where an extension pack goes.
 *
 * Shown rather than logged: the only person who can fix a pack that will not
 * load is whoever installed it, and they are looking at this screen.
 */
export function PackProblems({ pack }: { pack: LoadedPack }) {
  if (pack.library.problems.length === 0) return null;
  return (
    <ul className="border-b border-amber-500/40 bg-amber-500/5 px-6 py-2 text-xs text-muted-foreground">
      {pack.library.problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
      {pack.library.dir ? (
        <li>
          Extension packs live in <code>{pack.library.dir}</code>, one folder
          each.
        </li>
      ) : null}
    </ul>
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
