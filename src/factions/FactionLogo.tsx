import { cn } from "@/lib/utils";
import type { FactionLogoSrc } from "./fallback";

/**
 * Renders a resolved faction emblem, or nothing when unresolved (no placeholder —
 * we can't invent art). Takes an already-resolved {@link FactionLogoSrc} from
 * `useFactionLogo(s)`; keeping it presentational lets pickers resolve a whole
 * side list in one hook and hand each item its logo.
 *
 * Two render paths: `img` for raster/remote art (its own colours), and `inline`
 * for bundled vector emblems, injected as SVG so they inherit `currentColor` and
 * adapt to the theme.
 */
export function FactionLogo({
  logo,
  sideName,
  size = 16,
  className,
}: {
  logo?: FactionLogoSrc;
  sideName?: string;
  size?: number;
  className?: string;
}) {
  if (!logo) return null;
  const label = sideName ? `${sideName} emblem` : "Faction emblem";
  const style = { width: size, height: size };

  if (logo.kind === "inline") {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("inline-block shrink-0", className)}
        style={style}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: bundled, trusted SVG markup (never user input) — inlined so it inherits currentColor instead of rendering black inside an <img>.
        dangerouslySetInnerHTML={{ __html: logo.svg }}
      />
    );
  }

  return (
    <img
      src={logo.src}
      alt={label}
      className={cn("inline-block shrink-0 object-contain", className)}
      style={style}
    />
  );
}
