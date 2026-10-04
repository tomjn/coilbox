/**
 * Where the player's capital sits in a generated galaxy (issue #3432).
 *
 * Every galaxy before this put it on the western edge, and that stays the
 * default, so it has no value here. The one other start is `centre`: the node
 * nearest the middle of the galaxy. Enemy capitals are chosen farthest from the
 * player's, so a centre start puts them all out on the rim and the player has
 * rivals on every side. It changes where the fighting comes from and gives the
 * player nothing, in keeping with Warpath's rule of options, not raw power.
 *
 * A real-star galaxy always starts at Sol, so this does not apply to it.
 */
export type StartPosition = "centre";

/** A start position read from untrusted input: `centre`, or undefined for the
 * default edge start and for anything else. */
export function readStartPosition(value: unknown): StartPosition | undefined {
  return value === "centre" ? "centre" : undefined;
}
