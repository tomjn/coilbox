import type { GalaxyDoc } from "../model";

/**
 * Per-faction marker shapes: ownership reads by shape as well as colour
 * (circle, hexagon, triangle, pentagon, diamond), assigned by faction order
 * in the galaxy document. Neutral territory is always a circle. Shared by
 * the 3D rings and the HTML faction dots so map and panels agree.
 */
export const SHAPE_SIDES = [0, 6, 3, 5, 4] as const; // 0 = circle

/** The polygon side count for a faction's marker (0 = circle). */
export function factionSides(
  galaxy: Pick<GalaxyDoc, "factions">,
  factionId?: string,
): number {
  const i = factionId
    ? galaxy.factions.findIndex((f) => f.id === factionId)
    : -1;
  return i < 0 ? 0 : SHAPE_SIDES[i % SHAPE_SIDES.length];
}

/** A CSS `clip-path` drawing the shape (undefined = keep the round dot). */
export function shapeClipPath(sides: number): string | undefined {
  if (sides <= 0) return undefined;
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push(
      `${(50 + 50 * Math.cos(a)).toFixed(1)}% ${(50 + 50 * Math.sin(a)).toFixed(1)}%`,
    );
  }
  return `polygon(${pts.join(", ")})`;
}
