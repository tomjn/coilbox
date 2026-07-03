import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn, versionLabel } from "@/lib/utils";
import { GameArt } from "./GameArt";
import { SddBadge } from "./SddBadge";
import { WarningIcon } from "./states";

/**
 * The shared visual shell for every game card — the Games grid card, the
 * Singleplayer picker card, and the picker-drawer tiles. A 16:9 art region is
 * pinned to the top (`shrink-0`) with a solid caption band below that grows to
 * fill the card's height (`flex-1`), so cards in a row stay aligned whether or
 * not a game has a version. Mirrors the Maps card layout.
 *
 * Every game card renders identically through this shell; they differ only in
 * their click behaviour (the stretched `children` overlay) and whether they
 * carry a trailing `action` (e.g. Play / Choose game). Pass state-dependent
 * outline classes (selection) via `className`.
 */
export function GameCardShell({
  name,
  title,
  artUrl,
  alt,
  version,
  sdd,
  warnings,
  loading,
  selected,
  art,
  action,
  className,
  artClassName,
  children,
}: {
  /** Game name; seeds the deterministic gradient placeholder. */
  name: string;
  /** Display title (branding title or the game name). */
  title: string;
  artUrl?: string;
  alt: string;
  version?: string | null;
  sdd?: boolean;
  warnings?: string[] | null;
  loading?: boolean;
  /** Marks this as the current selection with a check badge (picker tiles). */
  selected?: boolean;
  /** Overrides the art layer (e.g. the picker's empty-state placeholder). */
  art?: ReactNode;
  /** Trailing caption control (Play button, Choose-game chip). */
  action?: ReactNode;
  className?: string;
  /** Overrides the art region's aspect/height (default `aspect-video`). */
  artClassName?: string;
  /** Stretched interactive overlay (a `Link` or `button`). */
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border border-border/50 bg-card text-left transition-colors hover:border-border hover:bg-accent/50 hover:shadow-md",
        className,
      )}
    >
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-t-lg",
          artClassName ?? "aspect-video",
        )}
      >
        {art ?? <GameArt name={name} artUrl={artUrl} alt={alt} />}
        {loading && (
          <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />
        )}
        {selected && (
          <div
            className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background"
            aria-hidden
          >
            <Check className="size-4" />
          </div>
        )}
      </div>
      {children}
      <div className="flex flex-1 items-center justify-between gap-2 p-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold" title={title}>
              {title}
            </p>
            {sdd && <SddBadge />}
            {warnings?.length ? <WarningIcon warnings={warnings} /> : null}
          </div>
          {version && (
            <span className="text-xs text-muted-foreground">
              {versionLabel(version)}
            </span>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}
