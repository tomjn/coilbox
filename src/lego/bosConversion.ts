/**
 * Reading a stored script for whether coilbox converted it from BOS, and
 * whether it was converted before a piece number meant the script's own.
 *
 * A conversion starts with `-- <path> converted from BOS by coilbox.`, which is
 * all that says which stored scripts they are.
 *
 * Before #3009 a number answered as a piece was written `<name> + 1`, so it
 * named the model's piece at that position rather than the one the BOS script
 * declared there. The fix looks the number up in a `PIECES` table. A
 * conversion with no `PIECES` table and a `return <name> + 1` in a call-in that
 * answers with a piece has the old pattern.
 */

const CONVERSION_HEADER = /^-- .+ converted from BOS by coilbox\.$/;

/** Call-ins whose answer is a piece, or a list of them, with an optional
 *  weapon number. */
const PIECE_ANSWERS =
  /^(?:QueryNanoPiece|QueryBuildInfo|QueryTransport|QueryLandingPads|(?:QueryWeapon|AimFromWeapon)\d*)$/;

const FUNCTION_LINE = /^\s*(?:local\s+)?function\s+(?:script\.)?(\w+)\s*\(/;
const RETURN_LINE = /^\s*return\b(.*)$/;
const NAME_PLUS_ONE = /\b[A-Za-z_]\w*\s*\+\s*1\b/;

/** Whether a stored script is one coilbox converted from a game's `.bos`. */
export function isBosConversion(script: string | undefined): boolean {
  if (!script) return false;
  return CONVERSION_HEADER.test(script.split("\n", 1)[0].trimEnd());
}

/** Whether a stored conversion holds the pattern from before piece numbers were
 *  looked up in `PIECES`. False for a script that is not a conversion. */
export function hasOldPieceNumbering(script: string | undefined): boolean {
  if (!script || !isBosConversion(script)) return false;
  if (/\bPIECES\b/.test(script)) return false;
  let callIn: string | null = null;
  for (const line of script.split("\n")) {
    const opened = FUNCTION_LINE.exec(line);
    if (opened) {
      callIn = opened[1];
      continue;
    }
    if (callIn === null || !PIECE_ANSWERS.test(callIn)) continue;
    const returned = RETURN_LINE.exec(line);
    if (returned && NAME_PLUS_ONE.test(returned[1])) return true;
  }
  return false;
}
