/**
 * Search and category filtering for the module list (issue #3298).
 *
 * Follows `filterParts` in `filter.ts`: a module matches when every search term
 * appears in its name, its category or its tags. Category narrows on top of
 * that, and `null` means every category.
 *
 * A module with no category is "uncategorised". Filtering by it is the empty
 * string, so it cannot be mistaken for a category a user typed, because a
 * category is never saved empty. It is always listed when nothing is filtered.
 *
 * The category is free text so a game maker is not held to our list. The
 * starter list only seeds the choices, and the categories already in use are
 * offered beside it.
 */

import { useMemo, useState } from "react";

import type { LegoProject } from "./model";

/** The category filter value for modules that have none. */
export const UNCATEGORISED = "";

/** Offered when nothing is in use yet. The starter modules (#3299) use these. */
export const STARTER_CATEGORIES = [
  "Chassis",
  "Wheel",
  "Leg",
  "Turret",
  "Arm",
  "Detail",
];

function sameCategory(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function filterModules(
  modules: LegoProject[],
  query: string,
  category: string | null,
): LegoProject[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return modules.filter((module) => {
    if (category !== null) {
      if (category === UNCATEGORISED) {
        if (module.category) return false;
      } else if (!module.category || !sameCategory(module.category, category)) {
        return false;
      }
    }
    if (terms.length === 0) return true;
    const haystack =
      `${module.name} ${module.category ?? ""} ${(module.tags ?? []).join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** The distinct categories in use, sorted. The first spelling seen wins. */
export function categoriesInUse(modules: LegoProject[]): string[] {
  const seen: string[] = [];
  for (const module of modules) {
    const category = module.category;
    if (category && !seen.some((c) => sameCategory(c, category))) {
      seen.push(category);
    }
  }
  return seen.sort((a, b) => a.localeCompare(b));
}

/** The starter categories plus any others in use, for the category field. */
export function categorySuggestions(modules: LegoProject[]): string[] {
  const all = [...STARTER_CATEGORIES];
  for (const category of categoriesInUse(modules)) {
    if (!all.some((c) => sameCategory(c, category))) all.push(category);
  }
  return all;
}

/**
 * A typed category, tidied. Reuses the spelling already in use so "turret" and
 * "Turret" do not become two categories. Blank means none.
 */
export function canonicalCategory(
  typed: string,
  modules: LegoProject[],
): string | undefined {
  const trimmed = typed.trim();
  if (trimmed === "") return undefined;
  return (
    categorySuggestions(modules).find((c) => sameCategory(c, trimmed)) ??
    trimmed
  );
}

/** Comma separated tags, trimmed, without blanks or repeats. */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.trim();
    if (tag && !tags.some((t) => sameCategory(t, tag))) tags.push(tag);
  }
  return tags;
}

/** A module with its category and tags set. Empty ones leave the document. */
export function withLabels(
  module: LegoProject,
  labels: { category: string | undefined; tags: string[] },
): LegoProject {
  const { category: _category, tags: _tags, ...rest } = module;
  return {
    ...rest,
    ...(labels.category ? { category: labels.category } : {}),
    ...(labels.tags.length > 0 ? { tags: labels.tags } : {}),
  };
}

export interface ModuleFilter {
  query: string;
  setQuery: (query: string) => void;
  /** null means every category, `UNCATEGORISED` means none. */
  category: string | null;
  setCategory: (category: string | null) => void;
  /** What is left after the search and the category. */
  modules: LegoProject[];
}

/** Filter state and its result for the module list. */
export function useModuleFilter(compounds: LegoProject[]): ModuleFilter {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const modules = useMemo(
    () => filterModules(compounds, query, category),
    [compounds, query, category],
  );
  return { query, setQuery, category, setCategory, modules };
}
