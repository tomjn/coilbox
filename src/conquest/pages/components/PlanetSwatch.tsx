import { type PlanetId, planetOf, type Rgb } from "../../planets";

const rgb = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;

/**
 * A small round chip for a planet: the left half is its first ground colour and
 * the right half its shallow sea. `random` is a grey chip with a question mark.
 * It is decoration, the option's label is what names it.
 */
export function PlanetSwatch({ planet }: { planet: PlanetId | "random" }) {
  if (planet === "random") {
    return (
      <span
        aria-hidden
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] leading-none text-muted-foreground"
      >
        ?
      </span>
    );
  }
  const p = planetOf(planet);
  return (
    <span
      aria-hidden
      className="inline-block size-4 shrink-0 rounded-full"
      style={{
        background: `linear-gradient(to right, ${rgb(p.biomes[0].colour)} 50%, ${rgb(p.sea.shallow)} 50%)`,
      }}
    />
  );
}
