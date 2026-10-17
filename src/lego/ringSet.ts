/**
 * The bookkeeping of a ring of pieces (issue #3317), apart from where they
 * stand. `ring.ts` places them. This is what is saved and how it is read back.
 *
 * A ring is a closed chain. Each member's `ring.next` names the member one step
 * further round, and every member carries the count. The last member names the
 * first. Any member can lead: a member's place is its own, and the others are
 * found by walking the chain, so there is no leader to keep track of.
 *
 * A chain is a ring only while it closes after exactly `count` members. Once a
 * member is deleted, or half of a copied set arrives without the rest, the
 * chain is broken and every piece in it is an ordinary piece again.
 */

import type { LegoPiece } from "./model";

/**
 * The fewest and most pieces a ring can hold, original included.
 *
 * Two is the least that is a ring at all: a half turn. Twelve is a choice, not
 * a measurement. It is a clock face, enough for a wheel at every hour or a
 * dozen turrets, and a number that still divides the full turn into whole
 * degrees. The limit is there so a typed number cannot add a thousand copies.
 */
export const RING_MIN = 2;
export const RING_MAX = 12;

/** Whether a count is one a ring can have. */
export function validRingCount(count: number): boolean {
  return Number.isInteger(count) && count >= RING_MIN && count <= RING_MAX;
}

/**
 * The members of the ring a piece belongs to, in order round the ring and
 * starting with the piece itself, or null when it is in no ring or its ring is
 * broken.
 */
export function ringMembers(
  pieces: LegoPiece[],
  pieceId: string,
): string[] | null {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const start = byId.get(pieceId);
  if (!start?.ring) return null;
  const { count } = start.ring;
  const members: string[] = [];
  let current: LegoPiece | undefined = start;
  while (current?.ring && members.length < count) {
    if (current.ring.count !== count) return null;
    members.push(current.id);
    current = byId.get(current.ring.next);
    if (current?.id === pieceId) break;
  }
  const closed = current?.id === pieceId && members.length === count;
  return closed ? members : null;
}

/** Pieces with `ring` removed from every one whose ring is not whole. */
export function withoutBrokenRings(pieces: LegoPiece[]): LegoPiece[] {
  if (!pieces.some((piece) => piece.ring)) return pieces;
  return pieces.map((piece) => {
    if (!piece.ring || ringMembers(pieces, piece.id)) return piece;
    const { ring: _gone, ...rest } = piece;
    return rest;
  });
}

/**
 * A copied piece with its ring pointing at the copy of the next member, or with
 * the ring dropped when that member was not copied too. The caller then runs
 * `withoutBrokenRings`, because a copy of some of a ring is no ring.
 */
export function withRingRemapped(
  piece: LegoPiece,
  remap: Map<string, string>,
): LegoPiece {
  if (piece.ring === undefined) return piece;
  const { ring, ...rest } = piece;
  const next = remap.get(ring.next);
  return next ? { ...rest, ring: { next, count: ring.count } } : rest;
}
