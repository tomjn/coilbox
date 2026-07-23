import { Input } from "@picoframe/frame";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Shared filter bar for the content browsers: a name search box, a sort dropdown,
 * and a live "shown / total" count. Mirrors the downloads section's filter UX so
 * the two surfaces feel the same. Filtering itself lives in the pages (in-memory
 * over the scan results); this is presentation only.
 */
export function FilterBar({
  search,
  onSearch,
  searchPlaceholder,
  searchLabel,
  sort,
  onSort,
  sortOptions,
  total,
  shown,
  noun,
  trailing,
}: {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  searchLabel: string;
  sort: string;
  onSort: (v: string) => void;
  sortOptions: { value: string; label: string }[];
  total: number;
  shown: number;
  noun: string;
  /** An extra control (e.g. an origin filter) rendered at the end of this same
   * row — for a filter that, like sort, always applies rather than only when
   * some row happens to match it (see the toggle row below this one). */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative max-w-xs flex-1">
        <Search
          size={14}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchLabel}
          className="h-9 pl-7"
        />
      </div>
      <Select value={sort} onValueChange={onSort}>
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {trailing}
      <span className="text-sm text-muted-foreground">
        {search.trim() ? `${shown} / ${total}` : total} {noun}
      </span>
    </div>
  );
}
