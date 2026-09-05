import { cn } from "@picoframe/frame";
import type { UnitDisplay } from "@/content/bindings";
import { buildPicMissing } from "@/content/buildPicMissing";
import { unitIconSrc } from "@/content/unitIcon";

/**
 * A unit's build pic, or a stand-in saying why there isn't one.
 *
 * Shared by every screen that draws one: `UnitPicker`'s lists, the lego
 * drawer's game-then-unit browser, and the game units grid. They used to
 * carry three separate answers for "no build picture" - a labelled box, a
 * labelled box with an extra icon, and a bare grey box with no explanation
 * at all - which told the same fact three different ways, one of them not at
 * all (issue #2457). `size` covers the four places this is drawn, from a
 * picked-unit badge to a grid cell.
 */
export function UnitIcon({
  display,
  pending = false,
  size = "default",
}: {
  display?: UnitDisplay;
  /** The pics are still being read, so this one is not missing, just not here. */
  pending?: boolean;
  size?: "sm" | "default" | "lg" | "xl";
}) {
  const src = unitIconSrc(display);
  const box =
    size === "sm"
      ? "size-5"
      : size === "lg"
        ? "size-9"
        : size === "xl"
          ? "size-16"
          : "size-7";
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        className={cn(box, "shrink-0 rounded object-contain")}
      />
    );
  }
  if (pending) {
    return (
      <span
        aria-hidden
        className={cn(box, "shrink-0 animate-pulse rounded bg-muted")}
      />
    );
  }
  const missing = buildPicMissing(display);
  return (
    <span
      title={missing.title}
      className={cn(
        box,
        "flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-center text-[0.55rem] leading-tight text-muted-foreground",
      )}
    >
      {/* The smallest box is 20px, which fits a swatch and not two words, so the
          trigger says it with the tooltip the box already carries. */}
      {size === "sm" ? null : missing.label}
    </span>
  );
}
