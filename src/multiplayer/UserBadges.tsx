import { cn } from "@picoframe/frame";
import { ChevronUp } from "lucide-react";

/**
 * Small per-user adornments for the lobby user list and battle roster: a country
 * flag (from ADDUSER) and a rank insignia (from ClientStatus). Both render nothing
 * when the data is absent/placeholder, so bots and not-yet-known users just show
 * their name — callers can drop them in unconditionally.
 */

/**
 * A country flag from an ISO 3166-1 alpha-2 code (the wire form, e.g. `GB`).
 * Returns null for the server's `??` placeholder, empty strings, and any value
 * that isn't two letters, so we never leave an empty flag box.
 */
export function CountryFlag({
  country,
  className,
}: {
  country: string;
  className?: string;
}) {
  const code = country.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return null;
  const label = code.toUpperCase();
  return (
    <span
      className={cn(
        `fi fi-${code}`,
        "shrink-0 rounded ring-1 ring-inset ring-foreground/15",
        className,
      )}
      // flag-icons keys size off font-size; pin it so the flag stays a mini
      // rectangle regardless of the surrounding text size.
      style={{ width: 18, height: 13 }}
      role="img"
      aria-label={`Country: ${label}`}
      title={label}
    />
  );
}

/** Colour tier for a rank (0-7): higher ranks get a warmer, brighter chevron. */
function rankColor(rank: number): string {
  if (rank >= 7) return "text-yellow-400";
  if (rank >= 5) return "text-amber-500";
  if (rank >= 3) return "text-sky-500";
  return "text-muted-foreground";
}

/**
 * Rank insignia: `rank` overlapping up-chevrons (server rank is 0-7). Rank 0
 * (new / not-yet-received status) renders nothing to keep the common case clean.
 */
export function RankBadge({
  rank,
  className,
}: {
  rank: number;
  className?: string;
}) {
  if (!Number.isFinite(rank) || rank < 1) return null;
  const n = Math.min(Math.trunc(rank), 7);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        rankColor(n),
        className,
      )}
      role="img"
      aria-label={`Rank ${n} of 7`}
      title={`Rank ${n}/7`}
    >
      {Array.from({ length: n }, (_, i) => (
        <ChevronUp
          // Static insignia; index key is stable for a given rank.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-order glyphs
          key={i}
          className="size-3 -ml-1.5 first:ml-0"
          strokeWidth={3}
        />
      ))}
    </span>
  );
}
