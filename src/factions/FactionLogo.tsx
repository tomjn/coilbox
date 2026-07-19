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
 *
 * `tint` recolours the emblem to a single hue (e.g. a faction's colour, so two
 * factions sharing one game side stay distinct). Inline vectors take it straight
 * via `currentColor`; rasters get a colour layer masked to the emblem's shape
 * and composited with `mix-blend-mode: color`, which keeps the art's luminance
 * (its shading/detail) while replacing hue+saturation — a true tint, not a flat
 * silhouette.
 */
export function FactionLogo({
  logo,
  sideName,
  size = 16,
  tint,
  className,
}: {
  logo?: FactionLogoSrc;
  sideName?: string;
  size?: number;
  tint?: string;
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
        style={{ ...style, color: tint }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: bundled, trusted SVG markup (never user input) — inlined so it inherits currentColor instead of rendering black inside an <img>.
        dangerouslySetInnerHTML={{ __html: logo.svg }}
      />
    );
  }

  if (tint) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("relative inline-block shrink-0", className)}
        style={style}
      >
        <img
          src={logo.src}
          alt=""
          className="absolute inset-0 size-full object-contain"
        />
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundColor: tint,
            mixBlendMode: "color",
            maskImage: `url("${logo.src}")`,
            WebkitMaskImage: `url("${logo.src}")`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
          }}
        />
      </span>
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
