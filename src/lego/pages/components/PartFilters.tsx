/**
 * Search box, pack menu and colourway menu for a parts grid, as the builder's
 * Change part drawer has it.
 *
 * The state lives in the caller, through `usePartFilter`, because the caller is
 * what needs the filtered list.
 *
 * A shape offered in grey, tan and green is three parts, not one shape with a
 * colour option: each has its own texture, so each is independent inventory.
 * Category narrows which of them match, and "All" is a genuine all.
 *
 * The pack picker only appears once there is more than one pack installed.
 * With the bundled pack on its own there is nothing to choose between, and a
 * control with one option is noise.
 */

import { cn, Input } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useColourwayColours } from "../../colourwayColours";
import {
  categoryFromValue,
  categoryMenu,
  categoryOf,
  categoryValue,
} from "../../inventoryCategory";
import type { LoadedPack } from "../../pack";
import { CategoryMenu } from "./CategoryMenu";

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
  const colours = useColourwayColours(pack);
  const current = categoryOf(category, null);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search parts"
        className="w-56 min-w-32 flex-1"
        aria-label="Search parts"
      />
      <PackSelect
        pack={pack}
        packId={packId}
        onPackId={onPackId}
        className="w-44 shrink-0"
      />
      <CategoryMenu
        groups={categoryMenu({
          kind: "parts",
          pack,
          compounds: [],
          current,
          shapes: false,
        })}
        value={categoryValue(current)}
        onValueChange={(value) => {
          const next = categoryFromValue(value);
          onCategory(next?.kind === "colourway" ? next.id : null);
        }}
        colours={colours}
      />
      <span className="ml-auto shrink-0 whitespace-nowrap text-sm text-muted-foreground">
        {shown} {shown === 1 ? "part" : "parts"}
      </span>
    </div>
  );
}

/**
 * Which pack's parts to list. Nothing while only one pack is installed.
 */
export function PackSelect({
  pack,
  packId,
  onPackId,
  disabled,
  className,
}: {
  pack: LoadedPack;
  /** null means every pack. */
  packId: string | null;
  onPackId: (packId: string | null) => void;
  /** For a tab with no parts, which keeps the menu in its place. */
  disabled?: boolean;
  className?: string;
}) {
  const packs = pack.library.packs;
  if (packs.length < 2) return null;
  return (
    <Select
      value={packId ?? EVERY_PACK}
      onValueChange={(value) => onPackId(value === EVERY_PACK ? null : value)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={className} aria-label="Parts pack">
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
    <Alert variant="warning">
      <TriangleAlert />
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {pack.library.problems.map((problem) => (
            <li key={problem} className="break-words">
              {problem}
            </li>
          ))}
          {pack.library.dir ? (
            <li className="break-words">
              Extension packs live in <code>{pack.library.dir}</code>, one
              folder each.
            </li>
          ) : null}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The atlases installed, so it is clear which a unit can be built against.
 *
 * Only when there is more than one: with the bundled atlas on its own there is
 * nothing to tell apart. Separate from the pack filter above, because an atlas
 * pack has no parts to filter by. Which atlas a unit uses is chosen on the unit,
 * not here.
 */
export function PackAtlases({ pack }: { pack: LoadedPack }) {
  const atlases = pack.library.atlases;
  if (atlases.length < 2) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {atlases.length} atlases installed, and a unit samples one of them:{" "}
      {atlases.map((atlas, index) => (
        <span key={atlas.tex1}>
          {index > 0 ? ", " : null}
          {atlas.packId} (<code>{atlas.tex1}</code>)
        </span>
      ))}
      .
    </p>
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
