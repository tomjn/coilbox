/**
 * How an ally team is labelled and coloured on screen. Shared by the multiplayer
 * roster, the start-box editor and every surface that has to put a name on an
 * ally index, so "Ally B" means the same thing in a lobby as it does in a
 * skirmish. Pure and hook-free, like `src/lib/teamColor.ts`.
 */

/** Ally index (0-based) as the letter the UI shows: 0 -> A, 1 -> B, and so on. */
export const allyLetter = (n: number): string => String.fromCharCode(65 + n);

/** Black or white text, whichever reads better on `hex` (perceived luminance). */
export function readableText(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}
