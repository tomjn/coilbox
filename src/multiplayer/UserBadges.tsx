import { cn } from "@picoframe/frame";
import { ChevronUp, Globe } from "lucide-react";
import type { Rating } from "./bindings";
import { ratingParts, ratingSummary } from "./rating";

/**
 * Small per-user adornments for the lobby user list and battle roster: a country
 * flag (from ADDUSER), a rank insignia (from ClientStatus) and a rating from
 * whichever server sent one (issue #2002). `CountryFlag` always
 * renders (a neutral placeholder when the country is unknown) so names in a list
 * stay aligned; `RankBadge` renders nothing for rank 0.
 */

/** Shared flag-slot dimensions (a mini rectangle, sized independent of surrounding
 * text) and rounded frame, used by both the real flag and the placeholder. */
const FLAG_SIZE = { width: 18, height: 13 } as const;
const FLAG_FRAME =
  "shrink-0 rounded-[4px] ring-1 ring-inset ring-foreground/15";

/**
 * A country flag from an ISO 3166-1 alpha-2 code (the wire form, e.g. `GB`). For the
 * server's `??` placeholder, empty strings, or anything that isn't two letters, a
 * neutral globe placeholder is shown instead of an empty gap.
 */
export function CountryFlag({
  country,
  className,
}: {
  country: string;
  className?: string;
}) {
  const code = country.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) {
    return (
      <span
        className={cn(
          FLAG_FRAME,
          "inline-flex items-center justify-center bg-muted text-muted-foreground",
          className,
        )}
        style={FLAG_SIZE}
        role="img"
        aria-label="Country: unknown"
        title="Unknown"
      >
        <Globe className="size-2.5" />
      </span>
    );
  }
  const label = code.toUpperCase();
  return (
    <span
      className={cn(`fi fi-${code}`, FLAG_FRAME, className)}
      style={FLAG_SIZE}
      role="img"
      aria-label={`Country: ${label}`}
      title={label}
    />
  );
}

/**
 * A player's rating, or nothing at all when the server sent none.
 *
 * Nothing is the normal case. Coilbox speaks to three kinds of server and only
 * Zero-K rates anybody, so this draws for a Zero-K connection and stays out of
 * the way everywhere else. A dash or a zero would read as a bad rating rather
 * than as an unrated player, which is why an absent rating is absent rather
 * than drawn empty.
 *
 * One number, because a roster row has space for one. Zero-K sends two that
 * mean different things, so the label names every one it has and the number on
 * screen is the first of them. See `ratingParts`.
 */
export function RatingBadge({
  rating,
  className,
}: {
  rating: Rating | undefined;
  className?: string;
}) {
  const parts = ratingParts(rating);
  const summary = ratingSummary(rating);
  const first = parts[0];
  if (!first || !summary) return null;
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground",
        className,
      )}
      role="img"
      aria-label={summary}
      title={summary}
    >
      {first.value}
    </span>
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
