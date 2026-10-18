/**
 * Search box and category filter for the module list (issue #3298).
 *
 * The same row as `PartFilters` has for parts, with a category menu in place
 * of the buttons because a category here is whatever a game maker typed, so
 * there is no fixed set to lay out. Only categories in use are offered.
 */

import { cn, Input } from "@picoframe/frame";
import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { LegoProject } from "../../model";
import { categoriesInUse, UNCATEGORISED } from "../../moduleFilter";

/** Radix needs a non-empty value, so each fixed choice gets one of its own,
 *  and a typed category is prefixed so it can never collide with them. */
const EVERY_CATEGORY = "all";
const NONE = "none";
const PREFIX = "category:";

interface Props {
  compounds: LegoProject[];
  query: string;
  onQuery: (query: string) => void;
  /** null means every category, `UNCATEGORISED` means none. */
  category: string | null;
  onCategory: (category: string | null) => void;
  /** How many the grid is showing, so the count follows the filter. */
  shown: number;
  /** After the count, such as the load from file button. */
  trailing?: ReactNode;
  className?: string;
}

function toValue(category: string | null): string {
  if (category === null) return EVERY_CATEGORY;
  return category === UNCATEGORISED ? NONE : PREFIX + category;
}

function fromValue(value: string): string | null {
  if (value === EVERY_CATEGORY) return null;
  return value === NONE ? UNCATEGORISED : value.slice(PREFIX.length);
}

export function ModuleFilters({
  compounds,
  query,
  onQuery,
  category,
  onCategory,
  shown,
  trailing,
  className,
}: Props) {
  const used = categoriesInUse(compounds);
  const hasUncategorised = compounds.some((c) => !c.category);
  return (
    // One line that gives up width before it wraps (#4467): a container, so a
    // trailing load button can drop its words, with the search box and the menu
    // shrinking to a floor. Its own floor is about what that leaves, so the row
    // around it wraps it whole before it would overflow.
    <div
      className={cn(
        "@container flex min-w-100 flex-nowrap items-center gap-2",
        className,
      )}
    >
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Search modules"
        className="w-56 min-w-32"
        aria-label="Search modules"
      />
      <Select
        value={toValue(category)}
        onValueChange={(value) => onCategory(fromValue(value))}
      >
        <SelectTrigger
          size="sm"
          className="w-44 min-w-32"
          aria-label="Module category"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EVERY_CATEGORY}>All categories</SelectItem>
          {used.map((name) => (
            <SelectItem key={name} value={PREFIX + name}>
              {name}
            </SelectItem>
          ))}
          {hasUncategorised || category === UNCATEGORISED ? (
            <SelectItem value={NONE}>Uncategorised</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <span className="ml-auto shrink-0 whitespace-nowrap text-sm text-muted-foreground">
        {shown} {shown === 1 ? "module" : "modules"}
      </span>
      {trailing}
    </div>
  );
}

/** Shown in place of the grid when a filter hides every module. */
export function NoModuleMatches() {
  return (
    <p className="flex-1 px-6 py-10 text-center text-sm text-muted-foreground">
      No module matches. Clear the search or pick another category.
    </p>
  );
}
