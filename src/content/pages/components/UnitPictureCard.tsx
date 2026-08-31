import { CheckCircle2 } from "lucide-react";
import { Link } from "react-router";
import { StatusBadge } from "./StatusBadge";

/**
 * One unit as a picture card: its build pic above its name, the whole card a
 * link to that unit's page. `GameUnitsPage`'s grid cell draws the same
 * shape. This is the version for the text sections lower down a unit's own
 * page, where a caller already has a bare id rather than a folded grid cell.
 *
 * `defKey` earns its place only on a morph chain: a game can carry every
 * stage of a commander's upgrade path under one shared display name (the bug
 * that prompted this component, SplinterFaction's commander reads
 * "Federation of Kala Command Unit" at all five tech levels), so the def key
 * and the build pic are the only things left on the card that tell two
 * stages apart. "What it builds"/"What builds it" have no such collision and
 * pass nothing here.
 *
 * `current` swaps the link for a plain block carrying a badge instead. The
 * stage a reader is already viewing must never link to itself.
 */
export function UnitPictureCard({
  to,
  label,
  src,
  defKey,
  current,
}: {
  to: string;
  label: string;
  src?: string;
  defKey?: string;
  current?: boolean;
}) {
  const picture = src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="size-16 rounded object-contain"
    />
  ) : (
    <span aria-hidden className="size-16 shrink-0 rounded bg-muted" />
  );

  const content = (
    <>
      {picture}
      {/* Wraps to a second line rather than truncating, the same reason
          `GameUnitsPage`'s grid cell gives: several units sharing a prefix
          (SplinterFaction's commander tech levels among them) are only told
          apart by their full name. */}
      <span className="line-clamp-2 w-full text-xs font-medium" title={label}>
        {label}
      </span>
      {defKey && (
        <span
          className="w-full truncate font-mono text-[11px] text-muted-foreground"
          title={defKey}
        >
          {defKey}
        </span>
      )}
      {current && (
        <StatusBadge tone="info">
          <CheckCircle2 /> Current
        </StatusBadge>
      )}
    </>
  );

  if (current) {
    return (
      <div className="flex w-32 flex-col items-center gap-1 rounded-lg border border-primary/60 bg-primary/5 p-2 text-center">
        {content}
      </div>
    );
  }

  return (
    <Link
      to={to}
      className="flex w-32 flex-col items-center gap-1 rounded-lg border border-border/50 bg-card p-2 text-center transition-colors hover:border-border hover:bg-accent/50"
    >
      {content}
    </Link>
  );
}
